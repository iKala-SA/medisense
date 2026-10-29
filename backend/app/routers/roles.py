"""Roles (specifications/BE-ROLE-SPEC.md). Admin-only in the spec; only GET /api/roles is implemented so far.

Contract follows the frontend as-built page (specifications/FE-ROLE-SPEC.md): `can` holds the capability labels
shown on the page, `permission_count` is len(can), and custom roles have no English name and no permissions.

TEMPORARY (development): this router returns hard-coded mock data. It does not read Firestore and does not verify
the token. Before merging or deploying, restore the real implementation (roles/{id} + users counts) and
`dependencies=[Depends(require_admin)]`.
"""
from typing import Literal

from fastapi import APIRouter, Query

from ..schemas import RoleListOut, RoleOut, RoleStats

router = APIRouter(prefix="/api/roles", tags=["roles"])


def _role(role_id: str, name: str, en: str, desc: str, *, custom: bool = False, suspended: bool = False,
          member_count: int = 0, can: list[str] | None = None) -> RoleOut:
    can = can or []
    return RoleOut(id=role_id, name=name, en=en, desc=desc, custom=custom, suspended=suspended,
                   member_count=member_count, permission_count=len(can), can=can)


# Synthetic data, mirroring frontend/src/live/constants.js ROLES and RolesPage.jsx CUSTOM_ROLES.
# Member counts are what the mock users would give.
MOCK_ROLES = [
    _role("admin", "系統管理員", "Admin",
          "可編輯與發布全院任何 Agent、核可發布申請，並檢視監控成本、資安稽核軌跡，管理同仁帳號與權限。", member_count=1,
          can=["發布核可", "監控與成本", "資安稽核", "帳號管理"]),
    _role("builder", "Agent 建置者", "Builder",
          "可在 Agent Studio 建立自己的 Agent、於沙盒測試並申請全院發布，新增連接器與上傳院內知識文件。", member_count=2,
          can=["Agent Studio", "申請發布", "連接器", "知識庫上傳"]),
    _role("user", "一般使用者", "User",
          "只能在 Agent Hub 與全院已發布的 Agent 對話，看不到建置、連接器與知識庫功能。新登入的同仁預設為此角色。",
          member_count=4, can=["已發布 Agent 對話"]),
    _role("ai-reviewer", "AI 審核員", "", "審核 Agent 上架與版本發佈", custom=True, suspended=True),
    _role("trainer", "教育訓練講師", "", "建立教育訓練課程與管理參加名單", custom=True, suspended=True),
]


@router.get("", response_model=RoleListOut)
def list_roles(search: str = Query("", max_length=100),
               kind: Literal["all", "system", "custom"] = Query("all", alias="type")):
    """Stats count all roles; `search` and `type` only filter the returned list."""
    needle = search.strip().lower()
    picked = [r for r in MOCK_ROLES
              if (kind == "all" or (kind == "custom") == r.custom)
              and (not needle or needle in f"{r.name} {r.en} {r.desc}".lower())]
    stats = RoleStats(total_roles=len(MOCK_ROLES), system_roles=sum(not r.custom for r in MOCK_ROLES),
                      custom_roles=sum(r.custom for r in MOCK_ROLES),
                      assigned_users=sum(r.member_count for r in MOCK_ROLES))
    return RoleListOut(roles=picked, stats=stats)
