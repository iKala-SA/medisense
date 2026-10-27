"""Routing rules (config/routing), admin-only. Used when an agent / node selects model group "auto"
(see engine/routing.py). Sensitive data is not a routing condition: de-identification is always on."""
from fastapi import APIRouter, Depends

from .. import db
from ..auth import User, require_admin
from ..engine import routing as eng
from ..schemas import RoutingConfigIn, RoutingConfigOut, RoutingTestIn, RoutingTestOut

router = APIRouter(prefix="/api/routing", tags=["routing"], dependencies=[Depends(require_admin)])


def _ref():
    return db.client().collection("config").document("routing")


def _current() -> dict:
    snap = _ref().get()
    return (snap.to_dict() if snap.exists else None) or eng.DEFAULT_CONFIG


@router.get("", response_model=RoutingConfigOut)
def get_routing():
    return RoutingConfigOut.model_validate(_current())


@router.put("", response_model=RoutingConfigOut)
def put_routing(body: RoutingConfigIn, user: User = Depends(require_admin)):
    snap = _ref().get()
    version = int(((snap.to_dict() if snap.exists else None) or {}).get("version", 0)) + 1
    data = {**body.model_dump(), "version": version, "updated_by": user.email, "updated_at": db.now()}
    _ref().set(data)
    eng.reset_cache()
    db.audit(user.uid, "routing.update", user.email, version=version, rules=len(body.rules), sovereign_only=body.sovereign_only,
             default_group=body.default_group, fallback_group=body.fallback_group)
    return RoutingConfigOut.model_validate(data)


@router.post("/test", response_model=RoutingTestOut)
def test_routing(body: RoutingTestIn):
    """Dry run against the SAVED config (nothing is called, nothing is stored)."""
    r = eng.resolve_group(_current(), body.text)
    return RoutingTestOut(group=r.group, reason=r.reason, matched_rule=r.matched_rule)
