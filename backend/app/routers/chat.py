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
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from google.cloud import firestore

from .. import db
from ..auth import User, current_user, require_builder
from ..config import settings
from ..engine import bigquery, chat_images, deid, llm, routing
from ..engine import connectors as connectors_engine
from ..engine import db_tools
from ..engine import gateway_actions as ga
from ..engine.extract import NoTextError, extract_text
from ..schemas import DEPARTMENTS, AgentIn, ApproveRequest, AttachmentOut, CapConnector, ChatRequest, RunResponse, SaveToSpaceIn, SaveToSpaceOut, SpaceDocuments, StepTrace
from .knowledge import PREVIEW_CHARS, _blob_path, _bucket, _read_upload, create_document, resolve_rag_files
from .runs import RunStopped, _agent_def, can_decide, decide_pending, execute_run
from .originals import access_for
from .projects import own_project
from .spaces import _load_editable, add_documents, doc_visible

VOICE_HINT = ("\n\n這是語音對話，回覆會被唸出來：用自然的口語、簡短（最多三到四句），先講重點；"
              "不要使用 Markdown、清單、標題或表格，也不要唸出網址或編號。")

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
    atts = [a for a in atts if a.get("kind") != "image"]  # images travel as image parts of the message, not as text
    if not atts:
        return ""
    body = "\n\n".join(f"[附件：{a.get('name', '')}]\n{a.get('text', '')}" for a in atts)
    return f"以下為使用者上傳的附件內容（已去識別化），回答時可引用：\n{body}"


def my_connector_caps(user: User) -> list[CapConnector]:
    """Every action of every gateway-backed connector this user may use (owner, shared, account-wide), as agent capabilities:
    reads run as the user, writes pause for the user's confirmation. A connector the user has not connected yet still shows up;
    calling it answers with the "請先連線" message, which is the right hint. Admin-only types (webhook, slack, mcp...) stay with
    agents that were built with them."""
    from .my_connectors import _visible

    per_connector: list[list[CapConnector]] = []
    for cid, snap in sorted(_visible(user).items(), key=lambda kv: (kv[1].to_dict() or {}).get("label", "")):
        d = snap.to_dict() or {}
        cfg = d.get("config") or {}
        if d.get("type") == "calendar":
            reads, writes = connectors_engine.calendar_allowed(cfg)
            actions = [*reads, *writes]
        elif d.get("type") == "gateway" and cfg.get("service") not in ga.DB_SERVICES:  # BigQuery goes through 資料庫連接器 (SQL guard, row cut)
            actions = list(cfg.get("allowed_actions") or [])
        else:
            actions = []
        if actions:
            per_connector.append([CapConnector(connector_id=cid, action=a, require_approval=True) for a in actions])
    # Round-robin across connectors: every allowed action is offered (no cap), the interleaving only keeps each service
    # represented early in the tool list.
    caps: list[CapConnector] = []
    for i in range(max((len(x) for x in per_connector), default=0)):
        caps.extend(x[i] for x in per_connector if i < len(x))
    return caps


def general_agent(user: User) -> tuple[AgentIn, str, list[str]]:
    """The agent a general chat turn runs (no agent picked): the default Medisense agent or the built-in assistant, widened
    with every connector shared with this user (the + menu's 連接器 list), writes confirmed by the user. Deterministic, so the
    approval step can rebuild the very same tools (same names) when the person confirms a paused write."""
    agent, agent_id = _default_agent(user)
    rag_files = resolve_rag_files(agent.knowledge_doc_ids) if agent_id != BUILTIN_ID else []
    mine = my_connector_caps(user)
    if mine:
        known = {(c.connector_id, c.action) for c in agent.capabilities.connectors}
        offered = [*agent.capabilities.connectors, *[c for c in mine if (c.connector_id, c.action) not in known]]
        agent = agent.model_copy(update={"capabilities": agent.capabilities.model_copy(update={"connectors": offered})})  # no cap: every allowed action
    return agent, agent_id, rag_files


def _prepare(body: ChatRequest, user: User) -> dict:
    """Resolve agent, knowledge scope, model pin and session for one chat turn -> execute_run keyword arguments."""
    if body.model and body.model not in {m["id"] for m in llm.model_catalog()}:
        raise HTTPException(422, f"unknown model: {body.model}")
    chosen = bool(body.agent_id)
    if body.agent_id:
        agent, rag_files = _agent_def(body.agent_id, user, use_published=True)
        agent_id = body.agent_id
    else:
        agent, agent_id, rag_files = general_agent(user)
    agent = agent.model_copy(update={"model_group": "fast" if body.voice and not body.model else body.model_group})
    if body.skill_ids:  # skills invoked with / : added to the agent's own; unknown, disabled or non-viewable ones are skipped by skills.build_prefix
        agent = agent.model_copy(update={"skill_ids": list(dict.fromkeys([*agent.skill_ids, *body.skill_ids]))})
    if not chosen and body.db_connectors:  # what each database returns is still decided by THIS user's group rules at call time
        agent = agent.model_copy(update={"capabilities": agent.capabilities.model_copy(update={"db_connectors": list(dict.fromkeys(body.db_connectors))})})

    doc_ids = []
    if chosen:  # a picked agent does exactly what it was built to do: its own knowledge (and spaces, by YOUR rights), its connectors, no wider scope
        from ..engine.capabilities import rag_files_for
        rag_files = rag_files_for(agent, user, rag_files)
    elif body.knowledge_scope == "selected" and body.space_ids:  # 具體資料: the chosen spaces, limited to what THIS user may see
        from ..engine.capabilities import rag_files_for
        rag_files = rag_files_for(agent.model_copy(update={"capabilities": agent.capabilities.model_copy(update={"spaces": list(dict.fromkeys(body.space_ids))})}), user, rag_files)
    elif body.knowledge_scope == "general":  # model only: no retrieval, whatever the agent has attached
        rag_files = []
    elif body.knowledge_scope == "all" and settings().rag_enabled:
        doc_ids = _all_visible_doc_ids(user)
    for i in dict.fromkeys(body.knowledge_doc_ids if body.knowledge_scope == "selected" and not chosen else []):
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
    if existing.get("locked"):
        raise HTTPException(409, "conversation is locked")
    images = chat_images.parts_for(existing.get("attachments") or [])
    if images and (agent.routing.sovereign_only or routing.sovereign_only()):
        raise HTTPException(409, "僅院內模型不支援圖片，請移除圖片或關閉「僅院內模型」")
    extra = {"kind": "chat", "agent_id": agent_id, "general": not chosen}  # general: rebuilt by general_agent() on approval
    if body.project_id and not existing.get("project_id"):  # only a conversation without a project can be filed
        own_project(body.project_id, user)
        extra["project_id"] = body.project_id
    # Chat always runs the live definition (published snapshot or the built-in assistant): production, never the sandbox.
    # Without this flag every connector write in chat was only simulated ("沙盒模擬") and the session was filed as a sandbox run.
    return dict(agent=agent, rag_files=rag_files, agent_id=agent_id, user=user, message=body.message, session_id=session_id,
                use_published=True, audit_action="chat.run",
                audit_extra={"model_group": body.model_group, "pinned_model": body.model or "", "web_search": (agent.capabilities.web_search if chosen else body.web_search), "knowledge_docs": len(doc_ids),
                             "attachments": len(existing.get("attachments") or []), "images": len(images)},
                extra_context=_attachment_context(existing) + (VOICE_HINT if body.voice else ""), session_extra=extra,
                pin_model=body.model, web_search=(agent.capabilities.web_search if chosen else body.web_search), images=images or None,
                message_images=chat_images.unsent_ids(existing))


@router.get("/agents/{agent_id}")
def agent_profile(agent_id: str, user: User = Depends(current_user)):
    """What a picked agent can do in chat: its introduction, the connector actions on its canvas and whether it has its own
    documents. The chat box shows exactly this (and nothing else) once the agent is chosen."""
    agent, rag_files = _agent_def(agent_id, user, use_published=True)
    cons, seen = [], set()
    pairs = [(str(n.data.get("connector_id") or ""), str(n.data.get("action") or "")) for n in agent.flow.nodes if n.type == "tool"]
    pairs += [(c.connector_id, c.action) for c in agent.capabilities.connectors]
    for cid, action in pairs:
        if not cid or (cid, action) in seen:
            continue
        seen.add((cid, action))
        snap = db.client().collection("connectors").document(cid).get()
        if not snap.exists:
            continue
        d = snap.to_dict() or {}
        spec = connectors_engine.TYPES.get(d.get("type", ""), {})
        acts = spec.get("actions")
        act = next((a for a in acts if a["id"] == action), None) if isinstance(acts, list) else None
        cons.append({"id": cid, "service": d.get("service") or d.get("type", ""), "label": d.get("label") or d.get("name") or spec.get("label") or d.get("type", ""),
                     "action": (act or {}).get("label") or action})
    dbs = [{"id": c["id"], "name": c.get("name", ""), "kind": c.get("kind", ""), "allowed": True}  # MVP: anyone using the agent
           for c in db_tools.connectors_for(agent.capabilities.db_connectors)]
    inputs = [{"id": st.id, "type": st.type, "title": st.title, "placeholder": st.config.get("placeholder", ""), "default": st.config.get("default", ""),
               "allow_override": st.config.get("allow_override", True), "required": st.config.get("required", True)}
              for st in agent.steps if st.enabled and st.type in ("text_input", "file_upload")]
    return {"id": agent_id, "name": agent.name, "description": agent.description, "icon": agent.icon, "opening_questions": agent.opening_questions,
            "connectors": cons, "databases": dbs, "web_search": agent.capabilities.web_search, "knowledge": bool(rag_files or agent.capabilities.spaces),
            "documents": len(agent.knowledge_doc_ids), "has_steps": bool(agent.steps), "inputs": inputs}


@router.post("", response_model=RunResponse)
def chat(body: ChatRequest, user: User = Depends(current_user), x_bigquery_auth: str | None = Header(None)):
    with bigquery.user_token(x_bigquery_auth):  # the user's own short-lived Google token, never stored
        return execute_run(**_prepare(body, user))


@router.post("/approve", response_model=RunResponse)
def chat_approve(body: ApproveRequest, user: User = Depends(current_user), x_bigquery_auth: str | None = Header(None)):
    """The person chatting confirms (approve) or cancels (reject) the action their conversation paused on: a connector write
    the agent's capability marks 需核准, e.g. creating a calendar event or a Google Doc on that user's own account. Owner-level
    pauses (a canvas approval node) still need the agent owner or an admin (403 here)."""
    sess_ref = db.client().collection("sessions").document(body.session_id)
    sess = sess_ref.get().to_dict()
    if not sess or sess.get("uid") != user.uid:
        raise HTTPException(404, "session not found")
    pending = sess.get("pending")
    if not pending:
        raise HTTPException(409, "nothing is waiting for approval in this session")
    agent_id = str(pending.get("agent_id") or sess.get("agent_id") or "")
    agent_def = None
    if sess.get("general") or agent_id == BUILTIN_ID:  # general chat: no stored definition to load; rebuild it the same way the turn did
        agent, agent_id, rag_files = general_agent(user)
        agent_def, agent_data = (agent, rag_files), {}
    else:
        snap = db.client().collection("agents").document(agent_id).get() if agent_id else None
        if snap is None or not snap.exists:
            raise HTTPException(404, "agent not found")
        agent_data = snap.to_dict() or {}
    if not can_decide(agent_data, sess, user):
        raise HTTPException(403, "此動作需要 Agent 負責人或管理員核准")
    return decide_pending(agent_id, sess_ref, sess, user, body.approve, x_bigquery_auth, agent_def=agent_def)


def _sse(event: dict) -> bytes:
    return f"event: {event['event']}\ndata: {json.dumps(event, ensure_ascii=False, default=str)}\n\n".encode()


@router.post("/stream")
async def chat_stream(body: ChatRequest, user: User = Depends(current_user), x_bigquery_auth: str | None = Header(None)):
    kwargs = await run_in_threadpool(_prepare, body, user)  # validation errors are plain HTTP errors, before the stream opens
    events: queue.Queue = queue.Queue()
    stop = threading.Event()  # set when the client closes the stream (停止, a new chat, a closed tab)
    draft, steps = {"text": ""}, []

    def emit(ev: dict) -> None:
        """Feeds the stream and keeps the answer so far (the same rules as the browser's reduceRun)."""
        if stop.is_set():
            raise RunStopped(draft["text"], steps)
        kind = ev.get("event")
        if kind == "step_start" and ev.get("type") == "turn":
            draft["text"] = ""
        elif kind == "delta" and ev.get("kind") != "thought":
            draft["text"] += ev.get("text", "")
        elif kind == "step_skip":  # a turn that ended in tool calls was a decision, not the answer
            draft["text"] = ""
        elif kind == "step_done":
            steps.append(StepTrace(**ev["step"]))
        events.put(ev)

    def work():
        try:
            with bigquery.user_token(x_bigquery_auth):
                r = execute_run(**kwargs, emit=emit)
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
        try:
            yield b": open\n\n"
            yield _sse({"event": "session", "session_id": kwargs["session_id"]})  # so a stopped first turn still belongs to this chat
            while (item := await asyncio.to_thread(events.get)) is not None:
                yield _sse(item)
        finally:  # the client went away (or the run finished): stop at the next token or step
            stop.set()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@router.post("/attachments", response_model=AttachmentOut)
async def add_attachment(file: UploadFile = File(...), session_id: str | None = Form(None), user: User = Depends(current_user)):
    """Extract text from an upload (same types and MAX_UPLOAD_MB limit as the knowledge library), de-identify it,
    store the masked text on the session (created if session_id is omitted) and return a snippet."""
    if Path(file.filename or "").suffix.lower() in IMAGE_SUFFIXES:
        return await _add_image(file, session_id, user)
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


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp"}


async def _add_image(file: UploadFile, session_id: str | None, user: User) -> AttachmentOut:
    """A pasted / picked image: type checked from its bytes, personal data blacked out (fail closed), only that copy kept."""
    name = Path(file.filename or "image.png").name
    data = await file.read()
    if len(data) > deid.MAX_IMAGE_BYTES:
        raise HTTPException(413, f"image exceeds {deid.MAX_IMAGE_BYTES // 1_000_000} MB")
    mime = chat_images.sniff(data)
    if not mime:
        raise HTTPException(415, "unsupported image; use PNG, JPEG or BMP")
    sid = session_id or uuid.uuid4().hex
    ref = db.client().collection("sessions").document(sid)
    sess = ref.get().to_dict() or {"agent_id": "", "uid": user.uid, "messages": [], "created_at": db.now(), "kind": "chat"}
    if sess.get("uid") != user.uid:
        raise HTTPException(403, "not your session")
    atts = sess.get("attachments") or []
    if len(atts) >= MAX_ATTACHMENTS or sum(1 for a in atts if a.get("kind") == "image") >= chat_images.MAX_IMAGES:
        raise HTTPException(409, f"at most {chat_images.MAX_IMAGES} images per conversation")
    try:
        aid, path = await run_in_threadpool(chat_images.save, user.uid, sid, data, mime)
    except Exception as exc:  # noqa: BLE001 - redaction failed: nothing is stored and nothing reaches a model
        log.exception("image redaction failed")
        raise HTTPException(502, "圖片的個資遮蔽失敗，未上傳；請稍後再試") from exc
    sess["attachments"] = [*atts, {"id": aid, "name": name, "chars": 0, "kind": "image", "mime": mime, "blob": path, "text": "", "at": db.now(),
                                "msg_at": len(sess.get("messages") or [])}]  # sent with the next user message
    sess["updated_at"] = db.now()
    sess["expire_at"] = db.expiry(settings().session_retention_days)
    ref.set(sess)
    db.audit(user.uid, "chat.attach_image", user.email, session_id=sid, file=name, bytes=len(data))
    return AttachmentOut(session_id=sid, attachment_id=aid, name=name, chars=0, snippet="", kind="image")


@router.get("/attachments/{session_id}/{att_id}/image")
def attachment_image(session_id: str, att_id: str, user: User = Depends(current_user)):
    """The stored (redacted) copy of one of the caller's own images, for the thumbnail (also in a reopened conversation).
    Same rule as GET /api/sessions/{id}: owner only, 404 otherwise. 410 when the image was removed or has expired.
    There is no unredacted original to return: only the redacted copy was ever stored."""
    sess = db.client().collection("sessions").document(session_id).get().to_dict() or {}
    if not sess or sess.get("uid") != user.uid:
        raise HTTPException(404, "image not found")
    att = next((a for a in sess.get("attachments") or [] if a.get("id") == att_id and a.get("kind") == "image"), None)
    if not att:
        if any(att_id in (m.get("images") or []) for m in sess.get("messages") or []):
            raise HTTPException(410, "image expired")
        raise HTTPException(404, "image not found")
    try:
        data = chat_images.load(att["blob"])
    except chat_images.Gone as exc:
        raise HTTPException(410, "image expired") from exc
    return Response(data, media_type=att.get("mime", "image/png"), headers={"Cache-Control": "private, max-age=300"})


@router.delete("/attachments/{session_id}/{att_id}", status_code=204)
def remove_attachment(session_id: str, att_id: str, user: User = Depends(current_user)):
    ref = db.client().collection("sessions").document(session_id)
    sess = ref.get().to_dict() or {}
    atts = sess.get("attachments") or []
    att = next((a for a in atts if a.get("id") == att_id), None)
    if not att or sess.get("uid") != user.uid:
        raise HTTPException(404, "attachment not found")
    if sess.get("locked"):
        raise HTTPException(409, "conversation is locked")
    ref.update({"attachments": [a for a in atts if a.get("id") != att_id]})
    if att.get("blob"):
        chat_images.delete([att["blob"]])
    db.audit(user.uid, "chat.attach_remove", user.email, session_id=session_id, attachment_id=att_id)


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
