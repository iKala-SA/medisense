"""General chat (no agent picker needed): same pipeline as runs.py (de-identify -> flow -> save session ->
audit `chat.run`). Default agent = the first PUBLISHED agent named "Medisense", else a built-in single-LLM flow.
Attachments are extracted + de-identified server-side and stored on the session (never the raw file text).

/api/chat/stream is the same pipeline as Server-Sent Events: `plan` (steps about to run), `step_start`,
`delta` (answer / thought tokens of an llm step), `step_done` (the finished StepTrace) and finally `done`
(the RunResponse) or `error`. Flows can branch and pause for approval, so `delta` is a live draft of the llm step;
the `done` reply is authoritative.
"""
import asyncio
import json
import logging
import queue
import re
import threading
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from google.cloud import firestore

from .. import db
from ..auth import User, current_user, require_builder
from ..config import settings
from ..engine import deid, llm
from ..engine.extract import NoTextError, extract_text
from ..schemas import DEPARTMENTS, AgentIn, AttachmentOut, ChatRequest, RunResponse, SaveToSpaceIn, SaveToSpaceOut, SpaceDocuments
from .knowledge import PREVIEW_CHARS, _blob_path, _bucket, _read_upload, create_document, resolve_rag_files
from .runs import _agent_def, execute_run
from .originals import access_for
from .spaces import _load_editable, add_documents, doc_visible

router = APIRouter(prefix="/api/chat", tags=["chat"])
log = logging.getLogger(__name__)
BUILTIN_ID = "general-chat"
MAX_ATTACHMENTS = 5
MAX_ATTACH_CHARS = 60_000  # raw text cut before de-identification (bounds DLP cost and prompt size)
SNIPPET = 500
BUILTIN = AgentIn(name="Medisense", model_group="auto",
                  description="General clinical-assistant chat",
                  instructions="You are Medisense, an assistant for Taichung Veterans General Hospital staff. "
                              "Answer concisely in the language the user writes in (any language). Patient identifiers are masked; do not "
                              "try to recover them. You do not replace clinical judgment. "
                              "You may answer general questions from your own knowledge, not only hospital topics. "
                              "If a question needs live or outside information (weather, news, prices) and you have no tool "
                              "to look it up, say so plainly and tell the user they can turn on 「Web 搜尋」 from the + menu "
                              "in the message box; never invent live data.")

def _default_agent(user: User) -> tuple[AgentIn, str]:
    q = (db.client().collection("agents").where(filter=firestore.FieldFilter("status", "==", "published"))
         .where(filter=firestore.FieldFilter("name", "==", "Medisense")).limit(1))
    for d in q.stream():
        try:
            agent, _ = _agent_def(d.id, user, use_published=True)
            return agent, d.id
        except HTTPException:
            break
    return BUILTIN.model_copy(deep=True), BUILTIN_ID


def _all_visible_doc_ids(user: User, cap: int = 50) -> list[str]:
    """Newest indexed library documents the caller may see (the 所有資料 scope). Capped: retrieval filters by file id."""
    q = db.client().collection("documents").where(filter=firestore.FieldFilter("status", "==", "indexed"))
    rows = [(d.id, d.to_dict() or {}) for d in q.stream()]
    rows = [(i, d) for i, d in rows if d.get("rag_file") and doc_visible(user, d)]
    rows.sort(key=lambda r: str(r[1].get("updated_at") or r[1].get("created_at") or ""), reverse=True)
    return [i for i, _ in rows[:cap]]


def _attachment_context(sess: dict) -> str:
    atts = sess.get("attachments") or []
    if not atts:
        return ""
    body = "\n\n".join(f"[附件：{a.get('name', '')}]\n{a.get('text', '')}" for a in atts)
    return f"以下為使用者上傳的附件內容（已去識別化），回答時可引用：\n{body}"


def _prepare(body: ChatRequest, user: User) -> dict:
    """Resolve agent, knowledge scope, model pin and session for one chat turn -> execute_run keyword arguments."""
    if body.model and body.model not in {m["id"] for m in llm.model_catalog()}:
        raise HTTPException(422, f"unknown model: {body.model}")
    if body.agent_id:
        agent, rag_files = _agent_def(body.agent_id, user, use_published=True)
        agent_id = body.agent_id
    else:
        agent, agent_id = _default_agent(user)
        rag_files = resolve_rag_files(agent.knowledge_doc_ids) if agent_id != BUILTIN_ID else []
    agent = agent.model_copy(update={"model_group": body.model_group})

    doc_ids = []
    if body.knowledge_scope == "general":  # model only: no retrieval, whatever the agent has attached
        rag_files = []
    elif body.knowledge_scope == "all" and settings().rag_enabled:
        doc_ids = _all_visible_doc_ids(user)
    for i in dict.fromkeys(body.knowledge_doc_ids if body.knowledge_scope == "selected" else []):
        snap = db.client().collection("documents").document(i).get()
        if not snap.exists or not doc_visible(user, snap.to_dict() or {}):
            raise HTTPException(422, f"unknown or inaccessible document: {i}")
        doc_ids.append(i)
    if doc_ids:
        rag_files = [*rag_files, *[f for f in resolve_rag_files(doc_ids) if f not in rag_files]]

    session_id = body.session_id or uuid.uuid4().hex
    existing = db.client().collection("sessions").document(session_id).get().to_dict() or {}
    if existing and existing.get("uid") != user.uid:
        raise HTTPException(403, "not your session")
    return dict(agent=agent, rag_files=rag_files, agent_id=agent_id, user=user, message=body.message, session_id=session_id,
                audit_action="chat.run",
                audit_extra={"model_group": body.model_group, "pinned_model": body.model or "", "web_search": body.web_search, "knowledge_docs": len(doc_ids),
                             "attachments": len(existing.get("attachments") or [])},
                extra_context=_attachment_context(existing), session_extra={"kind": "chat", "agent_id": agent_id},
                pin_model=body.model, web_search=body.web_search)


@router.post("", response_model=RunResponse)
def chat(body: ChatRequest, user: User = Depends(current_user)):
    return execute_run(**_prepare(body, user))


def _sse(event: dict) -> bytes:
    return f"event: {event['event']}\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n".encode()


@router.post("/stream")
async def chat_stream(body: ChatRequest, user: User = Depends(current_user)):
    kwargs = await run_in_threadpool(_prepare, body, user)  # validation errors are plain HTTP errors, before the stream opens
    events: queue.Queue = queue.Queue()

    def work():
        try:
            r = execute_run(**kwargs, emit=events.put)
            events.put({"event": "done", "result": r.model_dump()})
        except HTTPException as exc:
            events.put({"event": "error", "status": exc.status_code, "detail": str(exc.detail)})
        except Exception:  # noqa: BLE001 - surfaced to the client as an error event, details stay in the log
            log.exception("chat stream failed")
            events.put({"event": "error", "status": 500, "detail": "internal error"})
        finally:
            events.put(None)

    threading.Thread(target=work, daemon=True).start()

    async def gen():
        yield b": open\n\n"
        while (item := await asyncio.to_thread(events.get)) is not None:
            yield _sse(item)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@router.post("/attachments", response_model=AttachmentOut)
async def add_attachment(file: UploadFile = File(...), session_id: str | None = Form(None), user: User = Depends(current_user)):
    """Extract text from an upload (same types and MAX_UPLOAD_MB limit as the knowledge library), de-identify it,
    store the masked text on the session (created if session_id is omitted) and return a snippet."""
    filename, suffix, data = await _read_upload(file)
    sid = session_id or uuid.uuid4().hex
    ref = db.client().collection("sessions").document(sid)
    sess = ref.get().to_dict() or {"agent_id": "", "uid": user.uid, "messages": [], "created_at": db.now(), "kind": "chat"}
    if sess.get("uid") != user.uid:
        raise HTTPException(403, "not your session")
    if len(sess.get("attachments") or []) >= MAX_ATTACHMENTS:
        raise HTTPException(409, f"at most {MAX_ATTACHMENTS} attachments per conversation")
    try:
        raw = await run_in_threadpool(extract_text, data, suffix)
    except NoTextError as exc:
        raise HTTPException(422, str(exc)) from exc
    text = await run_in_threadpool(deid.deidentify, raw[:MAX_ATTACH_CHARS])
    att = {"id": uuid.uuid4().hex[:12], "name": filename, "chars": len(text), "text": text, "at": db.now()}
    sess["attachments"] = [*(sess.get("attachments") or []), att]
    sess["updated_at"] = db.now()
    sess["expire_at"] = db.expiry(settings().session_retention_days)
    ref.set(sess)
    db.audit(user.uid, "chat.attach", user.email, session_id=sid, file=filename, chars=len(text))
    return AttachmentOut(session_id=sid, attachment_id=att["id"], name=filename, chars=len(text), snippet=text[:SNIPPET])


ALLOWED_LIBRARY = (".pdf", ".txt", ".md", ".docx", ".pptx", ".html", ".csv", ".json")


@router.post("/save-to-space", response_model=SaveToSpaceOut)
def save_to_space(body: SaveToSpaceIn, user: User = Depends(require_builder)):
    """A code / document block from a reply -> a library document inside one of the user's spaces. The library is
    builder-only, so this is too. The text is de-identified again first, so the stored original holds no identifiers."""
    name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", body.filename.strip()).strip(". ") or "reply.txt"
    if not name.lower().endswith(ALLOWED_LIBRARY):  # the library only takes some file types: keep the name, add .txt
        name += ".txt"
    _load_editable(body.space_id, user)  # fail before indexing anything the user could not put in that space
    text = deid.deidentify(body.content)
    ctype = "text/markdown" if name.lower().endswith(".md") else "text/plain"
    dept = user.department if user.department in DEPARTMENTS else ""
    doc = create_document(user, name, text.encode(), ctype, "other", dept)
    add_documents(body.space_id, SpaceDocuments(document_ids=[doc.id]), user)
    db.audit(user.uid, "chat.save_to_space", user.email, doc_id=doc.id, space_id=body.space_id, file=name, chars=len(text))
    return SaveToSpaceOut(document_id=doc.id, filename=name, space_id=body.space_id)


@router.get("/documents/{doc_id}")
def cited_document(doc_id: str, user: User = Depends(current_user)):
    """A library document opened from a chat reference: its de-identified text (what the model saw) for the viewer.
    Any signed-in user may open a document they can see; the knowledge router is builder-only."""
    snap = db.client().collection("documents").document(doc_id).get()
    d = snap.to_dict() or {}
    if not snap.exists or not doc_visible(user, d):
        raise HTTPException(404, "document not found")
    if not d.get("deid_uri"):
        raise HTTPException(409, "document is not indexed yet")
    text = _bucket().blob(_blob_path(d["deid_uri"])).download_as_text(encoding="utf-8")
    db.audit(user.uid, "chat.open_document", user.email, doc_id=doc_id, file=d.get("name", ""))
    return {"id": doc_id, "name": d.get("name", ""), "version": d.get("version", 1), "category": d.get("category", ""),
            "department": d.get("department", ""), "chars": len(text), "truncated": len(text) > PREVIEW_CHARS,
            "text": text[:PREVIEW_CHARS], "pii": d.get("pii", "unknown"), "pii_types": d.get("pii_types", []),
            "original": access_for(user, d)}  # none | open | purpose (grant + purpose) | denied
