"""我的工作台: the signed-in user's AI brief (Gmail + Google Calendar) and their own to-do list.

The brief reads the user's own accounts through the Open Connector gateway (the same per-user grants as 連接器), then asks a
model what is urgent and what tomorrow's meetings need. Mail and event text is de-identified before it reaches the model, like
every other model input. Nothing read from the accounts is stored: the browser keeps the brief for the session and the
refresh button asks again. The model answers with item numbers, so the page shows the real subject / title next to its notes.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore
from pydantic import BaseModel, Field

from .. import db, sharing
from ..auth import User, current_user
from ..engine import connectors as eng
from ..engine import deid, limits, llm, usage
from ..engine import open_connector as oc
from ..schemas import AgentIn

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/workbench", tags=["workbench"])

AGENT_ID = "workbench-brief"
_AGENT = AgentIn(name="工作台摘要")
GROUP = "fast"
MAIL_QUERY = "in:inbox newer_than:3d"
MAX_MAILS = 25
SOURCES = {"gmail": "Gmail", "googlecalendar": "Google 日曆"}

SYSTEM = """你是醫院同仁的工作助理。根據使用者今天與明天的行事曆，以及最近的收件匣郵件，用繁體中文整理今天的重點。
資料中的 [PERSON_NAME] 之類的標記是去識別化後的代稱，照原樣使用即可，不要猜測真實內容。
只輸出一個 JSON 物件：
{"headline": "一句話總結今天最該注意的事（30 字內）",
 "urgent": [{"mail": 郵件編號, "why": "為什麼要儘快處理、建議怎麼做（40 字內）"}],
 "today": [{"event": 行程編號, "note": "需要留意的地方（30 字內，可省略為空字串）"}],
 "tomorrow": [{"event": 行程編號, "prep": "會前要準備什麼（40 字內）"}],
 "tips": ["其他提醒，最多 3 則"]}
規則：urgent 只放真的需要今天回覆或處理的郵件（截止日、主管或病人相關、會議變更、核准請求），最多 5 封，沒有就給空陣列；
電子報、廣告、系統通知不算緊急。today 只列今天還沒結束、值得提醒的行程。tomorrow 列明天每一個會議（全天的地點標記除外）。
編號一定要用資料裡給的編號。"""


# ------------------------------------------------------------------ connections
def _connector(user: User, service: str) -> tuple[str, dict] | None:
    """A per-user OAuth connector for `service` that this user can see (built-in calendar type or a gateway connector)."""
    rows = sorted(((i, d.to_dict() or {}) for i, d in sharing.visible_docs("connectors", user).items()), key=lambda kv: kv[1].get("label", ""))
    return next(((i, d) for i, d in rows if eng.connector_service(d) == service and eng.connector_mode(d) == "user_oauth"), None)


def _source_state(user: User, service: str, apps: list[dict] | None) -> dict:
    """{service, label, state, connector_id, account_label, reason}; state is connected | not_connected | reauth_required | unavailable."""
    base = {"service": service, "label": SOURCES[service], "connector_id": None, "account_label": "", "reason": ""}
    found = _connector(user, service)
    if not found:
        return {**base, "state": "unavailable", "reason": "管理員尚未提供這個連接器"}
    base["connector_id"] = found[0]
    if apps is None:
        return {**base, "state": "unavailable", "reason": "暫時無法連到連接器閘道"}
    mine = next((a for a in apps if a.get("service") == service and a.get("alias") == oc.conn_name(user.uid)), None)
    if not mine:
        return {**base, "state": "not_connected", "reason": "尚未連線您的帳號"}
    if mine.get("status") != "active":
        return {**base, "state": "reauth_required", "account_label": mine.get("accountLabel", ""), "reason": "授權已失效，請重新連線"}
    return {**base, "state": "connected", "account_label": mine.get("accountLabel", "")}


def _sources(user: User) -> dict[str, dict]:
    try:
        apps = oc.connected_apps()
    except oc.OpenConnectorError:
        apps = None
    return {s: _source_state(user, s, apps) for s in SOURCES}


def _gateway_failed(src: dict, exc: oc.OpenConnectorError) -> None:
    if exc.not_connected:
        src.update(state="reauth_required", reason="授權已失效，請重新連線")
    else:
        src.update(state="error", reason=f"讀取失敗：{str(exc)[:120]}")


# ------------------------------------------------------------------ reading the accounts
def _mails(uid: str) -> list[dict]:
    out = oc.execute("gmail.fetch_emails", {"query": MAIL_QUERY, "maxResults": MAX_MAILS, "detail": "summary"}, uid)
    items = out if isinstance(out, list) else (out or {}).get("messages") or (out or {}).get("emails") or []
    mails = []
    for m in items[:MAX_MAILS]:
        if not isinstance(m, dict):
            continue
        labels = m.get("labelIds") or []
        mails.append({"id": m.get("messageId") or m.get("id", ""), "thread_id": m.get("threadId", ""),
                      "subject": m.get("subject") or "（無主旨）", "from": m.get("sender") or m.get("from", ""),
                      "at": m.get("messageTimestamp") or m.get("date", ""), "snippet": (m.get("snippet") or "")[:300],
                      "unread": "UNREAD" in labels, "important": "IMPORTANT" in labels})
    return mails


def _parse(t: str) -> datetime | None:
    try:
        return datetime.fromisoformat(t.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _day_bounds(now: datetime) -> tuple[datetime, datetime, datetime]:
    """Start of today, start of tomorrow and end of tomorrow in the browser's own timezone (`now` carries its offset)."""
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return today, today + timedelta(days=1), today + timedelta(days=2)


def _is_office(e: dict) -> bool:
    return e.get("all_day") and (e.get("title") or "").strip().lower() == "office"


# ------------------------------------------------------------------ the brief
class BriefIn(BaseModel):
    now: str = Field(default="", max_length=40)  # the browser's local time with offset, e.g. 2026-11-04T15:20:00+08:00


def _when(e: dict, now: datetime) -> tuple[str, str]:
    """(今天 | 明天, time text) of an event in the browser's timezone. All-day events carry a plain date."""
    tomorrow = (now + timedelta(days=1)).date().isoformat()
    if e.get("all_day"):
        return ("明天" if (e.get("start") or "")[:10] >= tomorrow else "今天"), "全天"
    s, en = _parse(e.get("start", "")), _parse(e.get("end", ""))
    if not s or s.tzinfo is None:
        return "今天", (e.get("start") or "")[11:16]
    s = s.astimezone(now.tzinfo)
    span = s.strftime("%H:%M") + (f"–{en.astimezone(now.tzinfo).strftime('%H:%M')}" if en and en.tzinfo else "")
    return ("明天" if s.date().isoformat() >= tomorrow else "今天"), span


def _numbered(mails: list[dict], events: list[dict], now: datetime) -> str:
    """The de-identified text the model sees: numbered events (today / tomorrow) and mails."""
    rows = []
    for i, e in enumerate(events):
        day, span = _when(e, now)
        rows.append(f"[行程 {i}] {day} {span} {e['title']}" + (f"（地點：{e['location']}）" if e.get("location") else ""))
    rows += [f"[郵件 {i}] {'未讀 ' if m['unread'] else ''}{'重要 ' if m['important'] else ''}寄件者：{m['from']}｜主旨：{m['subject']}｜摘要：{m['snippet']}"
             for i, m in enumerate(mails)]
    return "\n".join(deid.deidentify_many(rows) if rows else [])


def _clean(data: dict, mails: list[dict], events: list[dict]) -> dict:
    """Keep only well-formed items whose number points at a real mail / event."""
    def pick(key: str, ref: str, pool: list, text: str) -> list[dict]:
        out, seen = [], set()
        for x in data.get(key) or []:
            if not isinstance(x, dict):
                continue
            try:
                n = int(x.get(ref))
            except (TypeError, ValueError):
                continue
            if 0 <= n < len(pool) and n not in seen:
                seen.add(n)
                out.append({ref: n, text: str(x.get(text) or "")[:200]})
        return out
    return {"headline": str(data.get("headline") or "")[:120],
            "urgent": pick("urgent", "mail", mails, "why")[:5],
            "today": pick("today", "event", events, "note"),
            "tomorrow": pick("tomorrow", "event", events, "prep"),
            "tips": [str(t)[:160] for t in (data.get("tips") or []) if isinstance(t, str) and t.strip()][:3]}


@router.post("/brief")
def brief(body: BriefIn, user: User = Depends(current_user)):
    """Read today's and tomorrow's calendar and recent mail, then summarise them. Each source reports its own state, so one
    expired grant still leaves the other in the brief."""
    now = _parse(body.now) or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today, _, end = _day_bounds(now)
    sources = _sources(user)

    events: list[dict] = []
    cal = sources["googlecalendar"]
    if cal["state"] == "connected":
        try:
            events = [e for e in oc.calendar_events(user.uid, today.isoformat(), end.isoformat(), max_results=60)
                      if e.get("status") != "cancelled" and not _is_office(e)]
            cal["count"] = len(events)
        except oc.OpenConnectorError as exc:
            _gateway_failed(cal, exc)
    mails: list[dict] = []
    gm = sources["gmail"]
    if gm["state"] == "connected":
        try:
            mails = _mails(user.uid)
            gm["count"] = len(mails)
        except oc.OpenConnectorError as exc:
            _gateway_failed(gm, exc)

    result = {"generated_at": db.now().isoformat(), "sources": list(sources.values()), "mails": mails, "events": events,
              "summary": None, "model": ""}
    if not mails and not events:
        db.audit(user.uid, "workbench.brief", user.email, mails=0, events=0, summarized=False)
        return result

    try:
        limits.check(user.uid, GROUP)
    except limits.LimitExceeded as exc:
        raise HTTPException(429, str(exc)) from exc
    text = _numbered(mails, events, now)
    ask = f"現在是 {now.strftime('%Y-%m-%d %H:%M')}（使用者當地時間）。\n\n{text}"
    try:
        c = llm.complete(group=GROUP, system=SYSTEM, messages=[{"role": "user", "content": ask}], agent_id=AGENT_ID,
                         user_id=user.uid, temperature=0.2, json_mode=True)
    except Exception as exc:
        usage.record(agent=_AGENT, agent_id=AGENT_ID, user_id=user.uid, group=GROUP, model=GROUP, prompt_tokens=0,
                     completion_tokens=0, cost_usd=0.0, ms=0, ok=False, fallback=False)
        log.exception("workbench brief failed")
        raise HTTPException(502, "AI 摘要暫時無法產生，請稍後再試") from exc
    usage.record(agent=_AGENT, agent_id=AGENT_ID, user_id=user.uid, group=GROUP, model=c.model, prompt_tokens=c.prompt_tokens,
                 completion_tokens=c.completion_tokens, cost_usd=c.cost_usd, ms=c.ms, ok=True, fallback=False)
    try:
        raw = c.text.strip()
        data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    except ValueError:
        data = {}
    result["summary"], result["model"] = _clean(data if isinstance(data, dict) else {}, mails, events), c.model
    db.audit(user.uid, "workbench.brief", user.email, mails=len(mails), events=len(events), summarized=True)
    return result


@router.get("/sources")
def sources(user: User = Depends(current_user)):
    """Connection state of the brief's sources, without reading any mail or event."""
    return list(_sources(user).values())


# ------------------------------------------------------------------ to-dos (the user's own)
class TodoIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    due: str = Field(default="", max_length=10)  # YYYY-MM-DD or ""


class TodoPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=200)
    due: str | None = Field(default=None, max_length=10)
    done: bool | None = None


def _todo(snap) -> dict:
    d = snap.to_dict() or {}
    created = d.get("created_at")
    return {"id": snap.id, "text": d.get("text", ""), "due": d.get("due", ""), "done": bool(d.get("done")),
            "created_at": created.isoformat() if hasattr(created, "isoformat") else created}


def _own(todo_id: str, user: User):
    ref = db.client().collection("todos").document(todo_id)
    snap = ref.get()
    if not snap.exists or (snap.to_dict() or {}).get("uid") != user.uid:
        raise HTTPException(404, "找不到這個待辦")
    return ref


@router.get("/todos")
def list_todos(user: User = Depends(current_user)):
    q = db.client().collection("todos").where(filter=firestore.FieldFilter("uid", "==", user.uid))
    rows = [_todo(s) for s in q.stream()]
    # open first (by due date, undated last), then done; newest first within a tie
    rows.sort(key=lambda t: str(t["created_at"] or ""), reverse=True)
    return sorted(rows, key=lambda t: (t["done"], t["due"] or "9999"))


@router.post("/todos", status_code=201)
def add_todo(body: TodoIn, user: User = Depends(current_user)):
    ref = db.client().collection("todos").document()
    ref.set({"uid": user.uid, "text": body.text.strip(), "due": body.due, "done": False, "created_at": db.now()})
    return _todo(ref.get())


@router.patch("/todos/{todo_id}")
def update_todo(todo_id: str, body: TodoPatch, user: User = Depends(current_user)):
    ref = _own(todo_id, user)
    patch = {k: (v.strip() if isinstance(v, str) and k == "text" else v) for k, v in body.model_dump(exclude_none=True).items()}
    if patch:
        ref.update(patch)
    return _todo(ref.get())


@router.delete("/todos/{todo_id}", status_code=204)
def delete_todo(todo_id: str, user: User = Depends(current_user)):
    _own(todo_id, user).delete()
