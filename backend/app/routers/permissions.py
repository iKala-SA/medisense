"""Permission matrix resources (read-only, from app/permissions.py). Admin-only, like the role pages that show them."""
from fastapi import APIRouter, Depends

from ..auth import require_admin
from ..permissions import RESOURCES
from ..schemas import PermissionOut

router = APIRouter(prefix="/api/permissions", tags=["permissions"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[PermissionOut])
def list_permissions():
    return [PermissionOut(id=rid, name=name, desc=desc, order=i) for i, (rid, name, desc) in enumerate(RESOURCES, start=1)]
