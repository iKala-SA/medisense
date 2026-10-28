"""Per-user connections: what the signed-in user can connect to, and their own link state.

An administrator creates a per-user OAuth connector (e.g. Google Calendar) and shares it (routers/connectors.py). Every user
who can see it then connects *their own* account here. Tokens stay in the Open Connector gateway; this router only asks the
gateway for an authorization URL and reports whether the user's own connection exists.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from .. import db, sharing
from ..auth import User, current_user
from ..engine import connectors as eng
from ..engine import open_connector as oc

router = APIRouter(prefix="/api/my-connectors", tags=["my-connectors"])


def _visible(user: User) -> dict:
    """id -> snapshot of gateway-backed connectors this user may use (owner, shared, account-wide, or admin)."""
    return {i: d for i, d in sharing.visible_docs("connectors", user).items() if eng.connector_mode(d.to_dict() or {})}


def _item(cid: str, data: dict, user: User, apps: list[dict] | None, problem: str = "") -> dict:
    spec = eng.TYPES[data["type"]]
    mode, service = eng.connector_mode(data), eng.connector_service(data)
    cfg = data.get("config") or {}
    mine = next((a for a in (apps or []) if a.get("service") == service and a.get("alias") == oc.conn_name(user.uid)), None)
    if problem:
        state = "unavailable"
    elif mode in ("shared", "none"):
        state = "shared"  # the admin holds the credential; nothing for the user to connect
    elif not mine:
        state = "not_connected"
    elif mine.get("status") == "active":
        state = "connected"
    else:
        state = "reauth_required"
    return {"id": cid, "type": data["type"], "service": service, "mode": mode, "label": data.get("label") or spec["label"],
            "description": data.get("scope") or cfg.get("description") or spec["description"],
            "allowed_actions": cfg.get("allowed_actions") or (eng.CALENDAR_READ if data["type"] == "calendar" else []), "state": state,
            "account_label": (mine or {}).get("accountLabel", ""), "scopes": (mine or {}).get("scopes", []), "problem": problem}


@router.get("")
def list_my_connectors(user: User = Depends(current_user)):
    docs = _visible(user)
    apps, problem = None, ""
    if docs:
        try:
            apps = oc.connected_apps()
        except oc.OpenConnectorError as exc:
            problem = "尚未設定連接器閘道" if exc.code == "not_configured" else "暫時無法連到連接器閘道"
    return [_item(i, d.to_dict() or {}, user, apps, problem) for i, d in sorted(docs.items(), key=lambda kv: (kv[1].to_dict() or {}).get("label", ""))]


def _own(connector_id: str, user: User) -> dict:
    docs = _visible(user)
    if connector_id not in docs:
        raise HTTPException(404, "connector not found or not shared with you")
    return docs[connector_id].to_dict() or {}


@router.post("/{connector_id}/connect")
def connect(connector_id: str, user: User = Depends(current_user)):
    """Start the user's own OAuth grant. The browser opens `authorization_url`; Google redirects back to the gateway."""
    data = _own(connector_id, user)
    service = eng.connector_service(data) or ""
    if eng.connector_mode(data) != "user_oauth":
        raise HTTPException(409, "此連接器由管理員共用憑證，不需要個別連線")
    try:
        if not oc.oauth_client_ready(service):
            raise HTTPException(503, "管理員尚未設定此服務的 OAuth 用戶端，請聯絡管理員")
        started = oc.start_authorization(service, user.uid)
    except oc.OpenConnectorError as exc:
        raise HTTPException(502 if exc.code != "not_configured" else 503, f"連接器閘道錯誤：{exc}") from exc
    db.audit(user.uid, "connector.link_start", user.email, connector_id=connector_id, type=data["type"])
    return {"authorization_url": started["url"], "state": started["state"]}


@router.get("/{connector_id}/status")
def status(connector_id: str, user: User = Depends(current_user)):
    data = _own(connector_id, user)
    try:
        return _item(connector_id, data, user, oc.connected_apps())
    except oc.OpenConnectorError:
        return _item(connector_id, data, user, None, "暫時無法連到連接器閘道")


@router.delete("/{connector_id}/connection", status_code=204)
def disconnect(connector_id: str, user: User = Depends(current_user)):
    data = _own(connector_id, user)
    service = eng.connector_service(data) or ""
    if eng.connector_mode(data) != "user_oauth":
        raise HTTPException(409, "此連接器由管理員共用憑證，沒有個人連線可中斷")
    try:
        if oc.connection(service, user.uid):
            oc.disconnect(service, user.uid, revoke=True)
    except oc.OpenConnectorError as exc:
        raise HTTPException(502, f"連接器閘道錯誤：{exc}") from exc
    db.audit(user.uid, "connector.unlink", user.email, connector_id=connector_id, type=data["type"])
    return Response(status_code=204)
