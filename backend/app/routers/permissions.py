"""Permission matrix resources (read-only, from app/permissions.py). Readable with the `roles` permission."""
from fastapi import APIRouter, Depends

from ..auth import require_permission
from ..permissions import RESOURCES
from ..schemas import PermissionOut

router = APIRouter(prefix="/api/permissions", tags=["permissions"])


# Read-only catalog for the role pages: `roles` or `roles-viewer` may read it.
@router.get("", response_model=list[PermissionOut], dependencies=[Depends(require_permission("roles"))])
def list_permissions():
    return [PermissionOut(id=rid, name=name, desc=desc, order=i) for i, (rid, name, desc) in enumerate(RESOURCES, start=1)]
