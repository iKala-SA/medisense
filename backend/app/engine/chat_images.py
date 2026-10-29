"""Images pasted into a chat: validated, personal data blacked out (engine/deid.redact_image), then stored in the upload
bucket under chat-images/{uid}/{session}/{id}. Only the redacted copy exists. A model sees it as an image part of the
user's message on every turn of that conversation. Bucket objects are removed with the conversation (and by the
lifecycle rule in infra/11-retention-ttl.sh when a conversation simply expires)."""
import base64
import logging
import uuid

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


def load(path: str) -> bytes:
    return _bucket().blob(path).download_as_bytes()


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
