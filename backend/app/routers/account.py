"""The signed-in user's own account summary (管理帳戶 → 帳戶資訊): profile, groups, roles, what they own, and their usage.

Everything is the caller's own data, so any signed-in user may read it. Group and role names are looked up here so the page
and the sidebar never need the admin-only group / role APIs.
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends
from google.cloud import firestore

from .. import db
from ..auth import User, current_user, users
from ..engine import usage
from .roles import SYSTEM_ROLES

router = APIRouter(prefix="/api/me", tags=["account"])

ROLE_LABEL = {"admin": "管理員", "builder": "建置者", "user": "員工"}
ITEMS = 6  # owned items listed per kind (counts are always complete)


def provider_label(provider: str) -> str:
    """How the account signs in, in words."""
    if not provider:
        return "—"
    if provider == "google.com":
        return "Google 帳號"
    if provider.startswith("oidc."):
        return "院內 SSO（OIDC）"
    if provider.startswith("saml."):
        return "院內 SSO（SAML）"
    if provider == "password":
        return "電子郵件與密碼"
    return provider


def group_names(ids: list[str] | tuple[str, ...]) -> list[dict]:
    """[{id, name, description}] for the given group ids; missing groups are skipped."""
    if not ids:
        return []
    c = db.client()
    out = []
    for snap in c.get_all([c.collection("groups").document(g) for g in ids]):
        if snap.exists:
            d = snap.to_dict() or {}
            out.append({"id": snap.id, "name": d.get("name") or snap.id, "description": d.get("description", "")})
    return out


def role_names(user: User) -> list[dict]:
    """[{id, name, custom}] for the user's assigned roles; the base account role when none is assigned."""
    ids = list(user.roles) or [user.role]
    c = db.client()
    out = []
    for rid in ids:
        stored = c.collection("roles").document(rid).get()
        data = {**SYSTEM_ROLES.get(rid, {}), **(stored.to_dict() or {} if stored.exists else {})}
        if not data:
            continue
        out.append({"id": rid, "name": data.get("name") or ROLE_LABEL.get(rid, rid), "custom": rid not in SYSTEM_ROLES})
    return out


def role_label(user: User, roles: list[dict]) -> str:
    """Short label for the sidebar: a custom role's own name, otherwise 管理員 / 建置者 / 員工."""
    custom = [r["name"] for r in roles if r.get("custom")]
    return custom[0] if custom else ROLE_LABEL.get(user.role, user.role)


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else (v or "")


def _owned(col: str, uid: str) -> list[dict]:
    q = db.client().collection(col).where(filter=firestore.FieldFilter("owner_uid", "==", uid))
    rows = []
    for s in q.stream():
        d = s.to_dict() or {}
        if d.get("deleted") or d.get("status") == "deleted":
            continue
        rows.append({"id": s.id, **d})
    rows.sort(key=lambda d: str(d.get("updated_at") or d.get("created_at") or ""), reverse=True)
    return rows


def _usage(uid: str) -> dict:
    """Requests / tokens / cost today, over the last 7 days and this calendar month (all environments), plus 14 daily points."""
    today = db.now()
    t = usage.day_key(today)
    week = usage.day_key(today - timedelta(days=6))
    month = t[:8] + "01"
    first = min(month, usage.day_key(today - timedelta(days=13)))
    q = db.client().collection(usage.USER_DAILY).where(filter=firestore.FieldFilter("uid", "==", uid))
    zero = {"requests": 0, "tokens": 0, "cost_usd": 0.0}
    sums = {"today": dict(zero), "week": dict(zero), "month": dict(zero)}
    daily: dict[str, dict] = {}
    for s in q.stream():
        d = s.to_dict() or {}
        day = str(d.get("day") or "")
        if day < first:
            continue
        row = {"requests": int(d.get("requests", 0) or 0), "tokens": int(d.get("tokens", 0) or 0), "cost_usd": float(d.get("cost_usd", 0) or 0)}
        for key, start in (("today", t), ("week", week), ("month", month)):
            if day >= start:
                for k, v in row.items():
                    sums[key][k] += v
        cur = daily.setdefault(day, dict(zero))
        for k, v in row.items():
            cur[k] += v
    days = [usage.day_key(today - timedelta(days=i)) for i in range(13, -1, -1)]
    return {**sums, "daily": [{"day": d, **daily.get(d, zero)} for d in days]}


@router.get("/summary")
def summary(user: User = Depends(current_user)):
    snap = users().document(user.email).get()
    acct = snap.to_dict() or {} if snap.exists else {}
    roles = role_names(user)
    agents = _owned("agents", user.uid)
    is_flow = lambda a: (a.get("kind") or ("flow" if a.get("steps") else "agent")) == "flow"  # noqa: E731
    def brief(a: dict) -> dict:
        state = "pending" if (a.get("review") or {}).get("state") == "pending" else a.get("status") or "draft"
        return {"id": a["id"], "name": a.get("name", ""), "status": state, "version": a.get("version") or 0}
    flows = [a for a in agents if is_flow(a)]
    chat_agents = [a for a in agents if not is_flow(a)]
    skills = _owned("skills", user.uid)
    spaces = _owned("spaces", user.uid)
    return {
        "profile": {"name": user.name, "email": user.email, "role": user.role, "role_label": role_label(user, roles),
                    "status": acct.get("status", "active"), "login_provider": acct.get("login_provider", ""),
                    "login_label": provider_label(acct.get("login_provider", "")),
                    "created_at": _iso(acct.get("created_at")), "last_seen_at": _iso(acct.get("last_seen_at"))},
        "groups": group_names(user.groups),
        "roles": roles,
        "assets": {
            "agents": {"count": len(chat_agents), "published": sum(a.get("status") == "published" for a in chat_agents),
                       "items": [brief(a) for a in chat_agents[:ITEMS]]},
            "flows": {"count": len(flows), "published": sum(a.get("status") == "published" for a in flows),
                      "items": [brief(a) for a in flows[:ITEMS]]},
            "skills": {"count": len(skills), "items": [{"id": s["id"], "name": s.get("name", ""), "enabled": s.get("enabled", True)} for s in skills[:ITEMS]]},
            "spaces": {"count": len(spaces), "items": [{"id": s["id"], "name": s.get("name", ""), "documents": len(s.get("document_ids") or [])} for s in spaces[:ITEMS]]},
        },
        "usage": _usage(user.uid),
    }
