"""Schedules (schedules/{id}): run an agent with a fixed prompt on a calendar rhythm (Asia/Taipei).

ONE Cloud Scheduler job (infra/08-scheduler.sh) calls POST /api/schedules/tick every minute with the shared
secret in `X-Scheduler-Token`; tick runs every enabled schedule that is due in that minute. A run executes as the
schedule's OWNER (same role / visibility checks as runs.py, published version only), stores a normal chat session
owned by that person and audits `schedule.run`. Double delivery of a tick is harmless: a lock document
(schedule_locks/{id}_{slot}) is created atomically before each run.
"""
import hmac
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore

from .. import db, sharing
from ..auth import User, current_user, effective_role
from ..config import settings
from ..engine.usage import TZ
from ..schemas import EnabledPatch, ScheduleIn, ScheduleOut, ScheduleRunResult, Share, TickResult
from .agents import load_visible
from .runs import _agent_def, execute_run

router = APIRouter(prefix="/api/schedules", tags=["schedules"])
TICK_WORKERS = 4


def slot_of(now: datetime) -> str:
    return now.astimezone(TZ).strftime("%Y-%m-%dT%H:%M")


def is_due(sched: dict, now: datetime) -> bool:
    """True when `sched` is enabled and its frequency + HH:MM match the Asia/Taipei minute of `now`."""
    if not sched.get("enabled", True):
        return False
    local = now.astimezone(TZ)
    if sched.get("time") != local.strftime("%H:%M"):
        return False
    freq = sched.get("frequency")
    if freq == "daily":
        return True
    if freq == "weekdays":
        return local.weekday() < 5
    if freq == "weekly_mon":
        return local.weekday() == 0
    if freq == "monthly_1":
        return local.day == 1
    return False


def _col():
    return db.client().collection("schedules")


def _out(doc, user: User, groups: set[str] | None = None) -> ScheduleOut:
    d = doc.to_dict() or {}
    return ScheduleOut(id=doc.id, my_role=sharing.my_role(user, d, groups), **d)


def _load(sid: str):
    snap = _col().document(sid).get()
    if not snap.exists:
        raise HTTPException(404, "schedule not found")
    return snap


def _load_viewable(sid: str, user: User):
    snap = _load(sid)
    if not sharing.can_view(user, snap.to_dict() or {}):
        raise HTTPException(403, "schedule is not shared with you")
    return snap


def _load_editable(sid: str, user: User):
    snap = _load(sid)
    if not sharing.can_edit(user, snap.to_dict() or {}):
        raise HTTPException(403, "you cannot edit this schedule")
    return snap


def _owner(data: dict) -> User:
    """The schedule owner as a User, from their current account record (role may have changed since)."""
    email = str(data.get("owner_email", "")).lower()
    snap = db.client().collection("users").document(email).get()
    acct = snap.to_dict() if snap.exists else None
    if not acct:
        raise HTTPException(403, "schedule owner has no account")
    if acct.get("status") == "suspended":
        raise HTTPException(403, "schedule owner is suspended")
    return User(uid=data.get("owner_uid", ""), email=email, name=acct.get("name", email),
                role=effective_role({**acct, "email": email}), department=acct.get("department", ""))


def run_schedule(sid: str, data: dict, *, triggered_by: str, slot: str | None = None) -> ScheduleRunResult:
    """Run one schedule as its owner and record last_run. Never raises: failures become status 'error'."""
    session_id, error = "", ""
    owner_uid, owner_email = data.get("owner_uid", ""), data.get("owner_email", "")
    try:
        owner = _owner(data)
        agent, rag_files = _agent_def(data["agent_id"], owner, use_published=True)
        res = execute_run(agent, rag_files, data["agent_id"], owner, data["prompt"], None, use_published=True,
                          audit_action="schedule.run", title=f"[排程] {data.get('name', '')}"[:30],
                          audit_extra={"schedule_id": sid, "triggered_by": triggered_by, "ok": True})
        session_id = res.session_id
    except HTTPException as exc:
        error = f"{exc.status_code}: {exc.detail}"[:300]
    except Exception as exc:  # noqa: BLE001 - one broken schedule must not stop the tick
        error = f"{exc.__class__.__name__}: {exc}"[:300]
    status = "error" if error else "ok"
    if error:
        db.audit(owner_uid, "schedule.run", owner_email, schedule_id=sid, agent_id=data.get("agent_id", ""),
                 triggered_by=triggered_by, ok=False, error=error)
    update = {"last_run": {"at": db.now(), "status": status, "session_id": session_id, "error": error}}
    if slot:
        update["last_slot"] = slot
    try:
        _col().document(sid).update(update)
    except Exception:  # noqa: BLE001 - schedule deleted mid-run
        pass
    return ScheduleRunResult(schedule_id=sid, status=status, session_id=session_id, error=error)


@router.post("/tick", response_model=TickResult)
def tick(x_scheduler_token: str = Header("", alias="X-Scheduler-Token")):
    """Cloud Scheduler entry point (no Firebase token; shared secret instead). Runs every enabled schedule
    due in the current Asia/Taipei minute."""
    token = settings().scheduler_token
    if not token:
        raise HTTPException(503, "scheduler disabled: SCHEDULER_TOKEN is not configured")
    if not hmac.compare_digest(x_scheduler_token.encode(), token.encode()):
        raise HTTPException(401, "invalid scheduler token")
    now = db.now()
    slot = slot_of(now)
    enabled = list(_col().where(filter=firestore.FieldFilter("enabled", "==", True)).stream())
    due = [(d.id, d.to_dict() or {}) for d in enabled if is_due(d.to_dict() or {}, now)]
    claimed: list[tuple[str, dict]] = []
    for sid, data in due:
        try:  # atomic claim: a second tick in the same minute (retry / duplicate delivery) loses
            db.client().collection("schedule_locks").document(f"{sid}_{slot}").create({"at": now, "schedule_id": sid})
            claimed.append((sid, data))
        except AlreadyExists:
            continue
    with ThreadPoolExecutor(max_workers=TICK_WORKERS) as pool:
        results = list(pool.map(lambda x: run_schedule(x[0], x[1], triggered_by="scheduler", slot=slot), claimed))
    return TickResult(slot=slot, checked=len(enabled), due=len(due), results=results)


@router.get("", response_model=list[ScheduleOut])
def list_schedules(user: User = Depends(current_user)):
    groups = sharing.group_ids_of(user.email)
    rows = [_out(d, user, groups) for d in sharing.visible_docs("schedules", user).values()]
    return sorted(rows, key=lambda s: str(s.created_at or ""), reverse=True)


@router.post("", response_model=ScheduleOut, status_code=201)
def create_schedule(body: ScheduleIn, user: User = Depends(current_user)):
    load_visible(body.agent_id, user)  # 404 / 403 unless the caller may use that agent
    ref = _col().document()
    data = {**body.model_dump(), **sharing.share_fields(Share()), "last_run": None, "owner_uid": user.uid,
            "owner_email": user.email, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    db.audit(user.uid, "schedule.create", user.email, schedule_id=ref.id, agent_id=body.agent_id, name=body.name)
    return _out(ref.get(), user)


@router.get("/{sid}", response_model=ScheduleOut)
def get_schedule(sid: str, user: User = Depends(current_user)):
    return _out(_load_viewable(sid, user), user)


@router.put("/{sid}", response_model=ScheduleOut)
def update_schedule(sid: str, body: ScheduleIn, user: User = Depends(current_user)):
    snap = _load_editable(sid, user)
    load_visible(body.agent_id, user)
    snap.reference.update({**body.model_dump(), "updated_at": db.now()})
    db.audit(user.uid, "schedule.update", user.email, schedule_id=sid, agent_id=body.agent_id, name=body.name)
    return _out(snap.reference.get(), user)


@router.patch("/{sid}/enabled", response_model=ScheduleOut)
def set_enabled(sid: str, body: EnabledPatch, user: User = Depends(current_user)):
    snap = _load_editable(sid, user)
    snap.reference.update({"enabled": body.enabled, "updated_at": db.now()})
    db.audit(user.uid, "schedule.enable" if body.enabled else "schedule.disable", user.email, schedule_id=sid)
    return _out(snap.reference.get(), user)


@router.post("/{sid}/run-now", response_model=ScheduleRunResult)
def run_now(sid: str, user: User = Depends(current_user)):
    """Run now, as the schedule's owner (their role decides what the agent may do). Needs edit rights."""
    snap = _load_editable(sid, user)
    return run_schedule(sid, snap.to_dict() or {}, triggered_by=user.email)


@router.put("/{sid}/share", response_model=ScheduleOut)
def share_schedule(sid: str, body: Share, user: User = Depends(current_user)):
    snap = _load(sid)
    if not sharing.can_manage(user, snap.to_dict() or {}):
        raise HTTPException(403, "only the owner or an admin can change sharing")
    snap.reference.update({**sharing.share_fields(sharing.validate_share(body)), "updated_at": db.now()})
    db.audit(user.uid, "schedule.share", user.email, schedule_id=sid, access=body.access, members=len(body.members))
    return _out(snap.reference.get(), user)


@router.delete("/{sid}", status_code=204)
def delete_schedule(sid: str, user: User = Depends(current_user)):
    snap = _load(sid)
    if not sharing.can_manage(user, snap.to_dict() or {}):
        raise HTTPException(403, "only the owner or an admin can delete this schedule")
    snap.reference.delete()
    db.audit(user.uid, "schedule.delete", user.email, schedule_id=sid, name=(snap.to_dict() or {}).get("name", ""))
