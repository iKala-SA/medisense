"""Runs of an agent's step flow (PRD §7, §10): start a run, read it, approve a paused action, upload an input file.
A run belongs to the person who started it; only they (and nobody else, admins included) can read it."""
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from .. import db
from ..auth import User, current_user
from ..config import settings
from ..engine import steps as step_engine
from ..engine.capabilities import rag_files_for
from ..engine.extract import NoTextError, extract_text
from ..schemas import StepRunApproveIn, StepRunIn
from .knowledge import _read_upload
from .runs import _agent_def

router = APIRouter(tags=["step-runs"])
MAX_FILE_CHARS = 100_000


def _col():
    return db.client().collection("step_runs")


def _public(doc_id: str, d: dict) -> dict:
    return {"id": doc_id, **{k: v for k, v in d.items() if k not in ("uid", "expire_at")}}


def _own(run_id: str, user: User):
    snap = _col().document(run_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("uid") != user.uid:
        raise HTTPException(404, "run not found")
    return snap


def _saver(ref, base: dict):
    def save(run: dict) -> None:
        ref.set({**base, **run, "updated_at": db.now()})
    return save


@router.post("/api/agents/{agent_id}/step-runs")
def start_run(agent_id: str, body: StepRunIn, user: User = Depends(current_user)):
    agent, rag_files = _agent_def(agent_id, user, use_published=body.use_published, version=body.version)
    rag_files = rag_files_for(agent, user, rag_files)
    if not agent.steps:
        raise HTTPException(409, "這個 Agent 沒有 Step 流程，請直接在對話中使用")
    problems = [p["message"] for p in step_engine.validate_steps(agent.steps) if p["level"] == "error"]
    if problems:
        raise HTTPException(422, "Step 流程有錯誤：" + "；".join(problems))
    ref = _col().document(uuid.uuid4().hex)
    base = {"uid": user.uid, "agent_id": agent_id, "agent_name": agent.name, "trigger": "manual", "triggered_by": user.email,
            "draft": not body.use_published, "started_at": step_engine.now_iso(), "expire_at": db.expiry(settings().session_retention_days)}
    run = {"status": "running", "inputs": body.inputs, "steps": []}
    save = _saver(ref, base)
    save(run)
    db.audit(user.uid, "step_run.start", user.email, agent_id=agent_id, run_id=ref.id, draft=base["draft"])
    out = step_engine.run_steps(agent, agent_id=agent_id, user=user, run=run, rag_files=rag_files, save=save)
    out["ended_at"] = step_engine.now_iso() if out["status"] != "waiting_approval" else None
    save(out)
    return _public(ref.id, {**base, **out})


@router.get("/api/agents/{agent_id}/step-runs")
def list_runs(agent_id: str, user: User = Depends(current_user)):
    from google.cloud import firestore
    q = (_col().where(filter=firestore.FieldFilter("uid", "==", user.uid)).where(filter=firestore.FieldFilter("agent_id", "==", agent_id)))
    rows = [(d.id, d.to_dict() or {}) for d in q.stream()]
    rows.sort(key=lambda r: str(r[1].get("started_at", "")), reverse=True)
    return [{k: v for k, v in _public(i, d).items() if k not in ("steps", "inputs")} for i, d in rows[:50]]


@router.get("/api/step-runs/{run_id}")
def get_run(run_id: str, user: User = Depends(current_user)):
    snap = _own(run_id, user)
    return _public(snap.id, snap.to_dict() or {})


@router.post("/api/step-runs/{run_id}/approve")
def approve(run_id: str, body: StepRunApproveIn, user: User = Depends(current_user)):
    snap = _own(run_id, user)
    d = snap.to_dict() or {}
    if d.get("status") != "waiting_approval" or not d.get("pending"):
        raise HTTPException(409, "這個執行沒有等待核准的動作")
    agent_id = d["agent_id"]
    agent, rag_files = _agent_def(agent_id, user, use_published=not d.get("draft"))
    rag_files = rag_files_for(agent, user, rag_files)
    pending = d["pending"]
    db.audit(user.uid, "step_run.approve" if body.approve else "step_run.reject", user.email, run_id=run_id, step_id=pending["step_id"],
             connector_id=pending.get("connector_id"), connector_action=pending.get("action"))
    save = _saver(snap.reference, {k: v for k, v in d.items() if k not in ("steps", "status", "pending", "inputs", "result", "error", "ended_at")})
    run = {k: d[k] for k in ("inputs", "steps") if k in d} | {"status": "running", "pending": pending}
    if not body.approve:
        rec = next(r for r in run["steps"] if r["step_id"] == pending["step_id"])
        rec["status"] = "cancelled"
        run.update(status="cancelled", pending=None, error="你拒絕了這個動作", ended_at=step_engine.now_iso())
        save(run)
        return _public(snap.id, {**d, **run})
    out = step_engine.run_steps(agent, agent_id=agent_id, user=user, run=run, rag_files=rag_files, save=save, approved=pending)
    out["ended_at"] = step_engine.now_iso() if out["status"] != "waiting_approval" else None
    save(out)
    return _public(snap.id, {**d, **out})


@router.post("/api/agents/{agent_id}/run-files")
async def upload_run_file(agent_id: str, file: UploadFile = File(...), user: User = Depends(current_user)):
    """An input file for a file_upload step: text extracted and de-identified now; the original is not kept."""
    filename, suffix, data = await _read_upload(file)
    try:
        raw = await run_in_threadpool(extract_text, data, suffix)
    except NoTextError as exc:
        raise HTTPException(422, str(exc)) from exc
    from ..engine import deid
    text = await run_in_threadpool(deid.deidentify, raw[:MAX_FILE_CHARS])
    fid = uuid.uuid4().hex
    db.client().collection("run_files").document(fid).set({"uid": user.uid, "agent_id": agent_id, "name": filename, "chars": len(text), "text": text,
                                                           "at": db.now(), "expire_at": db.expiry(settings().session_retention_days)})
    db.audit(user.uid, "step_run.file", user.email, agent_id=agent_id, file=filename, chars=len(text))
    return {"id": fid, "name": filename, "chars": len(text)}
