"""Admin monitoring & cost dashboard (design: Agent 監控與成本). Reads the `usage_daily` rollups
written by engine.usage, so one request touches at most (days x agents) small documents."""
import csv
import io
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from google.cloud import firestore

from .. import db
from ..auth import User, require_admin
from ..config import settings
from ..engine.usage import day_key
from ..schemas import DEPARTMENTS, AgentUsageRow, DailyPoint, ModelSlice, MonitoringSummary

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"], dependencies=[Depends(require_admin)])
SORTS = {"requests", "tokens", "cost_usd", "cost_per_call", "avg_latency_ms", "fallbacks"}


def _parse_range(frm: str | None, to: str | None) -> tuple[date, date]:
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
    return d_from, d_to


def _rollups(d_from: date, d_to: date, department: str) -> list[dict]:
    q = (db.client().collection("usage_daily")
         .where(filter=firestore.FieldFilter("day", ">=", d_from.isoformat()))
         .where(filter=firestore.FieldFilter("day", "<=", d_to.isoformat())))
    if department:
        q = q.where(filter=firestore.FieldFilter("department", "==", department))
    return [d.to_dict() or {} for d in q.stream()]


def _pct(cur: float, prev: float) -> float | None:
    return None if prev <= 0 else round((cur - prev) / prev * 100, 1)


@router.get("/departments")
def departments():
    return list(DEPARTMENTS)


@router.get("/summary", response_model=MonitoringSummary)
def summary(frm: str | None = Query(None, alias="from"), to: str | None = None, department: str = ""):
    d_from, d_to = _parse_range(frm, to)
    rows = _rollups(d_from, d_to, department)
    span = (d_to - d_from).days + 1
    prev = _rollups(d_from - timedelta(days=span), d_from - timedelta(days=1), department)

    by_day: dict[str, DailyPoint] = {}
    for i in range(span):
        k = (d_from + timedelta(days=i)).isoformat()
        by_day[k] = DailyPoint(date=k)
    model_day: dict[str, dict[str, ModelSlice]] = defaultdict(dict)
    models: set[str] = set()
    tot = defaultdict(float)
    agents: set[str] = set()
    for r in rows:
        dp = by_day.get(r.get("day", ""))
        if dp is None:
            continue
        agents.add(r.get("agent_id", ""))
        for k in ("requests", "failed", "fallbacks", "prompt_tokens", "completion_tokens", "cost_usd", "ms_total"):
            tot[k] += float(r.get(k, 0) or 0)
        dp.requests += int(r.get("requests", 0) or 0)
        dp.prompt_tokens += int(r.get("prompt_tokens", 0) or 0)
        dp.completion_tokens += int(r.get("completion_tokens", 0) or 0)
        dp.cost_usd += float(r.get("cost_usd", 0) or 0)
        for m in (r.get("by_model") or {}).values():
            label = str(m.get("label", "?"))
            models.add(label)
            sl = model_day[dp.date].setdefault(label, ModelSlice(model=label))
            sl.requests += int(m.get("requests", 0) or 0)
            sl.tokens += int(m.get("tokens", 0) or 0)
            sl.cost_usd += float(m.get("cost_usd", 0) or 0)
    for k, dp in by_day.items():
        dp.cost_usd = round(dp.cost_usd, 4)
        dp.by_model = sorted(model_day[k].values(), key=lambda s: -s.tokens)

    p_req = sum(float(r.get("requests", 0) or 0) for r in prev)
    p_tok = sum(float(r.get("prompt_tokens", 0) or 0) + float(r.get("completion_tokens", 0) or 0) for r in prev)
    p_cost = sum(float(r.get("cost_usd", 0) or 0) for r in prev)

    today = date.fromisoformat(day_key())
    month = _rollups(today.replace(day=1), today, "")
    agents_col = db.client().collection("agents")
    total_agents = sum(1 for _ in agents_col.select([]).stream())
    published = sum(1 for _ in agents_col.where(filter=firestore.FieldFilter("status", "==", "published")).select([]).stream())
    s = settings()
    return MonitoringSummary(
        range_from=d_from.isoformat(), range_to=d_to.isoformat(), department=department,
        requests=int(tot["requests"]), failed=int(tot["failed"]), fallbacks=int(tot["fallbacks"]),
        prompt_tokens=int(tot["prompt_tokens"]), completion_tokens=int(tot["completion_tokens"]),
        cost_usd=round(tot["cost_usd"], 4),
        avg_latency_ms=int(tot["ms_total"] / tot["requests"]) if tot["requests"] else 0,
        requests_delta_pct=_pct(tot["requests"], p_req),
        tokens_delta_pct=_pct(tot["prompt_tokens"] + tot["completion_tokens"], p_tok),
        cost_delta_pct=_pct(tot["cost_usd"], p_cost),
        active_agents=len(agents), total_agents=total_agents, published_agents=published,
        month_cost_usd=round(sum(float(r.get("cost_usd", 0) or 0) for r in month), 4),
        monthly_budget_usd=s.monthly_budget_usd, usd_twd_rate=s.usd_twd_rate,
        daily=list(by_day.values()), models=sorted(models),
    )


def _agent_rows(d_from: date, d_to: date, department: str) -> list[AgentUsageRow]:
    acc: dict[str, dict] = {}
    for r in _rollups(d_from, d_to, department):
        a = acc.setdefault(r.get("agent_id", ""), {"name": r.get("agent_name", ""), "department": r.get("department", ""),
                                                   "requests": 0, "failed": 0, "fallbacks": 0, "tokens": 0, "cost": 0.0, "ms": 0,
                                                   "models": defaultdict(int), "groups": defaultdict(int)})
        a["name"] = r.get("agent_name") or a["name"]  # latest name wins
        a["requests"] += int(r.get("requests", 0) or 0)
        a["failed"] += int(r.get("failed", 0) or 0)
        a["fallbacks"] += int(r.get("fallbacks", 0) or 0)
        a["tokens"] += int(r.get("prompt_tokens", 0) or 0) + int(r.get("completion_tokens", 0) or 0)
        a["cost"] += float(r.get("cost_usd", 0) or 0)
        a["ms"] += int(r.get("ms_total", 0) or 0)
        for m in (r.get("by_model") or {}).values():
            a["models"][str(m.get("label", "?"))] += int(m.get("requests", 0) or 0)
        for g, n in (r.get("by_group") or {}).items():
            a["groups"][g] += int(n or 0)
    if not acc:
        return []
    # Owner / status come from the agents collection (one get per agent; the leaderboard is small).
    refs = [db.client().collection("agents").document(i) for i in acc]
    meta = {d.id: (d.to_dict() or {}) for d in db.client().get_all(refs)}
    out = []
    for aid, a in acc.items():
        m = meta.get(aid, {})
        out.append(AgentUsageRow(
            agent_id=aid, name=m.get("name") or a["name"] or aid, department=m.get("department") or a["department"],
            owner_email=m.get("owner_email", ""), status=m.get("status", "deleted" if not m else ""),
            main_model=max(a["models"], key=a["models"].get) if a["models"] else "",
            main_group=max(a["groups"], key=a["groups"].get) if a["groups"] else "",
            requests=a["requests"], failed=a["failed"], fallbacks=a["fallbacks"], tokens=a["tokens"],
            cost_usd=round(a["cost"], 4), avg_latency_ms=int(a["ms"] / a["requests"]) if a["requests"] else 0,
        ))
    return out


def _sorted(rows: list[AgentUsageRow], sort: str) -> list[AgentUsageRow]:
    if sort not in SORTS:
        raise HTTPException(422, f"sort must be one of {sorted(SORTS)}")
    if sort == "cost_per_call":  # cheapest per call first; agents with no calls last
        return sorted(rows, key=lambda r: (r.requests == 0, r.cost_usd / r.requests if r.requests else 0))
    if sort == "avg_latency_ms":
        return sorted(rows, key=lambda r: (r.requests == 0, r.avg_latency_ms))
    return sorted(rows, key=lambda r: -getattr(r, sort))


@router.get("/agents", response_model=list[AgentUsageRow])
def agents(frm: str | None = Query(None, alias="from"), to: str | None = None, department: str = "", sort: str = "requests"):
    d_from, d_to = _parse_range(frm, to)
    return _sorted(_agent_rows(d_from, d_to, department), sort)


@router.get("/export.csv")
def export_csv(frm: str | None = Query(None, alias="from"), to: str | None = None, department: str = "",
               user: User = Depends(require_admin)):
    d_from, d_to = _parse_range(frm, to)
    rows = _sorted(_agent_rows(d_from, d_to, department), "cost_usd")
    buf = io.StringIO()
    buf.write("﻿")  # BOM so Excel opens Chinese headers correctly
    w = csv.writer(buf)
    w.writerow(["agent_id", "name", "department", "owner_email", "status", "main_group", "main_model", "requests", "failed",
                "fallbacks", "tokens", "cost_usd", "cost_twd", "avg_latency_ms"])
    rate = settings().usd_twd_rate
    for r in rows:
        w.writerow([r.agent_id, r.name, r.department, r.owner_email, r.status, r.main_group, r.main_model, r.requests, r.failed,
                    r.fallbacks, r.tokens, f"{r.cost_usd:.4f}", f"{r.cost_usd * rate:.0f}", r.avg_latency_ms])
    db.audit(user.uid, "monitoring.export", user.email, range_from=d_from.isoformat(), range_to=d_to.isoformat(),
             department=department, rows=len(rows))
    name = f"tcvgh-agent-cost_{d_from.isoformat()}_{d_to.isoformat()}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})
