"""Conversation share links (「分享」). Rules decided 2026-11-03:

* who can open a link: any signed-in platform user (current_user = verified e-mail on an allowed Workspace domain, account
  not suspended). There is no per-person list.
* what is shown: a SNAPSHOT of the de-identified conversation taken when the link is created (later messages are not
  included). Session messages are already stored de-identified (runs.py de-identifies the user message at ingress, and
  retrieved chunks / database rows are de-identified before the model sees them); the snapshot is passed through
  deid.deidentify once more anyway, so a share can never carry text that DLP would flag. DLP errors fail the request.
  Attachments (files, images) are NOT copied: the view only says how many there were.
* lifetime: 30 days, fixed (expire_at, Firestore TTL; also capped at the conversation's own expiry). The owner can revoke
  at any time; deleting the conversation deletes its share.
* audit: share.create, share.revoke and every share.view (who, which share, when). Never the content.

shares/{shareId}   session_id, owner_uid, owner_email, owner_name, title, messages[{role, content}], attachments (count),
                   created_at, expire_at
At most one share per conversation: creating again returns the active one.
"""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore
from pydantic import BaseModel

from .. import db
from ..auth import User, current_user
from ..engine import deid
from .sessions import _own, _title

SHARE_DAYS = 30

router = APIRouter(tags=["shares"])


class ShareInfo(BaseModel):
    id: str
    session_id: str
    created_at: datetime
    expires_at: datetime


class SharedMessage(BaseModel):
    role: str
    content: str


class SharedConversation(BaseModel):
    id: str
    title: str
    owner_name: str
    created_at: datetime
    expires_at: datetime
    messages: list[SharedMessage]
    attachments: int = 0


def _col():
    return db.client().collection("shares")


def _alive(d: dict) -> bool:
    exp = d.get("expire_at")
    return isinstance(exp, datetime) and exp > db.now()


def _active_for(session_id: str, user: User):
    """The owner's live share of this conversation, or None."""
    q = _col().where(filter=firestore.FieldFilter("session_id", "==", session_id))
    for s in q.stream():
        d = s.to_dict() or {}
        if d.get("owner_uid") == user.uid and _alive(d):
            return s
    return None


def _info(snap) -> ShareInfo:
    d = snap.to_dict() or {}
    return ShareInfo(id=snap.id, session_id=d["session_id"], created_at=d["created_at"], expires_at=d["expire_at"])


def delete_for_session(session_id: str) -> None:
    """Called when a conversation is deleted: its share links go with it."""
    for s in _col().where(filter=firestore.FieldFilter("session_id", "==", session_id)).stream():
        s.reference.delete()


def _snapshot(d: dict) -> tuple[str, list[dict]]:
    """Title + messages, de-identified (again). Text only: meta (steps, citations) is left out."""
    msgs = [{"role": str(m.get("role", "")), "content": str(m.get("content", ""))}
            for m in d.get("messages") or [] if m.get("role") in ("user", "assistant")]
    texts = _deid_all([_title(d), *(m["content"] for m in msgs)])
    return texts[0], [{**m, "content": t} for m, t in zip(msgs, texts[1:], strict=True)]


def _deid_all(texts: list[str]) -> list[str]:
    """deid over many texts in as few DLP calls as fit the request cap (deidentify_many = one table per call)."""
    out: list[str | None] = [None] * len(texts)
    batch: list[int] = []
    size = 0

    def flush():
        nonlocal batch, size
        if batch:
            for i, t in zip(batch, deid.deidentify_many([texts[i] for i in batch]), strict=True):
                out[i] = t
        batch, size = [], 0

    for i, t in enumerate(texts):
        n = len(t.encode()) + 64
        if not t.strip():
            out[i] = t
        elif n > deid.MAX_REQUEST_BYTES // 2:  # long reply: the chunking single-text path
            out[i] = deid.deidentify(t)
        else:
            if size + n > deid.MAX_REQUEST_BYTES // 2:
                flush()
            batch.append(i)
            size += n
    flush()
    return [t if t is not None else "" for t in out]


@router.get("/api/sessions/{session_id}/share", response_model=ShareInfo | None)
def get_share(session_id: str, user: User = Depends(current_user)):
    _own(session_id, user)
    snap = _active_for(session_id, user)
    return _info(snap) if snap else None


@router.post("/api/sessions/{session_id}/share", response_model=ShareInfo)
def create_share(session_id: str, user: User = Depends(current_user)):
    """Owner only (404 otherwise). Returns the existing active link if there is one. Locked / archived chats may be shared."""
    sess = _own(session_id, user)
    if snap := _active_for(session_id, user):
        return _info(snap)
    d = sess.to_dict() or {}
    if not d.get("messages"):
        raise HTTPException(409, "conversation is empty")
    title, messages = _snapshot(d)
    at = db.now()
    exp = at + timedelta(days=SHARE_DAYS)
    if isinstance(d.get("expire_at"), datetime):
        exp = min(exp, d["expire_at"])  # never outlive the conversation's own retention
    share_id = secrets.token_urlsafe(16)
    _col().document(share_id).set({"session_id": session_id, "owner_uid": user.uid, "owner_email": user.email,
                                   "owner_name": user.name, "title": title, "messages": messages,
                                   "attachments": len(d.get("attachments") or []), "created_at": at, "expire_at": exp})
    db.audit(user.uid, "share.create", user.email, session_id=session_id, share_id=share_id, messages=len(messages),
             expires_at=exp)
    return ShareInfo(id=share_id, session_id=session_id, created_at=at, expires_at=exp)


@router.delete("/api/sessions/{session_id}/share", status_code=204)
def revoke_share(session_id: str, user: User = Depends(current_user)):
    """Owner only. Deletes every link of this conversation (the snapshot goes with it)."""
    _own(session_id, user)
    q = _col().where(filter=firestore.FieldFilter("session_id", "==", session_id))
    gone = [s for s in q.stream() if (s.to_dict() or {}).get("owner_uid") == user.uid]
    if not gone:
        raise HTTPException(404, "not shared")
    for s in gone:
        s.reference.delete()
        db.audit(user.uid, "share.revoke", user.email, session_id=session_id, share_id=s.id)


@router.get("/api/shares/{share_id}", response_model=SharedConversation)
def view_share(share_id: str, user: User = Depends(current_user)):
    """Any signed-in platform user. 404 when revoked, expired or the conversation is gone. Every view is audited."""
    snap = _col().document(share_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or not _alive(d) or not db.client().collection("sessions").document(d.get("session_id", "")).get().exists:
        raise HTTPException(404, "share not found or expired")
    db.audit(user.uid, "share.view", user.email, share_id=share_id, session_id=d.get("session_id", ""),
             owner_uid=d.get("owner_uid", ""))
    return SharedConversation(id=share_id, title=d.get("title", ""), owner_name=d.get("owner_name") or d.get("owner_email", ""),
                              created_at=d["created_at"], expires_at=d["expire_at"],
                              messages=[SharedMessage(**m) for m in d.get("messages") or []],
                              attachments=int(d.get("attachments") or 0))
