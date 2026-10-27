"""Usage ledger for the admin monitoring dashboard (MVP: Firestore, no LiteLLM spend DB).

Two writes per LLM call, both free of prompt text so they carry no PHI:
  usage/{autoId}                       one row per call (agent, group, served model, tokens, cost, ms, ok)
  usage_daily/{YYYY-MM-DD}_{agentId}   per-agent daily rollup, counters bumped with Increment so the
                                       dashboard reads one small document per agent-day instead of scanning.
Dates are Asia/Taipei calendar days. Writes are best-effort: a ledger failure must never fail the run.
"""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from google.cloud import firestore

from .. import db
from ..schemas import AgentIn

TZ = ZoneInfo("Asia/Taipei")
log = logging.getLogger(__name__)


def day_key(at: datetime | None = None) -> str:
    return (at or db.now()).astimezone(TZ).strftime("%Y-%m-%d")


def model_key(model: str) -> str:
    """Firestore map keys may not contain '.', so 'gemini-3.1-pro' is stored under 'gemini-3_1-pro'."""
    return model.replace(".", "_")


def record(*, agent: AgentIn, agent_id: str, user_id: str, group: str, model: str, prompt_tokens: int,
           completion_tokens: int, cost_usd: float, ms: int, ok: bool, fallback: bool) -> None:
    at = db.now()
    try:
        c = db.client()
        c.collection("usage").add({
            "at": at, "day": day_key(at), "agent_id": agent_id, "agent_name": agent.name, "department": agent.department,
            "uid": user_id, "group": group, "model": model, "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens, "cost_usd": cost_usd, "ms": ms, "ok": ok, "fallback": fallback,
        })
        inc = firestore.Increment
        c.collection("usage_daily").document(f"{day_key(at)}_{agent_id}").set({
            "day": day_key(at), "agent_id": agent_id, "agent_name": agent.name, "department": agent.department,
            "requests": inc(1), "failed": inc(0 if ok else 1), "fallbacks": inc(1 if fallback else 0),
            "prompt_tokens": inc(prompt_tokens), "completion_tokens": inc(completion_tokens),
            "cost_usd": inc(cost_usd), "ms_total": inc(ms),
            "by_model": {model_key(model): {"label": model, "requests": inc(1), "tokens": inc(prompt_tokens + completion_tokens),
                                             "cost_usd": inc(cost_usd)}},
            "by_group": {group: inc(1)},
            "updated_at": at,
        }, merge=True)
    except Exception:  # noqa: BLE001 - ledger is observability, never a reason to fail a clinical reply
        log.exception("usage ledger write failed for agent %s", agent_id)
