"""Model registry (models/{id}), admin-only: which provider models exist, which routing group each serves,
where it runs (cloud / on-prem) and what it costs. Secrets are Secret Manager NAMES only, never values.

`POST /apply` only RENDERS a LiteLLM config.yaml from the registry into Firestore `config/litellm_render`; it
deploys nothing. An operator runs infra/09-apply-litellm-config.sh to publish it. The existing GET /api/models
(live LiteLLM view, main.py) is unrelated and unchanged.
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..auth import User, require_admin
from ..engine import litellm_config, llm
from ..schemas import LitellmRenderOut, ModelEntryIn, ModelEntryOut

router = APIRouter(prefix="/api/model-registry", tags=["model-registry"], dependencies=[Depends(require_admin)])


def _col():
    return db.client().collection("models")


def _out(doc) -> ModelEntryOut:
    return ModelEntryOut(id=doc.id, **(doc.to_dict() or {}))


def _load(mid: str):
    snap = _col().document(mid).get()
    if not snap.exists:
        raise HTTPException(404, "model not found")
    return snap


def _changed() -> None:
    llm.reset_registry_cache()


@router.get("", response_model=list[ModelEntryOut])
def list_models():
    return sorted((_out(d) for d in _col().stream()), key=lambda m: (m.group, m.name.lower()))


@router.post("", response_model=ModelEntryOut, status_code=201)
def create_model(body: ModelEntryIn, user: User = Depends(require_admin)):
    ref = _col().document()
    data = {**body.model_dump(), "created_by": user.email, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    _changed()
    db.audit(user.uid, "model.create", user.email, model_id=ref.id, name=body.name, group=body.group, deploy=body.deploy)
    return ModelEntryOut(id=ref.id, **data)


@router.get("/rendered", response_model=LitellmRenderOut | None)
def get_rendered():
    """The last rendered config (config/litellm_render), or null."""
    snap = db.client().collection("config").document("litellm_render").get()
    return LitellmRenderOut.model_validate(snap.to_dict()) if snap.exists else None


@router.post("/apply", response_model=LitellmRenderOut)
def apply_registry(user: User = Depends(require_admin)):
    """Render litellm config.yaml from the enabled registry rows and store it. Does NOT deploy anything."""
    rows = [{**(d.to_dict() or {}), "id": d.id} for d in _col().stream()]
    ref = db.client().collection("config").document("litellm_render")
    prev = ref.get()
    version = int(((prev.to_dict() if prev.exists else None) or {}).get("version", 0)) + 1
    data = {"yaml": litellm_config.render(rows), "version": version, "requested_by": user.email,
            "requested_at": db.now(), "status": "rendered", "secrets": litellm_config.required_secrets(rows)}
    ref.set(data)
    db.audit(user.uid, "model.apply", user.email, version=version, models=sum(1 for r in rows if r.get("enabled", True)))
    return LitellmRenderOut.model_validate(data)


@router.get("/{mid}", response_model=ModelEntryOut)
def get_model(mid: str):
    return _out(_load(mid))


@router.put("/{mid}", response_model=ModelEntryOut)
def update_model(mid: str, body: ModelEntryIn, user: User = Depends(require_admin)):
    snap = _load(mid)
    snap.reference.update({**body.model_dump(), "updated_at": db.now()})
    _changed()
    db.audit(user.uid, "model.update", user.email, model_id=mid, name=body.name, group=body.group, deploy=body.deploy)
    return _out(snap.reference.get())


@router.delete("/{mid}", status_code=204)
def delete_model(mid: str, user: User = Depends(require_admin)):
    snap = _load(mid)
    snap.reference.delete()
    _changed()
    db.audit(user.uid, "model.delete", user.email, model_id=mid, name=(snap.to_dict() or {}).get("name", ""))
