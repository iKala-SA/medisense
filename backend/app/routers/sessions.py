"""My conversations (sessions/{id}): list, open, rename, delete. Strictly the caller's own (`uid`), admins
included: another person's chat is never exposed here. Content in a session is already de-identified."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import firestore

from .. import db
from ..auth import User, current_user
from ..schemas import SessionDetail, SessionMessage, SessionPage, SessionPatch, SessionSummary

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _col():
    return db.client().collection("sessions")


def _title(d: dict) -> str:
    """Stored title, else the first ~30 chars of the first (de-identified) user message for older sessions."""
    if d.get("title"):
        return str(d["title"])
    first = next((m.get("content", "") for m in d.get("messages") or [] if m.get("role") == "user"), "")
    return " ".join(str(first).split())[:30]


def _summary(doc_id: str, d: dict) -> SessionSummary:
    return SessionSummary(id=doc_id, title=_title(d), agent_id=d.get("agent_id", ""), updated_at=d.get("updated_at"),
                          created_at=d.get("created_at"), project_id=d.get("project_id", ""),
                          pinned=bool(d.get("pinned")), locked=bool(d.get("locked")), archived=bool(d.get("archived")), message_count=len(d.get("messages") or []))


def _own(session_id: str, user: User):
    snap = _col().document(session_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("uid") != user.uid:  # 404 for both, so ids of other people's sessions are not probeable
        raise HTTPException(404, "session not found")
    return snap


@router.get("", response_model=SessionPage)
def list_sessions(limit: int = Query(30, ge=1, le=100), cursor: str | None = None, user: User = Depends(current_user)):
    """Newest first. Pass `next_cursor` back as ?cursor= for the next page. Needs the composite index
    sessions(uid asc, updated_at desc) (infra/02-foundation.sh)."""
    q = _col().where(filter=firestore.FieldFilter("uid", "==", user.uid))
    if cursor:
        try:
            q = q.where(filter=firestore.FieldFilter("updated_at", "<", datetime.fromisoformat(cursor)))
        except ValueError as exc:
            raise HTTPException(422, "bad cursor") from exc
    docs = list(q.order_by("updated_at", direction=firestore.Query.DESCENDING).limit(limit + 1).stream())
    page = docs[:limit]
    nxt = None
    if len(docs) > limit and page:
        last = (page[-1].to_dict() or {}).get("updated_at")
        nxt = last.isoformat() if isinstance(last, datetime) else None
    return SessionPage(items=[_summary(d.id, d.to_dict() or {}) for d in page], next_cursor=nxt)


@router.get("/{session_id}", response_model=SessionDetail)
def get_session(session_id: str, user: User = Depends(current_user)):
    snap = _own(session_id, user)
    d = snap.to_dict() or {}
    return SessionDetail(**_summary(snap.id, d).model_dump(),
                         messages=[SessionMessage(role=m.get("role", ""), content=m.get("content", ""), meta=m.get("meta")) for m in d.get("messages") or []],
                         attachments=[{"id": a.get("id"), "name": a.get("name"), "chars": a.get("chars", 0), "kind": a.get("kind", "text")}
                                      for a in d.get("attachments") or []],
                         feedback={str(k): v for k, v in (d.get("feedback") or {}).items()})


@router.patch("/{session_id}", response_model=SessionSummary)
def update_session(session_id: str, body: SessionPatch, user: User = Depends(current_user)):
    """Rename and/or move to a project (project_id "" = out of any project)."""
    snap = _own(session_id, user)
    upd: dict = {}
    if body.title is not None:
        title = " ".join(body.title.split())
        if not title:
            raise HTTPException(422, "title is empty")
        upd["title"] = title
    if body.project_id is not None:
        if body.project_id:
            from .projects import own_project
            own_project(body.project_id, user)
        upd["project_id"] = body.project_id
    for k in ("pinned", "locked", "archived"):
        if getattr(body, k) is not None:
            upd[k] = getattr(body, k)
    if not upd:
        raise HTTPException(422, "nothing to update")
    if (snap.to_dict() or {}).get("locked") and (set(upd) - {"locked", "pinned"}):
        raise HTTPException(409, "conversation is locked")  # unlock first (pinning stays allowed)
    snap.reference.update(upd)  # not updated_at: renaming / moving must not reorder the list
    db.audit(user.uid, "session.update", user.email, session_id=session_id, **{k: v for k, v in upd.items() if k != "title"})
    return _summary(snap.id, {**(snap.to_dict() or {}), **upd})


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: str, user: User = Depends(current_user)):
    snap = _own(session_id, user)
    if (snap.to_dict() or {}).get("locked"):
        raise HTTPException(409, "conversation is locked")
    from ..engine import chat_images
    chat_images.delete([a["blob"] for a in (snap.to_dict() or {}).get("attachments") or [] if a.get("blob")])
    snap.reference.delete()
    db.audit(user.uid, "session.delete", user.email, session_id=session_id)
