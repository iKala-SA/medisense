"""The signed-in user's own Google Calendar (read-only), for the workbench. Uses the first per-user calendar connector the
user can see and has connected; the data never goes to a model from here, so no de-identification step is needed."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db, sharing
from ..auth import User, current_user
from ..engine import connectors as eng
from ..engine import open_connector as oc

router = APIRouter(prefix="/api/calendar", tags=["calendar"])
SERVICE = "googlecalendar"


def _connectors(user: User) -> list[tuple[str, dict]]:
    return sorted(((i, d.to_dict() or {}) for i, d in sharing.visible_docs("connectors", user).items()
                   if eng.connector_service(d.to_dict() or {}) == SERVICE and eng.connector_mode(d.to_dict() or {}) == "user_oauth"), key=lambda kv: kv[1].get("label", ""))


def _state(user: User) -> dict:
    """Which calendar connector would be used, and whether the user is connected to it."""
    cands = _connectors(user)
    if not cands:
        return {"connected": False, "connector_id": None, "account_label": "", "reason": "管理員尚未提供 Google Calendar 連接器"}
    try:
        mine = oc.connection(SERVICE, user.uid)
    except oc.OpenConnectorError as exc:
        reason = "尚未設定連接器閘道" if exc.code == "not_configured" else "暫時無法連到連接器閘道"
        return {"connected": False, "connector_id": cands[0][0], "account_label": "", "reason": reason}
    if mine and mine.get("status") == "active":
        return {"connected": True, "connector_id": cands[0][0], "account_label": mine.get("accountLabel", ""), "reason": ""}
    return {"connected": False, "connector_id": cands[0][0], "account_label": "", "reason": "尚未連線您的 Google 帳號"}


@router.get("/status")
def calendar_status(user: User = Depends(current_user)):
    return _state(user)


def _window(from_: str | None, to: str | None) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = from_ or now.replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    end = to or (now + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return start, end


def _require_connected(user: User) -> dict:
    st = _state(user)
    if not st["connected"]:
        raise HTTPException(409, st["reason"] or "尚未連線")
    return st


@router.get("/events")
def events(from_: str | None = Query(None, alias="from"), to: str | None = None, max_results: int = Query(50, ge=1, le=250, alias="max"),
           user: User = Depends(current_user)):
    st = _require_connected(user)
    start, end = _window(from_, to)
    try:
        items = oc.calendar_events(user.uid, start, end, max_results=max_results)
    except oc.OpenConnectorError as exc:
        raise (HTTPException(409, "尚未連線或授權已失效，請重新連線") if exc.not_connected else HTTPException(502, f"日曆閘道錯誤：{exc}")) from exc
    db.audit(user.uid, "calendar.read", user.email, connector_id=st["connector_id"], events=len(items))
    return {"events": items, "account_label": st["account_label"], "from": start, "to": end}


@router.get("/freebusy")
def freebusy(from_: str | None = Query(None, alias="from"), to: str | None = None, user: User = Depends(current_user)):
    st = _require_connected(user)
    start, end = _window(from_, to)
    try:
        busy = oc.calendar_busy(user.uid, start, end)
    except oc.OpenConnectorError as exc:
        raise (HTTPException(409, "尚未連線或授權已失效，請重新連線") if exc.not_connected else HTTPException(502, f"日曆閘道錯誤：{exc}")) from exc
    return {"busy": busy, "account_label": st["account_label"], "from": start, "to": end}
