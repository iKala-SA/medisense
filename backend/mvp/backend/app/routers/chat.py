"""General chat (no agent picker needed): same pipeline as runs.py (de-identify -> flow -> save session ->
audit `chat.run`). Default agent = the first PUBLISHED agent named "Medisense", else a built-in single-LLM flow.
Attachments are extracted + de-identified server-side and stored on the session (never the raw file text).

Streaming (/api/chat/stream) is intentionally NOT provided: flows are multi-step (knowledge, condition, tools,
approvals) and run_flow returns only a finished reply, so tokens cannot be streamed cleanly without a rewrite.
"""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from google.cloud import firestore

from .. import db
from ..auth import User, current_user
from ..engine import deid
from ..engine.extract import NoTextError, extract_text
from ..schemas import AgentIn, AttachmentOut, ChatRequest, Flow, RunResponse
from .knowledge import _read_upload, resolve_rag_files
from .runs import _agent_def, execute_run
from .spaces import doc_visible

router = APIRouter(prefix="/api/chat", tags=["chat"])
BUILTIN_ID = "general-chat"
MAX_ATTACHMENTS = 5
MAX_ATTACH_CHARS = 60_000  # raw text cut before de-identification (bounds DLP cost and prompt size)
SNIPPET = 500
BUILTIN = AgentIn(name="Medisense", model_group="auto",
                  description="General clinical-assistant chat",
                  instructions="You are Medisense, an assistant for Taichung Veterans General Hospital staff. "
                              "Answer concisely in the user's language. Patient identifiers are masked; do not "
                              "try to recover them. You do not replace clinical judgment.")
KNOWLEDGE_FLOW = Flow.model_validate({
    "nodes": [{"id": "in", "type": "input", "data": {}}, {"id": "kb", "type": "knowledge", "data": {}},
              {"id": "llm", "type": "llm", "data": {"prompt": "{{input}}"}},
              {"id": "out", "type": "output", "data": {"template": "{{last}}"}}],
    "edges": [{"id": "e1", "source": "in", "target": "kb"}, {"id": "e2", "source": "kb", "target": "llm"},
              {"id": "e3", "source": "llm", "target": "out"}]})


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


def _attachment_context(sess: dict) -> str:
    atts = sess.get("attachments") or []
    if not atts:
        return ""
    body = "\n\n".join(f"[附件：{a.get('name', '')}]\n{a.get('text', '')}" for a in atts)
    return f"以下為使用者上傳的附件內容（已去識別化），回答時可引用：\n{body}"


@router.post("", response_model=RunResponse)
def chat(body: ChatRequest, user: User = Depends(current_user)):
    if body.agent_id:
        agent, rag_files = _agent_def(body.agent_id, user, use_published=True)
        agent_id = body.agent_id
    else:
        agent, agent_id = _default_agent(user)
        rag_files = resolve_rag_files(agent.knowledge_doc_ids) if agent_id != BUILTIN_ID else []
    agent = agent.model_copy(update={"model_group": body.model_group})

    doc_ids = []
    for i in dict.fromkeys(body.knowledge_doc_ids):
        snap = db.client().collection("documents").document(i).get()
        if not snap.exists or not doc_visible(user, snap.to_dict() or {}):
            raise HTTPException(422, f"unknown or inaccessible document: {i}")
        doc_ids.append(i)
    if doc_ids:
        rag_files = [*rag_files, *[f for f in resolve_rag_files(doc_ids) if f not in rag_files]]
        if not agent.flow.nodes:  # empty canvas: add a knowledge step so the picked documents are searched
            agent = agent.model_copy(update={"flow": KNOWLEDGE_FLOW})

    session_id = body.session_id or uuid.uuid4().hex
    existing = db.client().collection("sessions").document(session_id).get().to_dict() or {}
    if existing and existing.get("uid") != user.uid:
        raise HTTPException(403, "not your session")
    return execute_run(agent, rag_files, agent_id, user, body.message, session_id, audit_action="chat.run",
                       audit_extra={"model_group": body.model_group, "knowledge_docs": len(doc_ids),
                                    "attachments": len(existing.get("attachments") or [])},
                       extra_context=_attachment_context(existing), session_extra={"kind": "chat", "agent_id": agent_id})


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
    ref.set(sess)
    db.audit(user.uid, "chat.attach", user.email, session_id=sid, file=filename, chars=len(text))
    return AttachmentOut(session_id=sid, attachment_id=att["id"], name=filename, chars=len(text), snippet=text[:SNIPPET])
