"""Model registry (models/{id}), admin-only: which provider models exist, which routing group each serves,
where it runs (cloud / on-prem) and what it costs. Secrets are Secret Manager NAMES only, never values.

Every save (create / update / delete) re-renders the LiteLLM config.yaml into Firestore `config/litellm_render`.
`POST /apply` (套用到 LiteLLM) snapshots that render into `config/litellm_deploy` and dispatches the GitHub Actions
workflow .github/workflows/litellm-apply.yml, which runs infra/09-apply-litellm-config.sh against the snapshot
(rebuild + redeploy the LiteLLM Cloud Run service) and commits litellm/config.yaml. `GET /deploy` reports the run.
The existing GET /api/models (live LiteLLM view, main.py) is unrelated and unchanged.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..auth import User, require_admin
from ..engine import github_actions, litellm_config, llm
from ..schemas import LitellmRenderOut, ModelEntryIn, ModelEntryOut, ProvidersIn, ProvidersOut

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


log = logging.getLogger(__name__)
DONE = ("deployed", "failed")
START_TIMEOUT_S = 600


def _rows() -> list[dict]:
    return [{**(d.to_dict() or {}), "id": d.id} for d in _col().stream()]


def _render(user: User) -> dict:
    """Render config.yaml from the current registry into config/litellm_render as the next version."""
    rows = _rows()
    ref = db.client().collection("config").document("litellm_render")
    prev = ref.get()
    version = int(((prev.to_dict() if prev.exists else None) or {}).get("version", 0)) + 1
    data = {"yaml": litellm_config.render(rows), "version": version, "requested_by": user.email,
            "requested_at": db.now(), "status": "rendered", "secrets": litellm_config.required_secrets(rows)}
    ref.set(data)
    return data


def _approved() -> list[str]:
    snap = db.client().collection("config").document("model_providers").get()
    row = (snap.to_dict() if snap.exists else None) or {}
    return list(row.get("approved") if row.get("approved") is not None else litellm_config.DEFAULT_APPROVED)


def _require_approved(body: ModelEntryIn) -> None:
    if body.enabled and body.deploy == "cloud":
        bad = litellm_config.unapproved([body.model_dump()], _approved())
        if bad:
            raise HTTPException(409, f"provider '{litellm_config.provider_of(bad[0])}' has not been approved by the security review; "
                                     "an admin must approve it under 已核准的雲端供應商 first (or save the model disabled)")


def _changed(user: User) -> None:
    llm.reset_registry_cache()
    _render(user)


def _refresh(data: dict) -> dict:
    """Pull the GitHub run state into an unfinished config/litellm_deploy record (best effort)."""
    if data.get("status") in DONE:
        return data
    try:
        run = github_actions.find_run(int(data.get("version", 0)))
    except (github_actions.NotConfigured, httpx.HTTPError) as e:
        log.warning("litellm deploy status unavailable: %s", e)
        return data
    if not run:
        at = data.get("requested_at")
        if data.get("status") != "dispatched" or not at or (db.now() - at).total_seconds() < START_TIMEOUT_S:
            return data
        run = {"status": "completed", "conclusion": "not_started", "html_url": ""}  # dispatch accepted, never ran
    status = ("deployed" if run["conclusion"] == "success" else "failed") if run["status"] == "completed" \
        else "deploying" if run["status"] == "in_progress" else "queued"
    patch = {"status": status, "run_url": run["html_url"] or ""}
    if patch != {k: data.get(k) for k in patch}:
        db.client().collection("config").document("litellm_deploy").update(patch)
    return {**data, **patch}


@router.get("/providers", response_model=ProvidersOut)
def get_providers():
    snap = db.client().collection("config").document("model_providers").get()
    row = (snap.to_dict() if snap.exists else None) or {}
    return ProvidersOut(approved=_approved(), updated_by=row.get("updated_by", ""), updated_at=row.get("updated_at"))


@router.put("/providers", response_model=ProvidersOut)
def put_providers(body: ProvidersIn, user: User = Depends(require_admin)):
    old = _approved()
    data = {"approved": body.approved, "updated_by": user.email, "updated_at": db.now()}
    db.client().collection("config").document("model_providers").set(data)
    db.audit(user.uid, "model.providers", user.email, old=old, new=body.approved)
    return ProvidersOut(**data)


@router.get("", response_model=list[ModelEntryOut])
def list_models():
    return sorted((_out(d) for d in _col().stream()), key=lambda m: (m.group, m.name.lower()))


@router.post("", response_model=ModelEntryOut, status_code=201)
def create_model(body: ModelEntryIn, user: User = Depends(require_admin)):
    _require_approved(body)
    ref = _col().document()
    data = {**body.model_dump(), "created_by": user.email, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    _changed(user)
    db.audit(user.uid, "model.create", user.email, model_id=ref.id, name=body.name, group=body.group, deploy=body.deploy)
    return ModelEntryOut(id=ref.id, **data)


@router.get("/rendered", response_model=LitellmRenderOut | None)
def get_rendered():
    """The last rendered config (config/litellm_render), or null."""
    snap = db.client().collection("config").document("litellm_render").get()
    return LitellmRenderOut.model_validate(snap.to_dict()) if snap.exists else None


@router.get("/deploy", response_model=LitellmRenderOut | None)
def get_deploy():
    """The last 套用到 LiteLLM request (config/litellm_deploy) with its GitHub Actions run state, or null."""
    snap = db.client().collection("config").document("litellm_deploy").get()
    return LitellmRenderOut.model_validate(_refresh(snap.to_dict() or {})) if snap.exists else None


@router.post("/apply", response_model=LitellmRenderOut)
def apply_registry(user: User = Depends(require_admin)):
    """Render the registry and deploy it to LiteLLM via the GitHub Actions workflow (infra/09)."""
    rows = _rows()
    bad = litellm_config.unapproved(rows, _approved())
    if bad:
        raise HTTPException(409, "cannot deploy: provider(s) not approved by the security review: "
                                 + ", ".join(sorted({litellm_config.provider_of(m) for m in bad})))
    missing = litellm_config.missing_groups(rows)
    if missing:
        raise HTTPException(409, f"cannot deploy: no enabled model in group(s) {', '.join(missing)}")
    deploy = db.client().collection("config").document("litellm_deploy")
    cur = deploy.get()
    if cur.exists and _refresh(cur.to_dict() or {}).get("status") not in DONE:
        raise HTTPException(409, "a LiteLLM deploy is already in progress")
    data = {**_render(user), "status": "dispatched", "run_url": ""}
    deploy.set(data)
    try:
        github_actions.dispatch(data["version"], user.email)
    except github_actions.NotConfigured as e:
        deploy.update({"status": "failed"})
        raise HTTPException(503, f"LiteLLM deploy is not configured: {e}") from e
    except httpx.HTTPError as e:
        deploy.update({"status": "failed"})
        raise HTTPException(502, f"could not start the deploy workflow: {e}") from e
    db.audit(user.uid, "model.apply", user.email, version=data["version"],
             models=sum(1 for r in rows if r.get("enabled", True)))
    return LitellmRenderOut.model_validate(data)


@router.get("/{mid}", response_model=ModelEntryOut)
def get_model(mid: str):
    return _out(_load(mid))


@router.put("/{mid}", response_model=ModelEntryOut)
def update_model(mid: str, body: ModelEntryIn, user: User = Depends(require_admin)):
    snap = _load(mid)
    _require_approved(body)
    snap.reference.update({**body.model_dump(), "updated_at": db.now()})
    _changed(user)
    db.audit(user.uid, "model.update", user.email, model_id=mid, name=body.name, group=body.group, deploy=body.deploy)
    return _out(snap.reference.get())


@router.delete("/{mid}", status_code=204)
def delete_model(mid: str, user: User = Depends(require_admin)):
    snap = _load(mid)
    snap.reference.delete()
    _changed(user)
    db.audit(user.uid, "model.delete", user.email, model_id=mid, name=(snap.to_dict() or {}).get("name", ""))
