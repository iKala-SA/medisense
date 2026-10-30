"""Groups (groups/{id}: name, description, member_emails[]): admin-only CRUD and member management
(specifications/BE-GROUP-SPEC.md). Membership does not affect access; sharing still reads member_emails.
`/api/directory` is the search used by the share dialog (any signed-in, non-suspended user)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import firestore

from .. import db
from ..auth import User, current_user, require_admin
from ..config import settings
from ..schemas import (
    DirectoryGroup,
    DirectoryOut,
    DirectoryUser,
    GroupIn,
    GroupMemberOut,
    GroupOut,
    GroupPatch,
    MemberAddIn,
    MemberAddResult,
    MemberRejected,
)

router = APIRouter(prefix="/api/groups", tags=["groups"], dependencies=[Depends(require_admin)])
directory_router = APIRouter(prefix="/api/directory", tags=["groups"])
DIRECTORY_LIMIT = 20
MEMBER_LIMIT = 1000


def _col():
    return db.client().collection("groups")


def _out(doc) -> GroupOut:
    return GroupOut(id=doc.id, **(doc.to_dict() or {}))


def _load(group_id: str):
    snap = _col().document(group_id).get()
    if not snap.exists:
        raise HTTPException(404, "group not found")
    return snap


def _members(snap) -> list[str]:
    return list((snap.to_dict() or {}).get("member_emails") or [])


def _normalize(email: str) -> str:
    return email.strip().lower()


def _valid_email(email: str) -> bool:
    # Same rule as GroupIn.member_emails (decided 2026-10-30: backend rule kept).
    return "@" in email and " " not in email


def _domain_allowed(email: str) -> bool:
    allowed = settings().allowed_domain_list
    return not allowed or email.rsplit("@", 1)[-1] in allowed


@router.get("", response_model=list[GroupOut])
def list_groups():
    return sorted((_out(d) for d in _col().stream()), key=lambda g: g.name.lower())


@router.post("", response_model=GroupOut, status_code=201)
def create_group(body: GroupIn, user: User = Depends(require_admin)):
    ref = _col().document()
    data = {**body.model_dump(), "created_by": user.email, "created_at": db.now(), "updated_at": db.now(),
            "updated_by": user.email}
    ref.set(data)
    db.audit(user.uid, "group.create", user.email, group_id=ref.id, name=body.name, members=len(body.member_emails))
    return GroupOut(id=ref.id, **data)


@router.get("/{group_id}", response_model=GroupOut)
def get_group(group_id: str):
    return _out(_load(group_id))


@router.patch("/{group_id}", response_model=GroupOut)
def patch_group(group_id: str, body: GroupPatch, user: User = Depends(require_admin)):
    snap = _load(group_id)
    changes = body.model_dump(exclude_none=True)
    if changes:
        snap.reference.update({**changes, "updated_at": db.now(), "updated_by": user.email})
        db.audit(user.uid, "group.update", user.email, group_id=group_id, fields=sorted(changes))
    return _out(snap.reference.get())


@router.put("/{group_id}", response_model=GroupOut)
def update_group(group_id: str, body: GroupIn, user: User = Depends(require_admin)):
    snap = _load(group_id)
    snap.reference.update({**body.model_dump(), "updated_at": db.now(), "updated_by": user.email})
    db.audit(user.uid, "group.update", user.email, group_id=group_id, name=body.name, members=len(body.member_emails))
    return _out(snap.reference.get())


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: str, user: User = Depends(require_admin)):
    snap = _load(group_id)
    snap.reference.delete()
    db.audit(user.uid, "group.delete", user.email, group_id=group_id, name=(snap.to_dict() or {}).get("name", ""))


@router.get("/{group_id}/members", response_model=list[GroupMemberOut])
def list_members(group_id: str):
    emails = _members(_load(group_id))
    refs = [db.client().collection("users").document(e) for e in emails]
    # get_all does not return snapshots in request order, so match them by document id (the e-mail).
    by_id = {snap.id: snap for snap in db.client().get_all(refs)} if refs else {}
    out: list[GroupMemberOut] = []
    for email in emails:
        snap = by_id.get(email)
        exists = snap is not None and snap.exists
        data = (snap.to_dict() or {}) if exists else {}
        out.append(GroupMemberOut(email=email, name=data.get("name", ""), department=data.get("department", ""),
                                  status="suspended" if data.get("status") == "suspended" else "active",
                                  has_account=exists))
    return sorted(out, key=lambda m: (m.name or m.email).lower())


@router.post("/{group_id}/members", response_model=MemberAddResult)
def add_members(group_id: str, body: MemberAddIn, user: User = Depends(require_admin)):
    snap = _load(group_id)
    current = _members(snap)
    result = MemberAddResult()
    candidates: list[str] = []
    for raw in body.emails:
        email = _normalize(raw)
        if not _valid_email(email):
            result.rejected.append(MemberRejected(email=raw.strip(), reason="invalid_email"))
        elif email in current or email in candidates:
            result.skipped.append(email)
        elif not _domain_allowed(email):
            result.rejected.append(MemberRejected(email=email, reason="domain_not_allowed"))
        elif not db.client().collection("users").document(email).get().exists:
            result.rejected.append(MemberRejected(email=email, reason="not_a_registered_account"))
        else:
            candidates.append(email)
    if len(current) + len(candidates) > MEMBER_LIMIT:
        raise HTTPException(422, f"group member limit is {MEMBER_LIMIT}")
    if candidates:
        snap.reference.update({"member_emails": firestore.ArrayUnion(candidates), "updated_at": db.now(),
                               "updated_by": user.email})
        result.added = candidates
        db.audit(user.uid, "group.member_add", user.email, group_id=group_id, added=len(candidates),
                 rejected=len(result.rejected), emails=candidates)
    return result


@router.delete("/{group_id}/members/{email}", status_code=204)
def remove_member(group_id: str, email: str, user: User = Depends(require_admin)):
    snap = _load(group_id)
    target = _normalize(email)
    if target not in _members(snap):
        raise HTTPException(404, "member not found")
    snap.reference.update({"member_emails": firestore.ArrayRemove([target]), "updated_at": db.now(),
                           "updated_by": user.email})
    db.audit(user.uid, "group.member_remove", user.email, group_id=group_id, email=target)


@directory_router.get("", response_model=DirectoryOut)
def directory(q: str = Query("", max_length=100), user: User = Depends(current_user)):
    """Search people and groups by name / e-mail / department for the share dialog. Suspended accounts
    are left out; group members are not listed (only a count)."""
    needle = q.strip().lower()
    people: list[DirectoryUser] = []
    for d in db.client().collection("users").stream():
        u = d.to_dict() or {}
        if u.get("status") == "suspended" or not u.get("email"):
            continue
        hay = f"{u.get('email', '')} {u.get('name', '')} {u.get('department', '')}".lower()
        if needle in hay:
            people.append(DirectoryUser(email=u["email"], name=u.get("name", ""), department=u.get("department", "")))
    people.sort(key=lambda p: (p.name or p.email).lower())
    groups = [DirectoryGroup(id=d.id, name=g.get("name", ""), description=g.get("description", ""),
                             member_count=len(g.get("member_emails") or []))
              for d in _col().stream() if needle in (g := d.to_dict() or {}).get("name", "").lower()]
    groups.sort(key=lambda g: g.name.lower())
    return DirectoryOut(users=people[:DIRECTORY_LIMIT], groups=groups[:DIRECTORY_LIMIT])
