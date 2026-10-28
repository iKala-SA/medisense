"""Enable any Open Connector service as a platform connector (administrators only).

The wizard behind "啟用此服務" in the service catalog. One connector per service; what it records is only the choice (which
actions are allowed, how users authenticate). Credentials never touch this backend's storage: OAuth client secrets and shared
API keys go straight into the gateway, which keeps them encrypted.

  oauth2             every user connects their own account (my-connectors); scopes = exactly what the allowed actions need
  api_key / custom   one credential entered here, held by the gateway as a shared connection; users just use it
  no_auth            nothing to configure
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore
from pydantic import BaseModel, Field

from .. import db, sharing
from ..auth import User, require_admin
from ..config import settings
from ..engine import connectors as eng
from ..engine import gateway_actions as ga
from ..engine import open_connector as oc
from ..schemas import ConnectorOut, Share
from .connectors import _out, _usage

router = APIRouter(prefix="/api/gateway-connectors", tags=["gateway-connectors"], dependencies=[Depends(require_admin)])


class GatewayConnectorIn(BaseModel):
    service: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    auth_mode: Literal["oauth2", "api_key", "custom_credential", "no_auth"]
    allowed_actions: list[str] = Field(default_factory=list, max_length=500)
    client: dict[str, str] = Field(default_factory=dict)       # oauth2: OAuth client fields (clientId, clientSecret, ...)
    credentials: dict[str, str] = Field(default_factory=dict)  # api_key / custom_credential field values
    share: Share | None = None


class GatewayConnectorUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    allowed_actions: list[str] | None = Field(default=None, max_length=500)
    client: dict[str, str] = Field(default_factory=dict)       # only the fields being replaced
    credentials: dict[str, str] = Field(default_factory=dict)  # replaces the shared credential when non-empty


def _gw(exc: oc.OpenConnectorError) -> HTTPException:
    if exc.code == "not_configured":
        return HTTPException(503, "尚未設定連接器閘道")
    # Gateway validation (bad credential, missing field) is the admin's input problem, not a server fault.
    return HTTPException(422 if exc.status in (400, 401, 403, 409, 422) or exc.code in ("invalid_input", "authorization_failed") else 502, f"連接器閘道：{exc}")


def _existing(service: str):
    q = db.client().collection("connectors").where(filter=firestore.FieldFilter("config.service", "==", service)).stream()
    return next((d for d in q if (d.to_dict() or {}).get("type") == "gateway"), None)


def _options(service: str) -> tuple[dict, list[dict]]:
    """(setup payload, normalized auth options with the fields to ask for)."""
    setup = oc.setup(service)
    opts = []
    for a in setup.get("auth") or []:
        t = a.get("type")
        fields = a.get("clientFields") if t == "oauth2" else a.get("fields")
        opts.append({"type": t, "label": a.get("label", ""), "description": a.get("description", ""), "fields": fields or [],
                     "scopes": a.get("scopes") or [], "optional_scopes": a.get("optionalScopes") or []})
    return setup, opts


def _check_actions(service: str, ids: list[str]) -> list[str]:
    valid = {a["id"] for a in ga.actions_of(service)}
    bad = [i for i in ids if i not in valid]
    if bad:
        raise HTTPException(422, f"服務 {service} 沒有這些動作：{', '.join(bad[:5])}")
    return list(dict.fromkeys(ids))


GOOGLE_SERVICES = {"gmail", "googlecalendar", "googledrive", "googledocs", "googlesheets", "googleslides", "googleforms", "googlemeet",
                   "googlechat", "googletasks"}


def platform_client(service: str) -> dict:
    """The platform-wide OAuth app for this service's vendor (Google only so far), or {} when none is configured."""
    s = settings()
    if service in GOOGLE_SERVICES and s.google_oauth_client_id and s.google_oauth_client_secret:
        return {"clientId": s.google_oauth_client_id, "clientSecret": s.google_oauth_client_secret}
    return {}


def _require_fields(opt: dict, values: dict, *, have_stored: bool = False) -> None:
    missing = [f.get("label") or f["key"] for f in opt["fields"] if f.get("required") and not values.get(f["key"]) and not have_stored]
    if missing:
        raise HTTPException(422, f"請填寫：{'、'.join(missing)}")


@router.get("/setup/{service}")
def setup_info(service: str, user: User = Depends(require_admin)):
    """Everything the wizard needs: auth options with their fields, redirect URI to register, all actions grouped by operation."""
    try:
        if service not in {p["service"] for p in oc.providers()}:
            raise HTTPException(404, "unknown service")
        setup, opts = _options(service)
        actions = ga.actions_of(service)
    except oc.OpenConnectorError as exc:
        raise _gw(exc) from exc
    client = setup.get("oauthClient") or {}
    ex = _existing(service)
    return {"service": service, "name": oc.provider_detail_cached(service).get("displayName") or service,
            "auth_options": opts, "oauth_client": {"configured": bool(client.get("configured")) or bool(platform_client(service)), "platform": bool(platform_client(service)), "expected_redirect_uri": client.get("expectedRedirectUri", ""),
                                                   "missing_fields": client.get("missingFields") or []},
            "actions": [{k: a[k] for k in ("id", "name", "description", "operation", "scopes")} for a in actions],
            "existing_connector_id": ex.id if ex else None}


class ScopePreviewIn(BaseModel):
    service: str
    allowed_actions: list[str] = Field(default_factory=list, max_length=500)


@router.post("/preview-scopes")
def preview_scopes(body: ScopePreviewIn, user: User = Depends(require_admin)):
    """What users will be asked to grant for a given selection of actions (OAuth services). Nothing is saved."""
    try:
        actions = _check_actions(body.service, body.allowed_actions)
        by_id = {a["id"]: a for a in ga.actions_of(body.service)}
        scopes = ga.scopes_for(body.service, actions)
    except oc.OpenConnectorError as exc:
        raise _gw(exc) from exc
    ops = {"read": 0, "write": 0, "destructive": 0}
    for i in actions:
        ops[by_id[i]["operation"]] = ops.get(by_id[i]["operation"], 0) + 1
    return {"service": body.service, "scopes": scopes, "identity_scopes": [x for x in scopes if x in ga.IDENTITY_SCOPES],
            "data_scopes": [x for x in scopes if x not in ga.IDENTITY_SCOPES], "operations": ops,
            "grants_write": ops["write"] + ops["destructive"] > 0}


def _configure(service: str, mode: str, body, connector_id: str, actions: list[str], opts: list[dict], oauth_configured: bool) -> list[str]:
    """Push credentials/scopes into the gateway. Returns the OAuth scopes requested (oauth2) or []."""
    opt = next((o for o in opts if o["type"] == mode), None)
    if not opt:
        raise HTTPException(422, f"服務 {service} 不支援授權方式 {mode}")
    try:
        if mode == "oauth2":
            if not body.client:
                body.client = platform_client(service)
                oauth_configured = oauth_configured or bool(body.client)
            _require_fields(opt, body.client, have_stored=oauth_configured)
            scopes = ga.scopes_for(service, actions)
            oc.save_oauth_client(service, body.client, scopes, {f["key"] for f in opt["fields"] if f.get("secret")})
            return scopes
        if mode in ("api_key", "custom_credential"):
            if body.credentials or not isinstance(body, GatewayConnectorUpdate):
                _require_fields(opt, body.credentials)
                oc.save_shared_connection(service, mode, body.credentials, oc.shared_name(connector_id))
    except oc.OpenConnectorError as exc:
        raise _gw(exc) from exc
    return []


@router.post("", response_model=ConnectorOut, status_code=201)
def enable_service(body: GatewayConnectorIn, user: User = Depends(require_admin)):
    try:
        if body.service not in {p["service"] for p in oc.providers()}:
            raise HTTPException(404, "unknown service")
        setup, opts = _options(body.service)
        actions = _check_actions(body.service, body.allowed_actions)
    except oc.OpenConnectorError as exc:
        raise _gw(exc) from exc
    if body.auth_mode != "no_auth" and not actions:
        raise HTTPException(422, "請至少允許一個動作")
    if _existing(body.service):
        raise HTTPException(409, f"服務 {body.service} 已啟用，請編輯既有的連接器")
    if body.auth_mode not in set(oc.provider_detail_cached(body.service).get("authTypes") or []):
        raise HTTPException(422, f"服務 {body.service} 不支援授權方式 {body.auth_mode}")
    ref = db.client().collection("connectors").document()
    scopes = _configure(body.service, body.auth_mode, body, ref.id, actions, opts, bool((setup.get("oauthClient") or {}).get("configured")))
    data = {**sharing.share_fields(body.share or Share()), "type": "gateway", "label": body.label, "scope": body.description,
            "config": {"service": body.service, "auth_mode": body.auth_mode, "allowed_actions": actions, "scopes": scopes, "description": body.description},
            "secrets": {}, "redact_pii": True, "audit_payloads": True, "owner_uid": user.uid, "owner_email": user.email,
            "status": "unverified", "last_test": None, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    db.audit(user.uid, "connector.create", user.email, connector_id=ref.id, type="gateway", label=body.label, service=body.service,
             auth_mode=body.auth_mode, actions=len(actions))
    return _out(ref.get(), _usage())


@router.put("/{connector_id}", response_model=ConnectorOut)
def update_enabled_service(connector_id: str, body: GatewayConnectorUpdate, user: User = Depends(require_admin)):
    snap = db.client().collection("connectors").document(connector_id).get()
    doc = snap.to_dict() or {}
    if not snap.exists or doc.get("type") != "gateway":
        raise HTTPException(404, "gateway connector not found")
    cfg = dict(doc.get("config") or {})
    service, mode = cfg["service"], cfg["auth_mode"]
    try:
        setup, opts = _options(service)
        actions = _check_actions(service, body.allowed_actions) if body.allowed_actions is not None else cfg.get("allowed_actions", [])
    except oc.OpenConnectorError as exc:
        raise _gw(exc) from exc
    if mode != "no_auth" and not actions:
        raise HTTPException(422, "請至少允許一個動作")
    changed_scopes = mode == "oauth2" and body.allowed_actions is not None and set(actions) != set(cfg.get("allowed_actions", []))
    if body.client or body.credentials or changed_scopes:
        scopes = _configure(service, mode, body, connector_id, actions, opts, bool((setup.get("oauthClient") or {}).get("configured")))
        if mode == "oauth2":
            cfg["scopes"] = scopes
    cfg["allowed_actions"] = actions
    if body.description is not None:
        cfg["description"] = body.description
    update = {"config": cfg, "updated_at": db.now(), "status": "unverified"}
    if body.label is not None:
        update["label"] = body.label
    if body.description is not None:
        update["scope"] = body.description
    snap.reference.update(update)
    db.audit(user.uid, "connector.update", user.email, connector_id=connector_id, service=service, credentials_changed=bool(body.client or body.credentials),
             scopes_changed=changed_scopes)
    return _out(snap.reference.get(), _usage())
