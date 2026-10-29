"""Hospital-wide feature switches an admin controls (config/features). Everything here defaults to OFF.

  voice_input   show the microphone in the chat box. Browser speech recognition sends the AUDIO to the browser vendor's speech
                service (Google for Chrome/Edge, Apple for Safari): patient details spoken aloud are NOT de-identified before that.
  rag_*_distance  how close a retrieved passage must be to reach the model at all (see rag_thresholds)
  web_search  may chat turns send (masked) search terms to Google when the USER also switches 網路搜尋 on?
              Outbound by nature, so it is an admin decision, not just a user preference. 僅本地模型 still overrides it.

Read through a short cache; a failed read keeps the last good value and, before any good read, stays OFF (fail closed).
"""
import time

from .. import db

# RAG relevance, as DISTANCE (smaller = more similar; Vertex RAG's `score`). Measured on the sandbox corpus 2026-10-28:
# passages that really answer the question sit around 0.26-0.31 (up to ~0.38), while "nothing matches" results sit at
# 0.36-0.49 and often repeat the same filler value. Tune on the real corpus with scripts/calibrate_rag.py.
DEFAULTS = {"web_search": False, "voice_input": False, "rag_keep_distance": 0.34, "rag_max_distance": 0.40}
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


def rag_thresholds() -> tuple[float, float]:
    """(keep, max): a passage at distance <= keep is relevant, <= max is kept but flagged 低相關, above max is dropped."""
    cfg = load()
    keep, mx = float(cfg.get("rag_keep_distance", 0.34)), float(cfg.get("rag_max_distance", 0.40))
    return (keep, max(keep, mx))
