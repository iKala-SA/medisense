"""Hospital-wide routing switches (Firestore `config/routing`), admin-only, and how model group "auto" resolves.

  {version, sovereign_only, model_armor}

sovereign_only (僅本地模型) overrides everything: every call goes to `sovereign`, which LiteLLM serves on-prem only
with no cloud fallback. engine/flow.pick_group and llm.complete both enforce it, so it covers agents and nodes that
pin a group, not just "auto".

model_armor: llm.complete asks LiteLLM to run its `model-armor` guardrail (pre_call, before any routing) on every
request while this is on. A match comes back as HTTP 400 "Content blocked by Model Armor" and no model is called.

"auto" = LiteLLM's `smart-router` (complexity router, configured on the 模型 page) when the live gateway serves it,
else `fast`. The old admin rule list was removed: the smart router replaced it. Unknown / missing / broken config
falls back to DEFAULT_CONFIG (or, when Firestore fails after a good read, the last config seen, so a read error cannot
silently switch sovereign_only or model_armor off); this module never raises.
"""
import logging
import time
from typing import NamedTuple

from .. import db

log = logging.getLogger(__name__)
SMART_ROUTER = "smart-router"  # LiteLLM model_name, see engine/litellm_config.py
MODEL_ARMOR_GUARDRAIL = "model-armor"  # guardrail_name in litellm/config.yaml
DEFAULT_CONFIG: dict = {"version": 0, "sovereign_only": False, "model_armor": True}
SOVEREIGN_REASON = "僅本地模型：全院設定，所有請求使用 sovereign，不回退雲端"
_TTL = 60.0
_cache: tuple[float, dict] | None = None


class Resolution(NamedTuple):
    group: str
    reason: str


def load_config() -> dict:
    """config/routing, cached 60 s per instance. Falls back to DEFAULT_CONFIG on any error."""
    global _cache
    if _cache and time.monotonic() - _cache[0] < _TTL:
        return _cache[1]
    cfg = _cache[1] if _cache else DEFAULT_CONFIG  # keep the last good config if this read fails
    try:
        snap = db.client().collection("config").document("routing").get()
        if snap.exists and isinstance(snap.to_dict(), dict):
            cfg = {**DEFAULT_CONFIG, **(snap.to_dict() or {})}
    except Exception:  # noqa: BLE001 - routing must never break a run
        log.warning("could not read config/routing; using defaults", exc_info=True)
    _cache = (time.monotonic(), cfg)
    return cfg


def reset_cache() -> None:
    global _cache
    _cache = None


def sovereign_only() -> bool:
    return bool(load_config().get("sovereign_only"))


def model_armor() -> bool:
    return bool(load_config().get("model_armor", True))


def resolve_auto() -> Resolution:
    if sovereign_only():
        return Resolution("sovereign", SOVEREIGN_REASON)
    from . import llm  # llm imports this module

    if SMART_ROUTER in llm.gateway_models():
        return Resolution(SMART_ROUTER, "smart-router 依問題難度選擇模型")
    return Resolution("fast", "Medisense Model Gateway 尚未提供 smart-router，改用 fast")
