"""Usage limits (用量上限): stop model calls once a group or a model has used its budget for the day / month.

  usage_limits/{id}  {scope: group | model, target, period: day | month, metric: cost_usd | tokens | requests,
                      limit, enabled, note, created_by, created_at, updated_at}

`scope: group`: everyone in that 群組管理 group shares the budget (a person in several groups is held to each of them).
`scope: model`: one exact model id (as in GET /api/models) or a routing group (fast, reasoning, ...): every call that asked
for it counts. Usage comes from the per-user and per-target daily rollups that engine.usage keeps, counted across
environments (a sandbox test spends real money too).

The check runs before every model call (flow._complete). Reads are cached for CACHE_S seconds, so a burst right at the
limit may let a few calls through: the limit is a budget guard, not an accounting system.
"""
from __future__ import annotations

import time
from datetime import date

from google.cloud import firestore

from .. import db
from . import usage

COLL = "usage_limits"
SCOPES = ("group", "model")
PERIODS = ("day", "month")
METRICS = ("cost_usd", "tokens", "requests")
METRIC_LABEL = {"cost_usd": "費用（USD）", "tokens": "Tokens", "requests": "呼叫次數"}
PERIOD_LABEL = {"day": "今日", "month": "本月"}
CACHE_S = 30.0

_cache: dict[str, tuple[float, object]] = {}


class LimitExceeded(RuntimeError):
    """A model call refused because a usage limit is used up. The message is shown to the person."""

    def __init__(self, message: str, limit_id: str = ""):
        super().__init__(message)
        self.limit_id = limit_id


def _cached(key: str, fn):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_S:
        return hit[1]
    val = fn()
    _cache[key] = (time.monotonic(), val)
    return val


def reset_cache() -> None:
    _cache.clear()


def period_start(period: str, today: str | None = None) -> str:
    d = date.fromisoformat(today or usage.day_key())
    return (d if period == "day" else d.replace(day=1)).isoformat()


def all_limits() -> list[dict]:
    return _cached("limits", lambda: [{**(d.to_dict() or {}), "id": d.id} for d in db.client().collection(COLL).stream()])


def _metric(row: dict, metric: str) -> float:
    return float(row.get(metric, 0) or 0)


def _rows(coll: str, start: str, end: str) -> list[dict]:
    q = (db.client().collection(coll).where(filter=firestore.FieldFilter("day", ">=", start))
         .where(filter=firestore.FieldFilter("day", "<=", end)))
    return [d.to_dict() or {} for d in q.stream()]


def group_uids(group_id: str) -> set[str]:
    def load():
        q = db.client().collection("users").where(filter=firestore.FieldFilter("groups", "array_contains", group_id))
        return {u for u in ((d.to_dict() or {}).get("uid") for d in q.stream()) if u}
    return _cached(f"members:{group_id}", load)


def user_groups(uid: str) -> set[str]:
    def load():
        q = db.client().collection("users").where(filter=firestore.FieldFilter("uid", "==", uid)).limit(1)
        return {g for d in q.stream() for g in ((d.to_dict() or {}).get("groups") or []) if isinstance(g, str)}
    return _cached(f"groups:{uid}", load) if uid else set()


def used(lim: dict) -> float:
    """What the limit's target has used in its current period, in the limit's metric."""
    start, end = period_start(lim.get("period", "month")), usage.day_key()
    metric = lim.get("metric", "cost_usd")

    def load():
        if lim.get("scope") == "group":
            uids = group_uids(lim.get("target", ""))
            return sum(_metric(r, metric) for r in _rows(usage.USER_DAILY, start, end) if r.get("uid") in uids)
        return sum(_metric(r, metric) for r in _rows(usage.TARGET_DAILY, start, end) if r.get("target") == lim.get("target"))
    return _cached(f"used:{lim['id']}:{start}:{metric}", load)


def _fmt(v: float, metric: str) -> str:
    return f"US$ {v:,.2f}" if metric == "cost_usd" else f"{int(v):,}"


def applicable(user_id: str, target: str) -> list[dict]:
    """Enabled limits that govern a call by `user_id` asking for `target` (a model id or a routing group)."""
    mine = user_groups(user_id)
    return [lim for lim in all_limits() if lim.get("enabled", True) and (
        (lim.get("scope") == "model" and lim.get("target") == target) or (lim.get("scope") == "group" and lim.get("target") in mine))]


def check(user_id: str, target: str) -> None:
    """Raise LimitExceeded when a limit that applies to this call is used up. Never raises for any other reason."""
    try:
        limits = applicable(user_id, target)
    except Exception:  # noqa: BLE001 - a limits outage must not take chat down
        return
    for lim in limits:
        try:
            spent = used(lim)
        except Exception:  # noqa: BLE001
            continue
        cap = float(lim.get("limit", 0) or 0)
        if cap > 0 and spent >= cap:
            who = f"群組「{lim.get('target_label') or lim.get('target')}」" if lim.get("scope") == "group" else f"模型「{lim.get('target')}」"
            metric = lim.get("metric", "cost_usd")
            raise LimitExceeded(f"已達用量上限：{who}{PERIOD_LABEL.get(lim.get('period', 'month'), '')}{METRIC_LABEL.get(metric, metric)}"
                                f"已用 {_fmt(spent, metric)}，上限 {_fmt(cap, metric)}。請聯絡管理員調整上限，或改用其他模型。", lim["id"])
