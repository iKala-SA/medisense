"""Audit trail (design: 資安審計與操作軌跡日誌). Admin-only, like the monitoring dashboard.

Read side only: category, severity, target and department are derived when reading, from the
action name, the existing `ok` / ids in the doc, and a join to `agents` / `connectors`. Firestore
filters only on the `at` window (single-field index). Category / severity / department /
search are applied here while streaming, with a scan cap per request, so no new composite
indexes are needed.
"""
import csv
import io
import json
from collections import Counter
from collections.abc import Callable, Iterator
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from google.cloud import firestore

from .. import db
from ..auth import User, require_admin
from ..engine.usage import TZ, day_key
from ..schemas import AuditCount, AuditEntry, AuditPage, AuditSummary

router = APIRouter(prefix="/api/audit", tags=["audit"], dependencies=[Depends(require_admin)])
_CORE = {"actor", "actor_email", "action", "at"}

SCAN_CAP = 3000  # docs read per list request before giving up on filling a page
EXPORT_ROWS = 5000
EXPORT_SCAN_CAP = 20000
SUMMARY_CAP = 50000  # today's events read for the KPI tiles

CATEGORY = {
    "agent.run": "inference", "agent.approve": "inference", "agent.reject": "inference",
    "connector.invoke": "connector", "connector.test": "connector",
    "agent.create": "build", "agent.update": "build", "agent.publish": "build", "agent.unpublish": "build",
    "agent.publish_request": "build", "agent.publish_withdraw": "build", "agent.publish_approve": "build",
    "agent.publish_reject": "build",
    "agent.delete": "build", "knowledge.upload": "build", "knowledge.delete": "build", "knowledge.error": "build", "knowledge.reindex": "build", "knowledge.replace": "build",
    "knowledge.update": "build",
    # Credentials live in Secret Manager behind connector writes; exports take data out of the platform.
    "connector.create": "access", "connector.update": "access", "connector.delete": "access",
    "monitoring.export": "access", "audit.export": "access", "users.export": "access",
    # Accounts & access (routers/users.py): role / status changes and pre-registrations.
    "user.first_login": "access", "user.preregister": "access", "user.preregister_cancel": "access", "user.role": "access",
    "user.suspend": "access", "user.reactivate": "access", "user.update": "access",
    # Sharing, skills, schedules, spaces, routing + model registry, chat (added with the Medisense integration).
    "agent.share": "access", "group.create": "access", "group.update": "access", "group.delete": "access",
    "skill.share": "access", "schedule.share": "access", "space.share": "access",
    "skill.create": "build", "skill.update": "build", "skill.delete": "build", "skill.enable": "build", "skill.disable": "build",
    "schedule.create": "build", "schedule.update": "build", "schedule.delete": "build", "schedule.enable": "build",
    "schedule.disable": "build", "schedule.run": "inference",
    "space.create": "build", "space.update": "build", "space.delete": "build", "space.documents": "build",
    "routing.update": "build", "model.create": "build", "model.update": "build", "model.delete": "build", "model.apply": "build",
    "chat.run": "inference", "chat.attach": "inference", "session.update": "inference", "session.delete": "inference",
}
CATEGORIES = {"inference", "connector", "build", "access", "other"}
SEVERITIES = {"info", "success", "warning"}
_WARN_ACTIONS = {"knowledge.error", "agent.reject", "agent.publish_reject", "user.suspend"}
_SUCCESS_ACTIONS = {"agent.publish", "agent.approve", "agent.publish_approve", "user.reactivate"}
_SYSTEM_TARGET = {"monitoring.export": "監控成本報表", "audit.export": "稽核報表", "users.export": "帳號清冊"}


def category_of(action: str) -> str:
    return CATEGORY.get(action, "other")


def severity_of(action: str, r: dict) -> str:
    if r.get("ok") is False or action in _WARN_ACTIONS:
        return "warning"
    if r.get("ok") is True or action in _SUCCESS_ACTIONS:
        return "success"
    return "info"


class _Lookups:
    """Agent / connector names, loaded once per request and only if a row needs them."""

    def __init__(self) -> None:
        self._agents: dict[str, dict] | None = None
        self._connectors: dict[str, dict] | None = None

    def agent(self, agent_id: str) -> dict:
        if self._agents is None:
            self._agents = {d.id: d.to_dict() or {} for d in
                            db.client().collection("agents").select(["name", "department"]).stream()}
        return self._agents.get(agent_id, {})

    def connector(self, connector_id: str) -> dict:
        if self._connectors is None:
            self._connectors = {d.id: d.to_dict() or {} for d in
                                db.client().collection("connectors").select(["label", "type"]).stream()}
        return self._connectors.get(connector_id, {})


def _entry(doc_id: str, r: dict, lk: _Lookups) -> AuditEntry:
    action = r.get("action", "")
    details = {k: v for k, v in r.items() if k not in _CORE}
    agent_id, connector_id = str(details.get("agent_id") or ""), str(details.get("connector_id") or "")
    agent = lk.agent(agent_id) if agent_id else {}
    # Deleted agents are gone from `agents`; agent.create keeps the name it was created with.
    agent_label = str(agent.get("name") or details.get("name") or agent_id) if agent_id else ""
    kind, tid, label = "", "", ""
    if action.startswith("connector.") and connector_id:
        conn = lk.connector(connector_id)
        kind, tid, label = "connector", connector_id, conn.get("label") or details.get("label") or connector_id
    elif agent_id:
        kind, tid, label = "agent", agent_id, agent_label
    elif action.startswith("knowledge.") and details.get("doc_id"):
        kind, tid, label = "document", str(details["doc_id"]), details.get("file") or details["doc_id"]
    elif action.startswith("user.") and details.get("target_email"):
        kind, tid, label = "user", str(details["target_email"]), str(details["target_email"])
    elif action in _SYSTEM_TARGET:
        kind, label = "system", _SYSTEM_TARGET[action]
    return AuditEntry(id=doc_id, actor=r.get("actor", ""), actor_email=r.get("actor_email", ""), action=action,
                      at=r.get("at"), category=category_of(action), severity=severity_of(action, r),
                      target_kind=kind, target_id=tid, target_label=str(label), agent_label=agent_label,
                      department=agent.get("department", ""),
                      details=details)


def _window(frm: str | None, to: str | None) -> tuple[datetime, datetime, date, date]:
    today = date.fromisoformat(day_key())
    try:
        d_to = date.fromisoformat(to) if to else today
        d_from = date.fromisoformat(frm) if frm else d_to - timedelta(days=6)
    except ValueError as exc:
        raise HTTPException(422, "dates must be YYYY-MM-DD") from exc
    if d_from > d_to:
        raise HTTPException(422, "from must be <= to")
    if (d_to - d_from).days > 366:
        raise HTTPException(422, "range too large (max 366 days)")
    start = datetime.combine(d_from, time.min, TZ)
    return start, datetime.combine(d_to + timedelta(days=1), time.min, TZ), d_from, d_to


def _between(start: datetime, end: datetime):
    return (db.client().collection("audit").where(filter=firestore.FieldFilter("at", ">=", start))
            .where(filter=firestore.FieldFilter("at", "<", end)))


def _matcher(cat: str, sev: str, department: str, q: str) -> Callable[[AuditEntry], bool]:
    if cat and cat != "alerts" and cat not in CATEGORIES:
        raise HTTPException(422, f"unknown category {cat}")
    if sev and sev not in SEVERITIES:
        raise HTTPException(422, f"unknown severity {sev}")
    needle = q.strip().lower()

    def match(e: AuditEntry) -> bool:
        if cat == "alerts" and e.severity != "warning":
            return False
        if cat and cat != "alerts" and e.category != cat:
            return False
        if (sev and e.severity != sev) or (department and e.department != department):
            return False
        if needle:
            hay = " ".join([e.id, e.actor_email, e.action, e.target_id, e.target_label, e.agent_label, e.department,
                            *(json.dumps(v, ensure_ascii=False, default=str) if isinstance(v, list | dict) else str(v)
                              for v in e.details.values())]).lower()
            return needle in hay
        return True
    return match


def _scan(frm: str | None, to: str | None, cursor: str | None, cap: int) -> Iterator[tuple[str, dict]]:
    start, end, _, _ = _window(frm, to)
    query = _between(start, end).order_by("at", direction=firestore.Query.DESCENDING)
    if cursor:
        snap = db.client().collection("audit").document(cursor).get()
        if not snap.exists:
            raise HTTPException(422, "invalid cursor")
        query = query.start_after(snap)
    for d in query.limit(cap).stream():
        yield d.id, d.to_dict() or {}


@router.get("", response_model=AuditPage)
def list_audit(frm: str | None = Query(None, alias="from"), to: str | None = None, category: str = "",
               severity: str = "", department: str = "", q: str = "", cursor: str | None = None,
               limit: int = Query(25, ge=1, le=100)):
    match, lk = _matcher(category, severity, department, q), _Lookups()
    items: list[AuditEntry] = []
    scanned, last = 0, None
    for doc_id, r in _scan(frm, to, cursor, SCAN_CAP):
        scanned, last = scanned + 1, doc_id
        e = _entry(doc_id, r, lk)
        if not match(e):
            continue
        if len(items) == limit:  # one more match exists, so there is a next page
            return AuditPage(items=items, next_cursor=items[-1].id, scanned=scanned)
        items.append(e)
    if scanned == SCAN_CAP:
        return AuditPage(items=items, next_cursor=last, scanned=scanned, truncated=True)
    return AuditPage(items=items, scanned=scanned)


@router.get("/summary", response_model=AuditSummary)
def summary():
    """KPI tiles for today (Asia/Taipei)."""
    today = date.fromisoformat(day_key())
    start, end, _, _ = _window(today.isoformat(), today.isoformat())
    rows = [d.to_dict() or {} for d in _between(start, end)
            .select(["actor", "action", "ok", "agent_id", "connector_id"]).limit(SUMMARY_CAP).stream()]
    agg = _between(start - timedelta(days=1), start).count(alias="n").get()
    yesterday = int(agg[0][0].value) if agg and agg[0] else 0

    by_cat: Counter[str] = Counter()
    warn: Counter[str] = Counter()
    conns: Counter[str] = Counter()
    users, runners, builders, agents = set(), set(), set(), set()
    conn_calls = conn_failed = 0
    for r in rows:
        action, actor = r.get("action", ""), r.get("actor", "")
        cat = category_of(action)
        by_cat[cat] += 1
        users.add(actor)
        if severity_of(action, r) == "warning":
            warn[action] += 1
        if action == "agent.run":
            runners.add(actor)
            agents.add(r.get("agent_id"))
        if cat == "build" or action in {"connector.create", "connector.update", "connector.delete"}:
            builders.add(actor)
        if action == "connector.invoke":
            conn_calls += 1
            conn_failed += r.get("ok") is False
            conns[r.get("connector_id") or ""] += 1

    lk = _Lookups()
    top = [AuditCount(key=cid, label=lk.connector(cid).get("label") or cid or "—", count=n) for cid, n in conns.most_common(3)]
    total = len(rows)
    return AuditSummary(
        day=today.isoformat(), total=total, total_yesterday=yesterday,
        delta_pct=None if yesterday <= 0 else round((total - yesterday) / yesterday * 100, 1),
        by_category=dict(by_cat), connector_calls=conn_calls, connector_failed=conn_failed, top_connectors=top,
        warnings=sum(warn.values()), warning_breakdown=[AuditCount(key=a, count=n) for a, n in warn.most_common()],
        active_users=len(users), run_users=len(runners), build_users=len(builders),
        agents_invoked=len(agents - {None, ""}), capped=total == SUMMARY_CAP)


@router.get("/export.csv")
def export_csv(frm: str | None = Query(None, alias="from"), to: str | None = None, category: str = "",
               severity: str = "", department: str = "", q: str = "", user: User = Depends(require_admin)):
    match, lk = _matcher(category, severity, department, q), _Lookups()
    _, _, d_from, d_to = _window(frm, to)
    rows: list[AuditEntry] = []
    for doc_id, r in _scan(frm, to, None, EXPORT_SCAN_CAP):
        e = _entry(doc_id, r, lk)
        if match(e):
            rows.append(e)
            if len(rows) == EXPORT_ROWS:
                break
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM so Excel opens Chinese headers correctly
    w = csv.writer(buf)
    w.writerow(["at", "event_id", "actor_email", "actor_uid", "action", "category", "severity", "target_kind",
                "target_id", "target_label", "agent", "department", "details_json"])
    for e in rows:
        at = e.at.astimezone(TZ).isoformat() if isinstance(e.at, datetime) else (e.at or "")
        w.writerow([at, e.id, e.actor_email, e.actor, e.action, e.category, e.severity, e.target_kind, e.target_id,
                    e.target_label, e.agent_label, e.department, json.dumps(e.details, ensure_ascii=False, default=str)])
    # Exporting the trail is itself an auditable data access, same as monitoring.export.
    db.audit(user.uid, "audit.export", user.email, range_from=d_from.isoformat(), range_to=d_to.isoformat(),
             category=category, severity=severity, department=department, q=q, rows=len(rows))
    name = f"tcvgh-audit_{d_from.isoformat()}_{d_to.isoformat()}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})
