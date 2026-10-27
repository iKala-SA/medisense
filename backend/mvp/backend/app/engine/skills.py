"""Skill instructions injected into LLM system prompts (agents.skill_ids -> skills/{id})."""
import logging
from typing import Any

from .. import db, sharing

log = logging.getLogger(__name__)
MAX_PREFIX_CHARS = 100_000  # cap on the combined skill text per run (a skill itself may be up to 500k chars)


def build_prefix(skill_ids: list[str], user: Any) -> str:
    """Instructions of the skills that exist, are enabled and that `user` may view, in the agent's order.
    Missing / disabled / not-viewable skills are skipped silently (an agent must not break because a skill
    was deleted or un-shared). Returns "" when nothing applies."""
    if not skill_ids:
        return ""
    parts: list[str] = []
    used = 0
    for sid in dict.fromkeys(skill_ids):
        try:
            snap = db.client().collection("skills").document(sid).get()
        except Exception:  # noqa: BLE001 - never fail a run on a skill read
            log.warning("could not read skill %s", sid, exc_info=True)
            continue
        d = snap.to_dict() if snap.exists else None
        if not d or not d.get("enabled", True) or not (d.get("instructions") or "").strip():
            continue
        if not sharing.can_view(user, d):
            continue
        text = d["instructions"].strip()[: max(0, MAX_PREFIX_CHARS - used)]
        if not text:
            break
        used += len(text)
        parts.append(f"## Skill: {d.get('name', sid)}\n{text}")
    return "\n\n".join(parts)
