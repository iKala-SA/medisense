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
from ..engine import limits as limits_engine
from ..schemas import DEPARTMENTS, AgentUsageRow, DailyPoint, ModelSlice, MonitoringSummary, UsageByRow, UsageLimitIn, UsageLimitOut

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


ENVS = ("production", "sandbox")


def _env(value: str) -> str:
    if value not in ENVS:
        raise HTTPException(422, "env must be production or sandbox")
    return value


def _group_rollups(d_from: date, d_to: date, group: str, env: str) -> list[dict]:
    """Usage of the members of one group (群組管理). The daily rollups are per agent, not per person, so this reads the raw
    `usage` ledger for the window and turns each row into a rollup-shaped dict the summary / leaderboard code already sums."""
    from ..engine.usage import model_key
    from .groups import members_of

    _, uids = members_of(group)
    if not uids:
        return []
    q = (db.client().collection("usage")
         .where(filter=firestore.FieldFilter("day", ">=", d_from.isoformat()))
         .where(filter=firestore.FieldFilter("day", "<=", d_to.isoformat())))
    out = []
    for d in q.stream():
        r = d.to_dict() or {}
        if r.get("uid") not in uids or (r.get("env") or "production") != env:
            continue
        tokens = int(r.get("prompt_tokens", 0) or 0) + int(r.get("completion_tokens", 0) or 0)
        out.append({"day": r.get("day", ""), "env": env, "agent_id": r.get("agent_id", ""), "agent_name": r.get("agent_name", ""),
                    "department": r.get("department", ""), "requests": 1, "failed": 0 if r.get("ok", True) else 1,
                    "fallbacks": 1 if r.get("fallback") else 0, "prompt_tokens": int(r.get("prompt_tokens", 0) or 0),
                    "completion_tokens": int(r.get("completion_tokens", 0) or 0), "cost_usd": float(r.get("cost_usd", 0) or 0),
                    "ms_total": int(r.get("ms", 0) or 0),
                    "by_model": {model_key(r.get("model", "")): {"label": r.get("model", ""), "requests": 1, "tokens": tokens,
                                                                 "cost_usd": float(r.get("cost_usd", 0) or 0)}},
                    "by_group": {r.get("group", ""): 1} if r.get("group") else {}})
    return out


def _rollups(d_from: date, d_to: date, department: str, env: str = "production", group: str = "") -> list[dict]:
    if group:
        return _group_rollups(d_from, d_to, group, env)
    q = (db.client().collection("usage_daily")
         .where(filter=firestore.FieldFilter("day", ">=", d_from.isoformat()))
         .where(filter=firestore.FieldFilter("day", "<=", d_to.isoformat())))
    if department:
        q = q.where(filter=firestore.FieldFilter("department", "==", department))
    rows = [d.to_dict() or {} for d in q.stream()]
    return [r for r in rows if (r.get("env") or "production") == env]  # rows from before the sandbox split are production


def _pct(cur: float, prev: float) -> float | None:
    return None if prev <= 0 else round((cur - prev) / prev * 100, 1)


@router.get("/departments")
def departments():
    return list(DEPARTMENTS)


@router.get("/summary", response_model=MonitoringSummary)
def summary(frm: str | None = Query(None, alias="from"), to: str | None = None, department: str = "", env: str = "production",
            group: str = ""):
    d_from, d_to = _parse_range(frm, to)
    env = _env(env)
    rows = _rollups(d_from, d_to, department, env, group)
    span = (d_to - d_from).days + 1
    prev = _rollups(d_from - timedelta(days=span), d_from - timedelta(days=1), department, env, group)

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
    month = _rollups(today.replace(day=1), today, "", env)
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


def _agent_rows(d_from: date, d_to: date, department: str, env: str = "production", group: str = "") -> list[AgentUsageRow]:
    acc: dict[str, dict] = {}
    for r in _rollups(d_from, d_to, department, env, group):
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
def agents(frm: str | None = Query(None, alias="from"), to: str | None = None, department: str = "", sort: str = "requests",
           env: str = "production", group: str = ""):
    d_from, d_to = _parse_range(frm, to)
    return _sorted(_agent_rows(d_from, d_to, department, _env(env), group), sort)


@router.get("/export.csv")
def export_csv(frm: str | None = Query(None, alias="from"), to: str | None = None, department: str = "", env: str = "production",
               group: str = "", user: User = Depends(require_admin)):
    d_from, d_to = _parse_range(frm, to)
    rows = _sorted(_agent_rows(d_from, d_to, department, _env(env), group), "cost_usd")
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
             department=department, group=group, rows=len(rows))
    name = f"tcvgh-agent-cost{'' if env == 'production' else '-' + env}_{d_from.isoformat()}_{d_to.isoformat()}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ------------------------------------------------------------------ usage by person / by group (raw ledger for the window)
def _raw(d_from: date, d_to: date, env: str) -> list[dict]:
    q = (db.client().collection("usage")
         .where(filter=firestore.FieldFilter("day", ">=", d_from.isoformat()))
         .where(filter=firestore.FieldFilter("day", "<=", d_to.isoformat())))
    return [r for r in (d.to_dict() or {} for d in q.stream()) if (r.get("env") or "production") == env]


def _acc(rows: list[dict]) -> dict:
    a = {"requests": 0, "tokens": 0, "cost": 0.0, "failed": 0, "models": defaultdict(int)}
    for r in rows:
        a["requests"] += 1
        a["tokens"] += int(r.get("prompt_tokens", 0) or 0) + int(r.get("completion_tokens", 0) or 0)
        a["cost"] += float(r.get("cost_usd", 0) or 0)
        a["failed"] += 0 if r.get("ok", True) else 1
        a["models"][str(r.get("model", ""))] += 1
    return a


def _row(id_: str, a: dict, **extra) -> UsageByRow:
    return UsageByRow(id=id_, requests=a["requests"], tokens=a["tokens"], cost_usd=round(a["cost"], 4), failed=a["failed"],
                      main_model=max(a["models"], key=a["models"].get) if a["models"] else "", **extra)


def _people() -> tuple[dict[str, dict], dict[str, list[str]]]:
    """uid -> {email, name, groups}; group id -> member uids (one pass over users)."""
    by_uid, members = {}, defaultdict(list)
    for d in db.client().collection("users").stream():
        u = d.to_dict() or {}
        if u.get("uid"):
            by_uid[u["uid"]] = {"email": d.id, "name": u.get("name", ""), "groups": u.get("groups") or []}
            for g in u.get("groups") or []:
                members[g].append(u["uid"])
    return by_uid, members


@router.get("/users", response_model=list[UsageByRow])
def usage_by_user(frm: str | None = Query(None, alias="from"), to: str | None = None, env: str = "production", group: str = ""):
    """One row per person who used a model in the window, most expensive first. `group`: only that group's members."""
    d_from, d_to = _parse_range(frm, to)
    rows = _raw(d_from, d_to, _env(env))
    people, members = _people()
    if group:
        from .groups import members_of
        members_of(group)  # 404 for an unknown group
        keep = set(members.get(group, []))
        rows = [r for r in rows if r.get("uid") in keep]
    by: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by[r.get("uid") or ""].append(r)
    out = [_row(uid, _acc(rs), email=people.get(uid, {}).get("email", ""), name=people.get(uid, {}).get("name", "") or ("（排程或系統）" if not uid else uid))
           for uid, rs in by.items()]
    return sorted(out, key=lambda r: (-r.cost_usd, -r.requests))


@router.get("/groups", response_model=list[UsageByRow])
def usage_by_group(frm: str | None = Query(None, alias="from"), to: str | None = None, env: str = "production"):
    """One row per group (群組管理): the usage of its members. A person in several groups counts in each of them."""
    d_from, d_to = _parse_range(frm, to)
    rows = _raw(d_from, d_to, _env(env))
    _, members = _people()
    by_uid: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_uid[r.get("uid") or ""].append(r)
    out = []
    for g in db.client().collection("groups").stream():
        uids = members.get(g.id, [])
        out.append(_row(g.id, _acc([r for u in uids for r in by_uid.get(u, [])]), name=(g.to_dict() or {}).get("name", g.id), members=len(uids)))
    return sorted(out, key=lambda r: (-r.cost_usd, -r.requests, r.name))


# ------------------------------------------------------------------ usage limits (用量上限)
def _limit_out(doc_id: str, d: dict, names: dict[str, str]) -> UsageLimitOut:
    lim = {**d, "id": doc_id}
    try:
        spent = limits_engine.used(lim)
    except Exception:  # noqa: BLE001 - a rollup read problem shows as 0, never breaks the page
        spent = 0.0
    cap = float(d.get("limit", 0) or 0)
    return UsageLimitOut(id=doc_id, **{k: d[k] for k in ("scope", "target", "period", "metric", "limit", "enabled", "note") if k in d},
                         target_label=names.get(d.get("target", ""), d.get("target", "")) if d.get("scope") == "group" else d.get("target", ""),
                         used=round(spent, 4), pct=round(spent / cap * 100, 1) if cap else 0.0, exceeded=cap > 0 and spent >= cap,
                         created_by=d.get("created_by", ""), updated_at=d.get("updated_at"))


def _group_names() -> dict[str, str]:
    return {g.id: (g.to_dict() or {}).get("name", g.id) for g in db.client().collection("groups").stream()}


def _check_target(body: UsageLimitIn) -> str:
    if body.scope == "group":
        names = _group_names()
        if body.target not in names:
            raise HTTPException(422, "unknown group")
        return names[body.target]
    return body.target


@router.get("/limits", response_model=list[UsageLimitOut])
def list_limits():
    names = _group_names()
    rows = [_limit_out(d.id, d.to_dict() or {}, names) for d in db.client().collection(limits_engine.COLL).stream()]
    return sorted(rows, key=lambda r: (not r.exceeded, -r.pct, r.target_label))


@router.post("/limits", response_model=UsageLimitOut, status_code=201)
def create_limit(body: UsageLimitIn, user: User = Depends(require_admin)):
    label = _check_target(body)
    ref = db.client().collection(limits_engine.COLL).document()
    data = {**body.model_dump(), "target_label": label, "created_by": user.email, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    limits_engine.reset_cache()
    db.audit(user.uid, "usage_limit.create", user.email, limit_id=ref.id, scope=body.scope, target=body.target, period=body.period,
             metric=body.metric, limit=body.limit)
    return _limit_out(ref.id, data, _group_names())


@router.put("/limits/{limit_id}", response_model=UsageLimitOut)
def update_limit(limit_id: str, body: UsageLimitIn, user: User = Depends(require_admin)):
    snap = db.client().collection(limits_engine.COLL).document(limit_id).get()
    if not snap.exists:
        raise HTTPException(404, "limit not found")
    label = _check_target(body)
    data = {**(snap.to_dict() or {}), **body.model_dump(), "target_label": label, "updated_at": db.now()}
    snap.reference.set(data)
    limits_engine.reset_cache()
    db.audit(user.uid, "usage_limit.update", user.email, limit_id=limit_id, scope=body.scope, target=body.target, period=body.period,
             metric=body.metric, limit=body.limit, enabled=body.enabled)
    return _limit_out(limit_id, data, _group_names())


@router.delete("/limits/{limit_id}", status_code=204)
def delete_limit(limit_id: str, user: User = Depends(require_admin)):
    snap = db.client().collection(limits_engine.COLL).document(limit_id).get()
    if not snap.exists:
        raise HTTPException(404, "limit not found")
    snap.reference.delete()
    limits_engine.reset_cache()
    db.audit(user.uid, "usage_limit.delete", user.email, limit_id=limit_id, target=(snap.to_dict() or {}).get("target", ""))
