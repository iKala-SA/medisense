"""Opening the ORIGINAL file of a library document from a chat reference.

Everyone sees the de-identified text by default (chat.py cited_document). The original may hold personal data, so:
  * pii == "none" (DLP found nothing at upload): any user who can see the document may open it.
  * otherwise (found / unknown): only accounts with the `original_view` grant (admins set it per user), and the
    opener must state a purpose. Anything we cannot classify counts as "found".
Every open is audited (who, which document, when, purpose) BEFORE a link is issued, and every fetch is audited again.
The link is a short-lived token (ORIGINAL_LINK_TTL_SECONDS) bound to the user and the document, and the fetch also
needs the user's normal bearer token, so a copied link is useless to anyone else. Downloading is allowed; the viewer
page carries a per-user watermark. Nothing here caches or copies the original.
"""
import base64
import hashlib
import hmac
import json
import time
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from .. import db
from ..auth import User, current_user
from ..config import settings
from ..schemas import OpenOriginalIn, OpenOriginalOut
from .knowledge import _blob_path, _bucket
from .spaces import doc_visible

router = APIRouter(prefix="/api/chat/documents", tags=["chat"])
MIN_PURPOSE = 4
INLINE_TYPES = {".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
                ".csv": "text/plain; charset=utf-8", ".json": "text/plain; charset=utf-8"}  # everything else is download-only


def access_for(user: User, d: dict) -> str:
    """'none' (no original stored) | 'open' | 'purpose' (grant + stated purpose) | 'denied'."""
    if not d.get("gcs_uri"):
        return "none"
    if d.get("pii") == "none":
        return "open"
    return "purpose" if user.original_view else "denied"


def _key() -> bytes:
    k = settings().download_signing_key
    if not k:
        raise HTTPException(503, "original-file viewing is not configured (DOWNLOAD_SIGNING_KEY)")
    return k.encode()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign(payload: dict) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    return f"{body}.{_b64(hmac.new(_key(), body.encode(), hashlib.sha256).digest())}"


def verify(token: str) -> dict:
    body, _, sig = token.partition(".")
    if not hmac.compare_digest(sig, _b64(hmac.new(_key(), body.encode(), hashlib.sha256).digest())):
        raise HTTPException(401, "invalid link")
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError as exc:
        raise HTTPException(401, "invalid link") from exc
    if payload.get("exp", 0) < time.time():
        raise HTTPException(401, "link expired; open the document again")
    return payload


def _doc(doc_id: str, user: User) -> dict:
    snap = db.client().collection("documents").document(doc_id).get()
    d = snap.to_dict() or {}
    if not snap.exists or not doc_visible(user, d):
        raise HTTPException(404, "document not found")
    return d


def _suffix(name: str) -> str:
    return "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""


@router.post("/{doc_id}/original", response_model=OpenOriginalOut)
def open_original(doc_id: str, body: OpenOriginalIn, user: User = Depends(current_user)):
    d = _doc(doc_id, user)
    mode = access_for(user, d)
    if mode == "none":
        raise HTTPException(409, "this document has no stored original")
    if mode == "denied":
        raise HTTPException(403, "you do not have permission to open original files that contain personal data")
    purpose = body.purpose.strip()
    if mode == "purpose" and len(purpose) < MIN_PURPOSE:
        raise HTTPException(422, "state the purpose for opening this original file")
    _key()  # fail before auditing an open that cannot be served
    ttl = settings().original_link_ttl_seconds
    exp = int(time.time()) + ttl
    db.audit(user.uid, "knowledge.original_open", user.email, doc_id=doc_id, file=d.get("name", ""), version=d.get("version", 1),
             pii=d.get("pii", "unknown"), purpose=purpose, link_ttl_s=ttl)
    token = sign({"sub": user.uid, "doc": doc_id, "exp": exp})
    name = d.get("name", "")
    suffix = _suffix(name)
    return OpenOriginalOut(url=f"/api/chat/documents/{doc_id}/original?t={token}", expires_at=exp, ttl_seconds=ttl, filename=name,
                           kind="pdf" if suffix == ".pdf" else "text" if suffix in INLINE_TYPES else "download",
                           watermark=f"{user.name} · {user.email}")


@router.get("/{doc_id}/original")
def fetch_original(doc_id: str, t: str = Query(...), download: bool = False, user: User = Depends(current_user)):
    tok = verify(t)
    if tok.get("sub") != user.uid or tok.get("doc") != doc_id:
        raise HTTPException(403, "this link was not issued to you for this document")
    d = _doc(doc_id, user)
    if access_for(user, d) not in ("open", "purpose"):  # access revoked or document reclassified since the link was issued
        raise HTTPException(403, "no longer permitted to open this original file")
    data = _bucket().blob(_blob_path(d["gcs_uri"])).download_as_bytes()
    name = d.get("name", "document")
    inline_type = INLINE_TYPES.get(_suffix(name))
    as_inline = bool(inline_type) and not download
    db.audit(user.uid, "knowledge.original_fetch", user.email, doc_id=doc_id, file=name, version=d.get("version", 1),
             disposition="download" if not as_inline else "view", bytes=len(data))
    return Response(content=data, media_type=inline_type if as_inline else "application/octet-stream",
                    headers={"Content-Disposition": f"{'inline' if as_inline else 'attachment'}; filename*=UTF-8''{quote(name)}",
                             "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
