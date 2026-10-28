"""Sharing groups (groups/{id}: name, description, member_emails[]): admin-only CRUD, plus the
`/api/directory` search used by the share dialog (any signed-in, non-suspended user)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import firestore

from .. import db
from ..auth import User, current_user, require_admin
from ..schemas import DirectoryGroup, DirectoryOut, DirectoryUser, GroupIn, GroupOut

router = APIRouter(prefix="/api/groups", tags=["groups"], dependencies=[Depends(require_admin)])
directory_router = APIRouter(prefix="/api/directory", tags=["groups"])
DIRECTORY_LIMIT = 20


def _col():
    return db.client().collection("groups")


def _out(doc) -> GroupOut:
    return GroupOut(id=doc.id, **(doc.to_dict() or {}))


def _load(group_id: str):
    snap = _col().document(group_id).get()
    if not snap.exists:
        raise HTTPException(404, "group not found")
    return snap


def _name_taken(name: str, except_id: str = "") -> bool:
    q = _col().where(filter=firestore.FieldFilter("name", "==", name))
    return any(d.id != except_id for d in q.stream())


@router.get("", response_model=list[GroupOut])
def list_groups():
    return sorted((_out(d) for d in _col().stream()), key=lambda g: g.name.lower())


@router.post("", response_model=GroupOut, status_code=201)
def create_group(body: GroupIn, user: User = Depends(require_admin)):
    if _name_taken(body.name):
        raise HTTPException(409, "a group with this name already exists")
    ref = _col().document()
    data = {**body.model_dump(), "created_by": user.email, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    db.audit(user.uid, "group.create", user.email, group_id=ref.id, name=body.name, members=len(body.member_emails))
    return GroupOut(id=ref.id, **data)


@router.get("/{group_id}", response_model=GroupOut)
def get_group(group_id: str):
    return _out(_load(group_id))


@router.put("/{group_id}", response_model=GroupOut)
def update_group(group_id: str, body: GroupIn, user: User = Depends(require_admin)):
    snap = _load(group_id)
    if _name_taken(body.name, except_id=group_id):
        raise HTTPException(409, "a group with this name already exists")
    snap.reference.update({**body.model_dump(), "updated_at": db.now()})
    db.audit(user.uid, "group.update", user.email, group_id=group_id, name=body.name, members=len(body.member_emails))
    return _out(snap.reference.get())


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: str, user: User = Depends(require_admin)):
    snap = _load(group_id)
    snap.reference.delete()
    db.audit(user.uid, "group.delete", user.email, group_id=group_id, name=(snap.to_dict() or {}).get("name", ""))


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
