"""Admin-editable routing rules (Firestore `config/routing`) used when an agent / node selects model group "auto".

  {version, sovereign_only, default_group, fallback_group, rules: [{id, name, condition: complex|simple|all, group, enabled}]}

sovereign_only (僅院內模型) overrides everything: every call goes to `sovereign`, which LiteLLM serves on-prem only
with no cloud fallback. engine/flow.pick_group and llm.complete both enforce it, so it covers agents and nodes that
pin a group, not just "auto".

Rules are checked top to bottom; the first enabled rule whose condition matches picks the group. "complex"
uses the same reasoning-keyword heuristic as RoutingPolicy / flow.pick_group (case-insensitive substring of the
USER's message). Sensitive data is NOT a routing condition: de-identification is always on, and only the
`sovereign` group is on-prem-only. Unknown / missing / broken config falls back to DEFAULT_CONFIG (or, when Firestore
fails after a good read, the last config seen, so a read error cannot silently switch sovereign_only off); this
module never raises.
"""
import logging
import time
from typing import NamedTuple

from .. import db
from ..schemas import RoutingPolicy

log = logging.getLogger(__name__)
REAL_GROUPS = ("fast", "reasoning", "budget", "sovereign")
DEFAULT_KEYWORDS: list[str] = list(RoutingPolicy().reasoning_keywords)
DEFAULT_CONFIG: dict = {
    "version": 0, "sovereign_only": False, "default_group": "fast", "fallback_group": "fast",
    "rules": [
        {"id": "complex-to-reasoning", "name": "複雜問題 → reasoning", "condition": "complex", "group": "reasoning", "enabled": True},
        {"id": "simple-to-fast", "name": "一般問題 → fast", "condition": "simple", "group": "fast", "enabled": True},
    ],
}
SOVEREIGN_REASON = "僅院內模型：全院設定，所有請求使用 sovereign，不回退雲端"
_TTL = 60.0
_cache: tuple[float, dict] | None = None


class Resolution(NamedTuple):
    group: str
    reason: str
    matched_rule: str | None = None


def is_complex(text: str, keywords: list[str] | None = None) -> bool:
    t = (text or "").lower()
    return any(k.lower() in t for k in (keywords if keywords is not None else DEFAULT_KEYWORDS) if k)


def _valid(g: object) -> bool:
    return isinstance(g, str) and g in REAL_GROUPS


def resolve_group(config: dict | None, text: str) -> Resolution:
    cfg = config if isinstance(config, dict) and config else DEFAULT_CONFIG
    if cfg.get("sovereign_only"):
        return Resolution("sovereign", SOVEREIGN_REASON, None)
    fallback = cfg.get("fallback_group") if _valid(cfg.get("fallback_group")) else "fast"
    default = cfg.get("default_group") if _valid(cfg.get("default_group")) else fallback
    complex_ = is_complex(text)
    for rule in cfg.get("rules") or []:
        if not isinstance(rule, dict) or not rule.get("enabled", True):
            continue
        cond = rule.get("condition")
        if cond == "all" or (cond == "complex" and complex_) or (cond == "simple" and not complex_):
            if not _valid(rule.get("group")):
                return Resolution(fallback, f"規則 {rule.get('id')} 的群組無效，改用 fallback_group", rule.get("id"))
            return Resolution(rule["group"], f"符合規則「{rule.get('name') or rule.get('id')}」"
                              f"（{'複雜' if complex_ else '一般'}問題）", str(rule.get("id")))
    return Resolution(default, "沒有符合的規則，使用預設群組", None)


def load_config() -> dict:
    """config/routing, cached 60 s per instance. Falls back to DEFAULT_CONFIG on any error."""
    global _cache
    if _cache and time.monotonic() - _cache[0] < _TTL:
        return _cache[1]
    cfg = _cache[1] if _cache else DEFAULT_CONFIG  # keep the last good config if this read fails
    try:
        snap = db.client().collection("config").document("routing").get()
        if snap.exists and isinstance(snap.to_dict(), dict):
            cfg = snap.to_dict() or DEFAULT_CONFIG
    except Exception:  # noqa: BLE001 - routing must never break a run
        log.warning("could not read config/routing; using defaults", exc_info=True)
    _cache = (time.monotonic(), cfg)
    return cfg


def reset_cache() -> None:
    global _cache
    _cache = None


def sovereign_only() -> bool:
    return bool(load_config().get("sovereign_only"))


def resolve_auto(text: str) -> Resolution:
    return resolve_group(load_config(), text)
