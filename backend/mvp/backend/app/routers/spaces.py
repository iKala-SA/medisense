"""Spaces (spaces/{id}): named collections of knowledge-library documents (`documents`), a way to group
guidelines for a person, a team or the whole hospital. Documents are not copied: a space holds ids.

Types: personal (owner + share), team (owner + share), org (visible to every signed-in user; only an admin may
create one, edit rights still come from owner/admin/share). A document can be added only if the caller can see it:
library documents are hospital-wide unless they carry their own `share` block, in which case that ACL applies.
"""
from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore

from .. import db, sharing
from ..auth import User, current_user
from ..schemas import Share, SpaceDocuments, SpaceIn, SpaceOut

router = APIRouter(prefix="/api/spaces", tags=["spaces"])


def _col():
    return db.client().collection("spaces")


def _viewable(user: User, d: dict, groups: set[str] | None = None) -> bool:
    return d.get("type") == "org" or sharing.can_view(user, d, groups)


def _out(doc, user: User, groups: set[str] | None = None) -> SpaceOut:
    d = doc.to_dict() or {}
    return SpaceOut(id=doc.id, documents_count=len(d.get("document_ids") or []), my_role=sharing.my_role(user, d, groups), **d)


def _load(sid: str):
    snap = _col().document(sid).get()
    if not snap.exists:
        raise HTTPException(404, "space not found")
    return snap


def _load_viewable(sid: str, user: User):
    snap = _load(sid)
    if not _viewable(user, snap.to_dict() or {}):
        raise HTTPException(403, "space is not shared with you")
    return snap


def _load_editable(sid: str, user: User):
    snap = _load(sid)
    if not sharing.can_edit(user, snap.to_dict() or {}):
        raise HTTPException(403, "you cannot edit this space")
    return snap


def doc_visible(user: User, d: dict) -> bool:
    """Library documents are hospital-wide; a document with its own `share` block (or uploader) follows it."""
    if isinstance(d.get("share"), dict) and d["share"]:
        return sharing.can_view(user, {**d, "owner_uid": d.get("uploaded_uid", "")})
    return True


def _check_documents(ids: list[str], user: User) -> list[str]:
    """De-duplicated ids, each an existing document the user may see; 422 naming the others."""
    ids = list(dict.fromkeys(ids))
    bad: list[str] = []
    for i in ids:
        snap = db.client().collection("documents").document(i).get()
        if not snap.exists or not doc_visible(user, snap.to_dict() or {}):
            bad.append(i)
    if bad:
        raise HTTPException(422, f"unknown or inaccessible documents: {', '.join(bad)}")
    return ids


@router.get("", response_model=list[SpaceOut])
def list_spaces(user: User = Depends(current_user)):
    """Spaces I own or that are shared with me, plus every org space, newest first."""
    groups = sharing.group_ids_of(user.email)
    seen = dict(sharing.visible_docs("spaces", user))
    for d in _col().where(filter=firestore.FieldFilter("type", "==", "org")).stream():
        seen.setdefault(d.id, d)
    rows = [_out(d, user, groups) for d in seen.values()]
    return sorted(rows, key=lambda s: str(s.updated_at or ""), reverse=True)


@router.post("", response_model=SpaceOut, status_code=201)
def create_space(body: SpaceIn, user: User = Depends(current_user)):
    if body.type == "org" and user.role != "admin":
        raise HTTPException(403, "only an admin can create an org space")
    ids = _check_documents(body.document_ids, user)
    ref = _col().document()
    data = {**body.model_dump(), "document_ids": ids, **sharing.share_fields(Share()), "owner_uid": user.uid,
            "owner_email": user.email, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    db.audit(user.uid, "space.create", user.email, space_id=ref.id, name=body.name, type=body.type)
    return _out(ref.get(), user)


@router.get("/{sid}", response_model=SpaceOut)
def get_space(sid: str, user: User = Depends(current_user)):
    return _out(_load_viewable(sid, user), user)


@router.put("/{sid}", response_model=SpaceOut)
def update_space(sid: str, body: SpaceIn, user: User = Depends(current_user)):
    snap = _load_editable(sid, user)
    if body.type == "org" and user.role != "admin":
        raise HTTPException(403, "only an admin can make a space org-wide")
    ids = _check_documents(body.document_ids, user)
    snap.reference.update({**body.model_dump(), "document_ids": ids, "updated_at": db.now()})
    db.audit(user.uid, "space.update", user.email, space_id=sid, name=body.name, type=body.type)
    return _out(snap.reference.get(), user)


@router.post("/{sid}/documents", response_model=SpaceOut)
def add_documents(sid: str, body: SpaceDocuments, user: User = Depends(current_user)):
    snap = _load_editable(sid, user)
    ids = _check_documents(body.document_ids, user)
    current = list((snap.to_dict() or {}).get("document_ids") or [])
    merged = current + [i for i in ids if i not in current]
    snap.reference.update({"document_ids": merged, "updated_at": db.now()})
    db.audit(user.uid, "space.documents", user.email, space_id=sid, added=len(merged) - len(current), removed=0)
    return _out(snap.reference.get(), user)


@router.delete("/{sid}/documents/{doc_id}", response_model=SpaceOut)
def remove_document(sid: str, doc_id: str, user: User = Depends(current_user)):
    snap = _load_editable(sid, user)
    current = list((snap.to_dict() or {}).get("document_ids") or [])
    if doc_id not in current:
        raise HTTPException(404, "document is not in this space")
    snap.reference.update({"document_ids": [i for i in current if i != doc_id], "updated_at": db.now()})
    db.audit(user.uid, "space.documents", user.email, space_id=sid, added=0, removed=1)
    return _out(snap.reference.get(), user)


@router.put("/{sid}/share", response_model=SpaceOut)
def share_space(sid: str, body: Share, user: User = Depends(current_user)):
    snap = _load(sid)
    if not sharing.can_manage(user, snap.to_dict() or {}):
        raise HTTPException(403, "only the owner or an admin can change sharing")
    snap.reference.update({**sharing.share_fields(sharing.validate_share(body)), "updated_at": db.now()})
    db.audit(user.uid, "space.share", user.email, space_id=sid, access=body.access, members=len(body.members))
    return _out(snap.reference.get(), user)


@router.delete("/{sid}", status_code=204)
def delete_space(sid: str, user: User = Depends(current_user)):
    snap = _load(sid)
    if not sharing.can_manage(user, snap.to_dict() or {}):
        raise HTTPException(403, "only the owner or an admin can delete this space")
    snap.reference.delete()
    db.audit(user.uid, "space.delete", user.email, space_id=sid, name=(snap.to_dict() or {}).get("name", ""))
