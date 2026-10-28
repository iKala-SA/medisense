"""Thumbs up / down on a chat reply. The rating also sits on the session (so a reopened chat shows it); the reasons
and free text go to feedback/{session}_{index} for the admins. Free text is de-identified before it is stored, like every
other piece of user text, and the audit entry never carries it."""
from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..auth import User, current_user, require_admin
from ..config import settings
from ..engine import deid
from ..schemas import FeedbackIn, FeedbackOut

router = APIRouter(prefix="/api/chat/feedback", tags=["chat"])
SNAPSHOT = 8000


def _col():
    return db.client().collection("feedback")


def _out(snap) -> FeedbackOut:
    return FeedbackOut(id=snap.id, **{k: v for k, v in (snap.to_dict() or {}).items() if k in FeedbackOut.model_fields})


@router.post("")
def rate(body: FeedbackIn, user: User = Depends(current_user)):
    ref = db.client().collection("sessions").document(body.session_id)
    sess = ref.get().to_dict() or {}
    if not sess or sess.get("uid") != user.uid:
        raise HTTPException(404, "session not found")
    msgs = sess.get("messages") or []
    if body.message_index >= len(msgs) or msgs[body.message_index].get("role") != "assistant":
        raise HTTPException(422, "message_index must point at an assistant reply")
    fid = f"{body.session_id}_{body.message_index}"
    ratings = dict(sess.get("feedback") or {})
    if body.rating == "none":
        ratings.pop(str(body.message_index), None)
        _col().document(fid).delete()
    else:
        ratings[str(body.message_index)] = body.rating
        msg = msgs[body.message_index]
        question = next((m["content"] for m in reversed(msgs[:body.message_index]) if m.get("role") == "user"), "")
        meta = msg.get("meta") or {}
        now = db.now()
        prior = _col().document(fid).get().to_dict() or {}
        _col().document(fid).set({
            "session_id": body.session_id, "message_index": body.message_index, "rating": body.rating,
            "reasons": list(dict.fromkeys(body.reasons)) if body.rating == "down" else [],
            "details": deid.deidentify(body.details.strip()) if body.rating == "down" and body.details.strip() else "",
            "question": question[:SNAPSHOT], "answer": msg.get("content", "")[:SNAPSHOT],  # both already de-identified (option B)
            "models": sorted({t.get("model") for t in meta.get("trace", []) if t.get("model")}),
            "sources": [c.get("source", "") for c in meta.get("citations", [])],
            "uid": user.uid, "user_email": user.email, "created_at": prior.get("created_at") or now, "updated_at": now,
            "expire_at": db.expiry(settings().feedback_retention_days)})
    sess["feedback"] = ratings
    sess["expire_at"] = db.expiry(settings().session_retention_days)
    ref.set(sess)
    db.audit(user.uid, "chat.feedback", user.email, session_id=body.session_id, message_index=body.message_index,
             rating=body.rating, reasons=list(dict.fromkeys(body.reasons)) if body.rating == "down" else [])
    return {"rating": body.rating}


@router.get("", response_model=list[FeedbackOut])
def list_feedback(rating: str = "", user: User = Depends(require_admin)):
    """Newest first, for the admins reviewing what users reported."""
    rows = [_out(d) for d in _col().stream() if not rating or (d.to_dict() or {}).get("rating") == rating]
    return sorted(rows, key=lambda r: str(r.updated_at or ""), reverse=True)[:200]
