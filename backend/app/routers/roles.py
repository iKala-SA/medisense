"""Roles (specifications/BE-ROLE-SPEC.md). Admin-only; GET /api/roles, POST /api/roles and PATCH /api/roles/{id} (custom roles and system overrides), DELETE for custom roles.

Contract follows the frontend as-built page (specifications/FE-ROLE-SPEC.md): `can` holds the capability labels
shown on the page, `permission_count` is len(can), and custom roles have no English name and no permissions.

Reads the `roles` collection (see db.py). The three system roles are always listed: a stored document overrides
the built-in values, and a missing document falls back to them. Every other stored document is a custom role.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import db
from ..auth import User, effective_role, require_admin
from ..schemas import RoleIn, RoleListOut, RoleOut, RolePatch, RoleStats

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
                   custom=custom, status=data.get("status", True) is True,
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


@router.post("", response_model=RoleOut, status_code=201)
def create_role(body: RoleIn, user: User = Depends(require_admin)):
    ref = db.client().collection("roles").document()
    data = {"name": body.name, "en": "", "desc": body.desc, "custom": True, "status": True, "can": [],
            "created_by": user.email, "created_at": db.now(), "updated_at": db.now(), "updated_by": user.email}
    ref.set(data)
    db.audit(user.uid, "role.create", user.email, role_id=ref.id, name=body.name)
    return _out(ref.id, data, {})


@router.patch("/{role_id}", response_model=RoleOut)
def patch_role(role_id: str, body: RolePatch, user: User = Depends(require_admin)):
    # The built-in administrator role is fixed (BE-ROLE-SPEC: admin is always full access and cannot be edited).
    if role_id == "admin":
        raise HTTPException(403, "admin role is fixed")
    ref = db.client().collection("roles").document(role_id)
    snap = ref.get()
    if not snap.exists and role_id not in SYSTEM_ROLES:
        raise HTTPException(404, "role not found")
    changes = body.model_dump(exclude_none=True)
    if changes:
        ref.set({**changes, "id": role_id, "updated_at": db.now(), "updated_by": user.email}, merge=True)
        db.audit(user.uid, "role.update", user.email, role_id=role_id, fields=sorted(changes))
    stored = (ref.get().to_dict() or {})
    return _out(role_id, {**SYSTEM_ROLES.get(role_id, {}), **stored}, _member_counts())


@router.delete("/{role_id}", status_code=204)
def delete_role(role_id: str, user: User = Depends(require_admin)):
    ref = db.client().collection("roles").document(role_id)
    snap = ref.get()
    if not snap.exists and role_id not in SYSTEM_ROLES:
        raise HTTPException(404, "role not found")
    data = {**SYSTEM_ROLES.get(role_id, {}), **(snap.to_dict() or {})}
    if not _out(role_id, data, {}).custom:
        raise HTTPException(403, "built-in role cannot be deleted")
    # Groups keep role links as ids; drop the deleted id so no group points at a missing role.
    for g in db.client().collection("groups").stream():
        ids = list((g.to_dict() or {}).get("role_ids") or [])
        if role_id in ids:
            g.reference.update({"role_ids": [x for x in ids if x != role_id]})
    ref.delete()
    db.audit(user.uid, "role.delete", user.email, role_id=role_id, name=data.get("name", ""))
