"""Hospital-wide feature switches an admin controls (config/features). Everything here defaults to OFF.

  web_search  may chat turns send (masked) search terms to Google when the USER also switches 網路搜尋 on?
              Outbound by nature, so it is an admin decision, not just a user preference. 僅院內模型 still overrides it.

Read through a short cache; a failed read keeps the last good value and, before any good read, stays OFF (fail closed).
"""
import time

from .. import db

DEFAULTS = {"web_search": False}
_TTL = 30.0
_cache: tuple[float, dict] | None = None


def load() -> dict:
    global _cache
    if _cache and time.monotonic() - _cache[0] < _TTL:
        return _cache[1]
    cfg = _cache[1] if _cache else dict(DEFAULTS)
    try:
        snap = db.client().collection("config").document("features").get()
        cfg = {**DEFAULTS, **((snap.to_dict() if snap.exists else None) or {})}
    except Exception:  # noqa: BLE001 - an outage must not flip a switch on
        pass
    _cache = (time.monotonic(), cfg)
    return cfg


def reset_cache() -> None:
    global _cache
    _cache = None


def web_search_enabled() -> bool:
    return bool(load().get("web_search"))
