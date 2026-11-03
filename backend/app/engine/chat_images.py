"""Images pasted into a chat: validated, personal data blacked out (engine/deid.redact_image), then stored in the upload
bucket under chat-images/{uid}/{session}/{id}. Only the redacted copy exists. A model sees it as an image part of the
user's message on every turn of that conversation. Bucket objects are removed with the conversation (and by the
lifecycle rule in infra/11-retention-ttl.sh when a conversation simply expires)."""
import base64
import logging
import uuid

from google.api_core.exceptions import NotFound
from google.cloud import storage

from ..config import settings
from . import deid

log = logging.getLogger(__name__)
MAX_IMAGES = 3  # per conversation: every image is re-sent to the model on each turn


def sniff(data: bytes) -> str | None:
    """Real type from the bytes (the file name and Content-Type are the client's claim)."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:2] == b"BM":
        return "image/bmp"
    return None


def _bucket():
    s = settings()
    return storage.Client(project=s.google_cloud_project).bucket(s.upload_bucket)


def save(uid: str, session_id: str, data: bytes, mime: str) -> tuple[str, str]:
    """Redact, then store. Returns (attachment id, object path). A redaction failure stores nothing."""
    redacted = deid.redact_image(data, mime)
    aid = uuid.uuid4().hex[:12]
    path = f"chat-images/{uid}/{session_id}/{aid}"
    _bucket().blob(path).upload_from_string(redacted, content_type=mime)
    return aid, path


class Gone(Exception):
    """The stored copy no longer exists (removed, or expired by the bucket lifecycle rule)."""


def load(path: str) -> bytes:
    try:
        return _bucket().blob(path).download_as_bytes()
    except NotFound as exc:
        raise Gone(path) from exc


def delete(paths: list[str]) -> None:
    for p in paths:
        try:
            _bucket().blob(p).delete()
        except Exception as exc:  # noqa: BLE001 - already gone is fine; never block deleting the conversation
            log.warning("could not delete %s: %s", p, exc)


def parts_for(attachments: list[dict]) -> list[dict]:
    """The session's stored images as image parts for a model message."""
    out = []
    for a in attachments:
        if a.get("kind") != "image":
            continue
        b64 = base64.b64encode(load(a["blob"])).decode()
        out.append({"type": "image_url", "image_url": {"url": f"data:{a.get('mime', 'image/png')};base64,{b64}"}})
    return out


def _images(sess: dict) -> list[dict]:
    return [a for a in sess.get("attachments") or [] if a.get("kind") == "image" and a.get("id")]


def _referenced(sess: dict) -> set[str]:
    return {i for m in sess.get("messages") or [] if m.get("role") == "user" for i in m.get("images") or []}


def unsent_ids(sess: dict) -> list[str]:
    """Images uploaded since the last message was sent: they belong to the user message about to be saved.
    Images from before message references existed (no `msg_at`) are left to message_images' fallback."""
    seen = _referenced(sess)
    return [a["id"] for a in _images(sess) if a.get("msg_at") is not None and a["id"] not in seen]


def message_images(sess: dict) -> dict[int, list[dict]]:
    """message index -> [{id, name, mime, available}] for the user messages that had images. `available` is False once
    the attachment was removed from the conversation (the thumbnail becomes an "expired" tile). Conversations saved
    before images were recorded on the message: their images are shown on the first user message."""
    by_id = {a["id"]: a for a in _images(sess)}
    msgs = sess.get("messages") or []
    out: dict[int, list[dict]] = {}
    for i, m in enumerate(msgs):
        if m.get("role") == "user" and m.get("images"):
            out[i] = [{"id": x, "name": (by_id.get(x) or {}).get("name", ""), "mime": (by_id.get(x) or {}).get("mime", ""),
                       "available": x in by_id} for x in m["images"]]
    seen = _referenced(sess)
    legacy = [a for a in by_id.values() if a.get("msg_at") is None and a["id"] not in seen]
    first = next((i for i, m in enumerate(msgs) if m.get("role") == "user"), None)
    if legacy and first is not None:
        out[first] = [*out.get(first, []), *({"id": a["id"], "name": a.get("name", ""), "mime": a.get("mime", ""), "available": True} for a in legacy)]
    return out
