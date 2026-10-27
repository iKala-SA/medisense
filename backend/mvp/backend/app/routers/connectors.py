"""Connectors: shared hospital-wide objects. Anyone signed in can list and attach; only the owner or
an admin edits credentials, tests, or deletes. Secret values go to Secret Manager and never come back."""
from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore

from .. import db
from ..auth import User, current_user, require_builder
from ..engine import connectors as eng
from ..engine import secrets as sm
from ..schemas import ConnectorIn, ConnectorOut, ConnectorStats

# Run-only users never see connectors (Hub + chat only); tool nodes call them server-side.
router = APIRouter(prefix="/api/connectors", tags=["connectors"], dependencies=[Depends(require_builder)])


def _usage() -> dict[str, int]:
    """connector_id -> number of agents whose canvas has a tool node bound to it."""
    counts: dict[str, int] = {}
    for d in db.client().collection("agents").select(["flow"]).stream():
        ids = {str(n.get("data", {}).get("connector_id")) for n in ((d.to_dict() or {}).get("flow") or {}).get("nodes", [])
               if n.get("type") == "tool" and n.get("data", {}).get("connector_id")}
        for cid in ids:
            counts[cid] = counts.get(cid, 0) + 1
    return counts


def _legacy_secrets(type_: str, config: dict) -> dict[str, str]:
    """Secret-kind values still sitting in plain config (saved before that field became a secret)."""
    return {k: v for k in eng.secret_fields(type_) if isinstance(v := config.get(k), str) and v}


def _public(type_: str, config: dict) -> dict:
    """Config with every secret-kind key removed, so credentials never reach Firestore config or API output."""
    hidden = set(eng.secret_fields(type_))
    return {k: v for k, v in config.items() if k not in hidden}


def _out(doc, usage: dict[str, int] | None = None) -> ConnectorOut:
    d = doc.to_dict() or {}
    type_, config = d.get("type", ""), d.get("config") or {}
    known = type_ in eng.TYPES
    stored = set((d.get("secrets") or {}).keys()) | (set(_legacy_secrets(type_, config)) if known else set())
    return ConnectorOut(id=doc.id, secret_fields=sorted(stored), agents_count=(usage or {}).get(doc.id, 0),
                        **{k: v for k, v in d.items() if k not in {"secrets", "config"}},
                        config=_public(type_, config) if known else config)


def _load(connector_id: str):
    snap = db.client().collection("connectors").document(connector_id).get()
    if not snap.exists:
        raise HTTPException(404, "connector not found")
    return snap


def _editable(snap, user: User):
    if (snap.to_dict() or {}).get("owner_uid") != user.uid and user.role != "admin":
        raise HTTPException(403, "only the connector owner or an admin can change it")


def _check_type(type_: str) -> dict:
    if type_ not in eng.TYPES:
        raise HTTPException(422, f"unknown connector type {type_}")
    return eng.TYPES[type_]


@router.get("/types")
def list_types(user: User = Depends(current_user)):
    return {"categories": eng.CATEGORIES, "types": [{"id": k, **v} for k, v in eng.TYPES.items()]}


@router.get("/stats", response_model=ConnectorStats)
def stats(user: User = Depends(current_user)):
    c = db.client()
    docs = [d.to_dict() or {} for d in c.collection("connectors").stream()]
    start = db.now().replace(hour=0, minute=0, second=0, microsecond=0)
    inv = sum(1 for _ in c.collection("audit").where(filter=firestore.FieldFilter("action", "==", "connector.invoke"))
              .where(filter=firestore.FieldFilter("at", ">=", start)).stream())
    return ConnectorStats(connected=sum(1 for d in docs if d.get("status") == "active"),
                          available_types=sum(1 for t in eng.TYPES.values() if t["available"]),
                          invocations_today=inv, mcp_nodes=sum(1 for d in docs if d.get("type") == "mcp" and d.get("status") == "active"))


@router.get("", response_model=list[ConnectorOut])
def list_connectors(user: User = Depends(current_user)):
    usage = _usage()
    q = db.client().collection("connectors").order_by("updated_at", direction=firestore.Query.DESCENDING)
    return [_out(d, usage) for d in q.stream()]


@router.post("", response_model=ConnectorOut, status_code=201)
def create_connector(body: ConnectorIn, user: User = Depends(current_user)):
    _check_type(body.type)
    ref = db.client().collection("connectors").document()
    allowed = set(eng.secret_fields(body.type))
    # A secret sent in config by an older client is still stored as a secret, never as config.
    incoming = {**_legacy_secrets(body.type, body.config), **{k: v for k, v in body.secrets.items() if v}}
    stored = {k: sm.put(ref.id, k, v) for k, v in incoming.items() if k in allowed}
    data = {"type": body.type, "label": body.label, "scope": body.scope, "config": _public(body.type, body.config), "secrets": stored,
            "redact_pii": body.redact_pii, "audit_payloads": body.audit_payloads, "owner_uid": user.uid,
            "owner_email": user.email, "status": "unverified", "last_test": None, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    db.audit(user.uid, "connector.create", user.email, connector_id=ref.id, type=body.type, label=body.label)
    return _out(ref.get())


@router.get("/{connector_id}", response_model=ConnectorOut)
def get_connector(connector_id: str, user: User = Depends(current_user)):
    return _out(_load(connector_id), _usage())


@router.put("/{connector_id}", response_model=ConnectorOut)
def update_connector(connector_id: str, body: ConnectorIn, user: User = Depends(current_user)):
    snap = _load(connector_id)
    _editable(snap, user)
    cur = snap.to_dict() or {}
    if body.type != cur.get("type"):
        raise HTTPException(422, "connector type cannot be changed; create a new connector")
    stored = dict(cur.get("secrets") or {})
    allowed = set(eng.secret_fields(body.type))
    cur_config = cur.get("config") or {}
    # Legacy plain-config secrets move into Secret Manager on the first save, even if the form left them blank.
    incoming = {**{k: v for k, v in _legacy_secrets(body.type, cur_config).items() if k not in stored},
                **_legacy_secrets(body.type, body.config), **{k: v for k, v in body.secrets.items() if v}}
    for k, v in incoming.items():
        if k in allowed:  # absent / empty == keep existing
            stored[k] = sm.put(connector_id, k, v)
    config = _public(body.type, body.config)
    changed_creds = any(v for v in body.secrets.values()) or config != _public(body.type, cur_config)
    snap.reference.update({"label": body.label, "scope": body.scope, "config": config, "secrets": stored,
                           "redact_pii": body.redact_pii, "audit_payloads": body.audit_payloads, "updated_at": db.now(),
                           **({"status": "unverified"} if changed_creds else {})})
    db.audit(user.uid, "connector.update", user.email, connector_id=connector_id, credentials_changed=bool(body.secrets))
    return _out(snap.reference.get(), _usage())


def _secrets(data: dict) -> dict[str, str]:
    return {k: sm.get(name) for k, name in (data.get("secrets") or {}).items()}


@router.post("/{connector_id}/test")
def test_connector(connector_id: str, user: User = Depends(current_user)):
    snap = _load(connector_id)
    _editable(snap, user)
    data = snap.to_dict() or {}
    result = eng.test(data["type"], data.get("config") or {}, _secrets(data))
    result["at"] = db.now()
    snap.reference.update({"status": "active" if result["ok"] else "error", "last_test": result, "updated_at": db.now()})
    db.audit(user.uid, "connector.test", user.email, connector_id=connector_id, ok=result["ok"], message=result["message"])
    return result


@router.get("/{connector_id}/actions")
def list_actions(connector_id: str, user: User = Depends(current_user)):
    """Static actions from the spec, or the MCP tool list captured by the last successful test."""
    data = _load(connector_id).to_dict() or {}
    spec = _check_type(data["type"])
    if spec["actions"] == "dynamic":
        tools = (data.get("last_test") or {}).get("tools") or []
        return [{"id": t["id"], "label": t["label"], "description": t.get("description", ""),
                 "args": [{"key": k, "label": k, "kind": "text", "required": k in (t.get("schema") or {}).get("required", [])}
                          for k in ((t.get("schema") or {}).get("properties") or {})], "write": True} for t in tools]
    return spec["actions"]


@router.delete("/{connector_id}", status_code=204)
def delete_connector(connector_id: str, user: User = Depends(current_user)):
    snap = _load(connector_id)
    _editable(snap, user)
    if (n := _usage().get(connector_id, 0)):
        raise HTTPException(409, f"{n} 個 Agent 仍使用此連接器，請先移除其工具節點")
    for name in ((snap.to_dict() or {}).get("secrets") or {}).values():
        sm.delete(name)
    snap.reference.delete()
    db.audit(user.uid, "connector.delete", user.email, connector_id=connector_id)
