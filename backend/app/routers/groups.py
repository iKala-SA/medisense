"""Groups (groups/{id}: name, description, role_ids[]): CRUD and member management
(specifications/BE-GROUP-SPEC.md). Guarded by `require_permission("groups")`: reads need `groups` or `groups-viewer`,
writes need `groups`; the admin account role always passes. Membership is stored on the user (users/{email}.groups, a list of group ids);
`member_emails` in responses is derived from it. Membership does not affect access; sharing still reads it.
`/api/directory` is the search used by the share dialog (any signed-in, non-suspended user)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import firestore

from .. import db
from ..auth import User, current_user, require_permission
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
from .roles import SYSTEM_ROLES

router = APIRouter(prefix="/api/groups", tags=["groups"])
view = require_permission("groups")
manage = require_permission("groups", write=True)
directory_router = APIRouter(prefix="/api/directory", tags=["groups"])
DIRECTORY_LIMIT = 20
MEMBER_LIMIT = 1000


def _col():
    return db.client().collection("groups")


def _users():
    return db.client().collection("users")


def _out(doc, members: list[str]) -> GroupOut:
    # Legacy documents may still hold member_emails until scripts/migrate_group_membership.py has run; ignore them.
    data = {k: v for k, v in (doc.to_dict() or {}).items() if k != "member_emails"}
    return GroupOut(id=doc.id, **data, member_emails=members)


def _load(group_id: str):
    snap = _col().document(group_id).get()
    if not snap.exists:
        raise HTTPException(404, "group not found")
    return snap


def _member_emails(group_id: str) -> list[str]:
    q = _users().where(filter=firestore.FieldFilter("groups", "array_contains", group_id))
    return sorted(d.id for d in q.stream())


def _member_map() -> dict[str, list[str]]:
    """Every group id -> member e-mails, from one pass over users."""
    out: dict[str, list[str]] = {}
    for d in _users().stream():
        for gid in (d.to_dict() or {}).get("groups") or []:
            out.setdefault(gid, []).append(d.id)
    return {gid: sorted(emails) for gid, emails in out.items()}


def _link(email: str, group_id: str, actor: str, add: bool) -> None:
    op = firestore.ArrayUnion if add else firestore.ArrayRemove
    _users().document(email).update({"groups": op([group_id]), "groups_changed_at": db.now(), "groups_changed_by": actor})


def _set_membership(group_id: str, emails: list[str], actor: str) -> None:
    """Replace the group's members with `emails`. Only existing accounts can be members; others are ignored."""
    wanted = list(dict.fromkeys(emails))
    snaps = db.client().get_all([_users().document(e) for e in wanted]) if wanted else []
    desired = {s.id for s in snaps if s.exists}
    current = set(_member_emails(group_id))
    for email in sorted(desired - current):
        _link(email, group_id, actor, add=True)
    for email in sorted(current - desired):
        _link(email, group_id, actor, add=False)


def _check_role_ids(ids: list[str]) -> list[str]:
    known = set(SYSTEM_ROLES) | {d.id for d in db.client().collection("roles").stream()}
    out: list[str] = []
    for rid in (r.strip() for r in ids):
        if rid not in known:
            raise HTTPException(422, f"unknown role: {rid}")
        if rid not in out:
            out.append(rid)
    return out


def _normalize(email: str) -> str:
    return email.strip().lower()


def _valid_email(email: str) -> bool:
    # Same rule as GroupIn.member_emails (decided 2026-10-30: backend rule kept).
    return "@" in email and " " not in email


def _domain_allowed(email: str) -> bool:
    allowed = settings().allowed_domain_list
    return not allowed or email.rsplit("@", 1)[-1] in allowed


@router.get("", response_model=list[GroupOut], dependencies=[Depends(view)])
def list_groups():
    members = _member_map()
    return sorted((_out(d, members.get(d.id, [])) for d in _col().stream()), key=lambda g: g.name.lower())


@router.post("", response_model=GroupOut, status_code=201)
def create_group(body: GroupIn, user: User = Depends(manage)):
    ref = _col().document()
    data = {**body.model_dump(exclude={"member_emails"}), "role_ids": _check_role_ids(body.role_ids),
            "created_by": user.email, "created_at": db.now(), "updated_at": db.now(), "updated_by": user.email}
    ref.set(data)
    _set_membership(ref.id, body.member_emails, user.email)
    db.audit(user.uid, "group.create", user.email, group_id=ref.id, name=body.name, members=len(body.member_emails))
    return _out(ref.get(), _member_emails(ref.id))


@router.get("/{group_id}", response_model=GroupOut, dependencies=[Depends(view)])
def get_group(group_id: str):
    return _out(_load(group_id), _member_emails(group_id))


@router.patch("/{group_id}", response_model=GroupOut)
def patch_group(group_id: str, body: GroupPatch, user: User = Depends(manage)):
    snap = _load(group_id)
    changes = body.model_dump(exclude_none=True)
    audit_extra: dict = {}
    if "role_ids" in changes:
        old = list((snap.to_dict() or {}).get("role_ids") or [])
        changes["role_ids"] = _check_role_ids(changes["role_ids"])
        audit_extra = {"old_role_ids": old, "new_role_ids": changes["role_ids"]}
    if changes:
        snap.reference.update({**changes, "updated_at": db.now(), "updated_by": user.email})
        db.audit(user.uid, "group.update", user.email, group_id=group_id, fields=sorted(changes), **audit_extra)
    return _out(snap.reference.get(), _member_emails(group_id))


@router.put("/{group_id}", response_model=GroupOut)
def update_group(group_id: str, body: GroupIn, user: User = Depends(manage)):
    snap = _load(group_id)
    snap.reference.update({**body.model_dump(exclude={"member_emails"}), "role_ids": _check_role_ids(body.role_ids),
                           "updated_at": db.now(), "updated_by": user.email})
    _set_membership(group_id, body.member_emails, user.email)
    db.audit(user.uid, "group.update", user.email, group_id=group_id, name=body.name, members=len(body.member_emails))
    return _out(snap.reference.get(), _member_emails(group_id))


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: str, user: User = Depends(manage)):
    snap = _load(group_id)
    _set_membership(group_id, [], user.email)  # drop the group id from every member's `groups`
    snap.reference.delete()
    db.audit(user.uid, "group.delete", user.email, group_id=group_id, name=(snap.to_dict() or {}).get("name", ""))


@router.get("/{group_id}/members", response_model=list[GroupMemberOut], dependencies=[Depends(view)])
def list_members(group_id: str):
    emails = _member_emails(_load(group_id).id)
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
def add_members(group_id: str, body: MemberAddIn, user: User = Depends(manage)):
    _load(group_id)
    current = _member_emails(group_id)
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
        elif not _users().document(email).get().exists:
            result.rejected.append(MemberRejected(email=email, reason="not_a_registered_account"))
        else:
            candidates.append(email)
    if len(current) + len(candidates) > MEMBER_LIMIT:
        raise HTTPException(422, f"group member limit is {MEMBER_LIMIT}")
    if candidates:
        for email in candidates:
            _link(email, group_id, user.email, add=True)
        result.added = candidates
        db.audit(user.uid, "group.member_add", user.email, group_id=group_id, added=len(candidates),
                 rejected=len(result.rejected), emails=candidates)
    return result


@router.delete("/{group_id}/members/{email}", status_code=204)
def remove_member(group_id: str, email: str, user: User = Depends(manage)):
    _load(group_id)
    target = _normalize(email)
    if target not in _member_emails(group_id):
        raise HTTPException(404, "member not found")
    _link(target, group_id, user.email, add=False)
    db.audit(user.uid, "group.member_remove", user.email, group_id=group_id, email=target)


@directory_router.get("", response_model=DirectoryOut)
def directory(q: str = Query("", max_length=100), user: User = Depends(current_user)):
    """Search people and groups by name / e-mail / department for the share dialog. Suspended accounts
    are left out; group members are not listed (only a count)."""
    needle = q.strip().lower()
    people: list[DirectoryUser] = []
    for d in _users().stream():
        u = d.to_dict() or {}
        if u.get("status") == "suspended" or not u.get("email"):
            continue
        hay = f"{u.get('email', '')} {u.get('name', '')} {u.get('department', '')}".lower()
        if needle in hay:
            people.append(DirectoryUser(email=u["email"], name=u.get("name", ""), department=u.get("department", "")))
    people.sort(key=lambda p: (p.name or p.email).lower())
    members = _member_map()
    groups = [DirectoryGroup(id=d.id, name=g.get("name", ""), description=g.get("description", ""),
                             member_count=len(members.get(d.id, [])))
              for d in _col().stream() if needle in (g := d.to_dict() or {}).get("name", "").lower()]
    groups.sort(key=lambda g: g.name.lower())
    return DirectoryOut(users=people[:DIRECTORY_LIMIT], groups=groups[:DIRECTORY_LIMIT])
