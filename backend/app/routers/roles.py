"""Roles (specifications/BE-ROLE-SPEC.md). Admin-only; only GET /api/roles is implemented so far.

Contract follows the frontend as-built page (specifications/FE-ROLE-SPEC.md): `can` holds the capability labels
shown on the page, `permission_count` is len(can), and custom roles have no English name and no permissions.

Reads the `roles` collection (see db.py). The three system roles are always listed: a stored document overrides
the built-in values, and a missing document falls back to them. Every other stored document is a custom role.
"""
from typing import Literal

from fastapi import APIRouter, Depends, Query

from .. import db
from ..auth import effective_role, require_admin
from ..schemas import RoleListOut, RoleOut, RoleStats

router = APIRouter(prefix="/api/roles", tags=["roles"], dependencies=[Depends(require_admin)])

# Built-in values, used when no `roles/{id}` document exists for a system role.
SYSTEM_ROLES = {
    "admin": {"name": "系統管理員", "en": "Admin",
              "desc": "可編輯與發布全院任何 Agent、核可發布申請，並檢視監控成本、資安稽核軌跡，管理同仁帳號與權限。",
              "can": ["發布核可", "監控與成本", "資安稽核", "帳號管理"]},
    "builder": {"name": "Agent 建置者", "en": "Builder",
                "desc": "可在 Agent Studio 建立自己的 Agent、於沙盒測試並申請全院發布，新增連接器與上傳院內知識文件。",
                "can": ["Agent Studio", "申請發布", "連接器", "知識庫上傳"]},
    "user": {"name": "一般使用者", "en": "User",
             "desc": "只能在 Agent Hub 與全院已發布的 Agent 對話，看不到建置、連接器與知識庫功能。新登入的同仁預設為此角色。",
             "can": ["已發布 Agent 對話"]},
}


def _member_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    for d in db.client().collection("users").stream():
        role = effective_role(d.to_dict() or {})
        counts[role] = counts.get(role, 0) + 1
    return counts


def _out(role_id: str, data: dict, counts: dict[str, int]) -> RoleOut:
    can = [c for c in data.get("can") or [] if isinstance(c, str)]
    # The stored `custom` flag decides; documents without it fall back to "not a built-in system role".
    custom = data["custom"] if isinstance(data.get("custom"), bool) else role_id not in SYSTEM_ROLES
    return RoleOut(id=role_id, name=data.get("name", ""), en=data.get("en", ""), desc=data.get("desc", ""),
                   custom=custom, suspended=bool(data.get("suspended", False)),
                   member_count=counts.get(role_id, 0), permission_count=len(can), can=can)


def _all() -> list[RoleOut]:
    stored = {d.id: d.to_dict() or {} for d in db.client().collection("roles").stream()}
    counts = _member_counts()
    rows = [_out(rid, {**base, **stored.get(rid, {})}, counts) for rid, base in SYSTEM_ROLES.items()]
    rows += [_out(rid, d, counts) for rid, d in stored.items() if rid not in SYSTEM_ROLES]
    # System roles keep the built-in order; custom roles follow, sorted by name.
    order = {rid: i for i, rid in enumerate(SYSTEM_ROLES)}
    return sorted(rows, key=lambda r: (r.custom, order.get(r.id, 0), r.name.lower()))


@router.get("", response_model=RoleListOut)
def list_roles(search: str = Query("", max_length=100),
               kind: Literal["all", "system", "custom"] = Query("all", alias="type")):
    """Stats count all roles; `search` and `type` only filter the returned list."""
    rows = _all()
    needle = search.strip().lower()
    picked = [r for r in rows
              if (kind == "all" or (kind == "custom") == r.custom)
              and (not needle or needle in f"{r.name} {r.en} {r.desc}".lower())]
    stats = RoleStats(total_roles=len(rows), system_roles=sum(not r.custom for r in rows),
                      custom_roles=sum(r.custom for r in rows),
                      assigned_users=sum(r.member_count for r in rows))
    return RoleListOut(roles=picked, stats=stats)
