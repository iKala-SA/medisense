"""Hospital knowledge library (院內指引與醫學知識庫): documents/{id}, attached to agents by id.

Decided 2026-10-26: one shared library instead of files owned by an agent. No review step: an
upload is usable hospital-wide as soon as it is indexed. Everyone signed in can list, preview and
attach any document; only the uploader or an admin replaces, edits or deletes it.

Every file goes the same way (see _index): the original into the CMEK upload bucket (kept for
audit + re-index), its text extracted and de-identified, the masked text saved next to it (the
"preview" users see) and indexed into the single hospital RAG corpus. RAG Engine never receives
the original. Indexing is synchronous; Cloud Run's 300 s timeout covers a 25 MB file.
"""
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from google.cloud import firestore, storage

from .. import db
from ..auth import User, current_user, require_admin, require_builder
from ..config import settings
from ..engine import deid
from ..engine.extract import NoTextError, extract_text
from ..schemas import DEPARTMENTS, AgentRef, DocCategory, DocumentOut, DocumentPatch

# Run-only users never see the library (Hub + chat only); retrieval runs server-side inside a flow.
router = APIRouter(prefix="/api/knowledge", tags=["knowledge"], dependencies=[Depends(require_builder)])
log = logging.getLogger(__name__)

ALLOWED_SUFFIXES = {".pdf", ".txt", ".md", ".docx", ".pptx", ".html", ".csv", ".json"}
PREVIEW_CHARS = 200_000


def _col():
    return db.client().collection("documents")


def _bucket():
    s = settings()
    return storage.Client(project=s.google_cloud_project).bucket(s.upload_bucket)


def _blob_path(uri: str) -> str:
    return uri.removeprefix(f"gs://{settings().upload_bucket}/")


def _attachments() -> dict[str, list[AgentRef]]:
    """doc id -> agents attaching it (all agents; names are not sensitive and the library is hospital-wide)."""
    out: dict[str, list[AgentRef]] = {}
    for a in db.client().collection("agents").select(["name", "knowledge_doc_ids"]).stream():
        d = a.to_dict() or {}
        for doc_id in d.get("knowledge_doc_ids") or []:
            out.setdefault(doc_id, []).append(AgentRef(id=a.id, name=d.get("name", "")))
    return out


def _out(snap, attached: dict[str, list[AgentRef]] | None = None) -> DocumentOut:
    agents = (attached if attached is not None else _attachments()).get(snap.id, [])
    return DocumentOut(id=snap.id, agents=agents, **(snap.to_dict() or {}))


def _load(doc_id: str):
    snap = _col().document(doc_id).get()
    if not snap.exists:
        raise HTTPException(404, "document not found")
    return snap


def _load_editable(doc_id: str, user: User):
    snap = _load(doc_id)
    if (snap.to_dict() or {}).get("uploaded_uid") != user.uid and user.role != "admin":
        raise HTTPException(403, "only the uploader or an admin can change this document")
    return snap


async def _read_upload(file: UploadFile) -> tuple[str, str, bytes]:
    filename = Path(file.filename or "upload").name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(415, f"unsupported file type {suffix}; allowed: {', '.join(sorted(ALLOWED_SUFFIXES))}")
    data = await file.read()
    if len(data) > settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"file exceeds {settings().max_upload_mb} MB")
    return filename, suffix, data


def _index(doc_id: str, version: int, filename: str, data: bytes, content_type: str) -> dict:
    """Store the original, de-identify its text, store + index the masked text. Returns the fields to
    write on the document. Raises NoTextError (unreadable file) or the RAG/DLP error."""
    from ..engine import rag

    base = f"knowledge/{doc_id}/v{version}"
    bucket = _bucket()
    original = f"{base}/{filename}"
    bucket.blob(original).upload_from_string(data, content_type=content_type or "application/octet-stream")
    masked = deid.deidentify(extract_text(data, Path(filename).suffix.lower()))
    bucket.blob(f"{base}/deidentified.txt").upload_from_string(masked.encode(), content_type="text/plain; charset=utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(tmp) / "upload.txt"  # ASCII path; the real name goes in display_name
        local.write_text(masked, encoding="utf-8")
        rag_file = rag.upload_file(rag.hospital_corpus(), str(local), filename)
    s = settings()
    return {"gcs_uri": f"gs://{s.upload_bucket}/{original}", "deid_uri": f"gs://{s.upload_bucket}/{base}/deidentified.txt",
            "rag_file": rag_file, "chars": len(masked), "status": "indexed", "error": ""}


def _fail(exc: Exception) -> HTTPException:
    msg = f"{exc.__class__.__name__}: {exc}"[:500]
    return HTTPException(422 if isinstance(exc, NoTextError) else 502, f"indexing failed: {msg}")


def _check_meta(category: str, department: str) -> None:
    if category not in DocCategory.__args__:  # type: ignore[attr-defined]
        raise HTTPException(422, f"unknown category {category}")
    if department and department not in DEPARTMENTS:
        raise HTTPException(422, f"unknown department {department}")


@router.get("", response_model=list[DocumentOut])
def list_documents(user: User = Depends(current_user)):
    attached = _attachments()
    docs = [_out(d, attached) for d in _col().stream()]
    return sorted(docs, key=lambda d: str(d.updated_at or d.created_at or ""), reverse=True)


@router.post("", response_model=DocumentOut, status_code=201)
async def upload_document(file: UploadFile = File(...), category: str = Form(...), department: str = Form(""),
                          user: User = Depends(current_user)):
    if not settings().rag_enabled:
        raise HTTPException(503, "knowledge is disabled (RAG_ENABLED=false)")
    _check_meta(category, department)
    filename, _, data = await _read_upload(file)
    ref = _col().document()
    record = {"name": filename, "category": category, "department": department, "content_type": file.content_type or "",
              "size_bytes": len(data), "version": 1, "status": "indexing", "error": "", "rag_file": None,
              "uploaded_by": user.email, "uploaded_uid": user.uid, "created_at": db.now(), "updated_at": db.now()}
    ref.set(record)
    try:
        ref.update(_index(ref.id, 1, filename, data, file.content_type or ""))
    except Exception as exc:  # keep the record so the library shows the failure and it can be replaced/deleted
        err = _fail(exc)
        ref.update({"status": "error", "error": err.detail})
        db.audit(user.uid, "knowledge.error", user.email, doc_id=ref.id, file=filename, error=err.detail)
        raise err from exc
    db.audit(user.uid, "knowledge.upload", user.email, doc_id=ref.id, file=filename, bytes=len(data), deidentified=True)
    return _out(ref.get())


@router.post("/{doc_id}/version", response_model=DocumentOut)
async def replace_document(doc_id: str, file: UploadFile = File(...), user: User = Depends(current_user)):
    """Upload a new version: index it first, then drop the old ragFile, so attached agents never see a gap.
    Older originals stay in GCS (bucket versioning + per-version paths)."""
    from ..engine import rag

    snap = _load_editable(doc_id, user)
    cur = snap.to_dict() or {}
    filename, _, data = await _read_upload(file)
    version = int(cur.get("version", 1)) + 1
    try:
        fields = _index(doc_id, version, filename, data, file.content_type or "")
    except Exception as exc:  # the previous version stays live
        err = _fail(exc)
        db.audit(user.uid, "knowledge.error", user.email, doc_id=doc_id, file=filename, error=err.detail)
        raise err from exc
    if cur.get("rag_file"):
        rag.delete_file(cur["rag_file"])
    snap.reference.update({**fields, "name": filename, "content_type": file.content_type or "", "size_bytes": len(data),
                           "version": version, "updated_at": db.now()})
    db.audit(user.uid, "knowledge.replace", user.email, doc_id=doc_id, file=filename, version=version, bytes=len(data))
    return _out(snap.reference.get())


@router.patch("/{doc_id}", response_model=DocumentOut)
def update_document(doc_id: str, body: DocumentPatch, user: User = Depends(current_user)):
    snap = _load_editable(doc_id, user)
    _check_meta(body.category, body.department)
    snap.reference.update({"category": body.category, "department": body.department, "updated_at": db.now()})
    db.audit(user.uid, "knowledge.update", user.email, doc_id=doc_id, file=(snap.to_dict() or {}).get("name", ""))
    return _out(snap.reference.get())


@router.post("/{doc_id}/reindex", response_model=DocumentOut)
def reindex_document(doc_id: str, user: User = Depends(require_admin)):
    """Re-run extraction + de-identification on the stored original with the CURRENT inspect template
    (e.g. after adding an infoType), then swap the ragFile. The UI calls this one document at a time."""
    from ..engine import rag

    snap = _load(doc_id)
    cur = snap.to_dict() or {}
    if not cur.get("gcs_uri"):
        raise HTTPException(409, "document has no stored original")
    data = _bucket().blob(_blob_path(cur["gcs_uri"])).download_as_bytes()
    try:
        fields = _index(doc_id, int(cur.get("version", 1)), cur["name"], data, cur.get("content_type", ""))
    except Exception as exc:
        err = _fail(exc)
        snap.reference.update({"status": "error", "error": err.detail})
        db.audit(user.uid, "knowledge.error", user.email, doc_id=doc_id, file=cur["name"], error=err.detail)
        raise err from exc
    if cur.get("rag_file") and cur["rag_file"] != fields["rag_file"]:
        rag.delete_file(cur["rag_file"])
    snap.reference.update({**fields, "updated_at": db.now()})
    db.audit(user.uid, "knowledge.reindex", user.email, doc_id=doc_id, file=cur["name"], deidentified=True)
    return _out(snap.reference.get())


@router.get("/{doc_id}/preview", response_class=PlainTextResponse)
def preview_document(doc_id: str, user: User = Depends(current_user)):
    """The de-identified text exactly as RAG Engine received it (first PREVIEW_CHARS characters)."""
    cur = _load(doc_id).to_dict() or {}
    if not cur.get("deid_uri"):
        raise HTTPException(409, "document is not indexed yet")
    text = _bucket().blob(_blob_path(cur["deid_uri"])).download_as_text(encoding="utf-8")
    return text[:PREVIEW_CHARS]


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, user: User = Depends(current_user)):
    """Detach from every agent, drop the ragFile and the record. GCS originals are kept (audit)."""
    from ..engine import rag

    snap = _load_editable(doc_id, user)
    cur = snap.to_dict() or {}
    agents = db.client().collection("agents")
    for a in agents.where(filter=firestore.FieldFilter("knowledge_doc_ids", "array_contains", doc_id)).stream():
        a.reference.update({"knowledge_doc_ids": firestore.ArrayRemove([doc_id])})
    if cur.get("rag_file"):
        rag.delete_file(cur["rag_file"])
    snap.reference.delete()
    db.audit(user.uid, "knowledge.delete", user.email, doc_id=doc_id, file=cur.get("name", ""))


def resolve_rag_files(doc_ids: list[str]) -> list[str]:
    """ragFile names of the attached, indexed documents (missing/failed ones are skipped)."""
    if not doc_ids:
        return []
    refs = [_col().document(i) for i in doc_ids]
    out = []
    for snap in db.client().get_all(refs):
        d = snap.to_dict() or {}
        if snap.exists and d.get("status") == "indexed" and d.get("rag_file"):
            out.append(d["rag_file"])
    return out
