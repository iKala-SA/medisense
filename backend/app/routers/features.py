"""Hospital-wide feature switches (config/features). Anyone signed in may read them (the chat box greys out what an admin
has not allowed); only an admin may change them, and every change is audited."""
from fastapi import APIRouter, Depends

from .. import db
from ..auth import User, current_user, require_admin
from ..engine import features as eng
from ..schemas import FeaturesIn, FeaturesOut

router = APIRouter(prefix="/api/features", tags=["features"])


def _ref():
    return db.client().collection("config").document("features")


@router.get("", response_model=FeaturesOut)
def get_features(user: User = Depends(current_user)):
    snap = _ref().get()
    return FeaturesOut.model_validate({**eng.DEFAULTS, **((snap.to_dict() if snap.exists else None) or {})})


@router.put("", response_model=FeaturesOut)
def put_features(body: FeaturesIn, user: User = Depends(require_admin)):
    snap = _ref().get()
    old = {**eng.DEFAULTS, **((snap.to_dict() if snap.exists else None) or {})}
    data = {**body.model_dump(), "updated_by": user.email, "updated_at": db.now()}
    _ref().set(data)
    eng.reset_cache()
    db.audit(user.uid, "features.update", user.email, web_search_old=bool(old.get("web_search")), web_search_new=body.web_search,
             rag_distance_old=[old.get("rag_keep_distance"), old.get("rag_max_distance")],
             rag_distance_new=[body.rag_keep_distance, body.rag_max_distance])
    return FeaturesOut.model_validate(data)
