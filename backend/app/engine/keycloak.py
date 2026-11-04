"""Keycloak admin client: the open-source identity broker behind Microsoft Entra ID and LDAP / AD sign-in.

Medisense never stores an Entra client secret or an LDAP bind password: they are sent to Keycloak, which keeps them in its
own database and returns them masked (SECRET). Sending SECRET back on an update keeps the stored value.

Admin REST (Keycloak 26):
  POST /realms/{realm}/protocol/openid-connect/token                 client_credentials -> access_token
  GET/POST /admin/realms/{realm}/identity-provider/instances[/{alias}]   Entra = an "oidc" identity provider (alias ENTRA)
  GET  /admin/realms/{realm}/components?type=...&name=...              LDAP = a UserStorageProvider component (name LDAP)
  POST /admin/realms/{realm}/testLDAPConnection                        {action: testConnection | testAuthentication, ...}
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from ..config import settings

TIMEOUT = 20.0
SECRET = "**********"  # Keycloak's mask for stored secrets; sent back it means "keep"
ENTRA = "entra"  # identity provider alias, also the kc_idp_hint the login button sends
LDAP = "medisense-ldap"  # user federation component name
STORAGE = "org.keycloak.storage.UserStorageProvider"
LDAP_MAPPER = "org.keycloak.storage.ldap.mappers.LDAPStorageMapper"

VENDORS = {  # vendor -> Keycloak defaults (the same ones its admin console fills in)
    "ad": {"username": "sAMAccountName", "rdn": "cn", "uuid": "objectGUID", "classes": "person, organizationalPerson, user"},
    "other": {"username": "uid", "rdn": "uid", "uuid": "entryUUID", "classes": "inetOrgPerson, organizationalPerson"},
}

_token: dict[str, Any] = {}


class KeycloakError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def configured() -> bool:
    s = settings()
    return bool(s.keycloak_url and s.keycloak_client_secret)


def base() -> str:
    return settings().keycloak_url.rstrip("/")


def realm_url() -> str:
    return f"{base()}/realms/{settings().keycloak_realm}"


def issuer() -> str:
    """The OIDC issuer Identity Platform trusts (provider settings().sso_oidc_provider_id)."""
    return realm_url()


def entra_redirect_uri() -> str:
    """What the hospital registers as the redirect URI of its Entra app (Keycloak's broker endpoint)."""
    return f"{realm_url()}/broker/{ENTRA}/endpoint"


def _client() -> httpx.Client:  # tests swap in an httpx.MockTransport
    return httpx.Client(timeout=TIMEOUT)


def reset() -> None:
    _token.clear()


def _admin_token() -> str:
    if _token.get("value") and _token.get("exp", 0) > time.monotonic():
        return _token["value"]
    s = settings()
    try:
        with _client() as c:
            r = c.post(f"{realm_url()}/protocol/openid-connect/token",
                       data={"grant_type": "client_credentials", "client_id": s.keycloak_client_id, "client_secret": s.keycloak_client_secret})
    except httpx.HTTPError as exc:
        raise KeycloakError(f"Keycloak 無法連線：{exc.__class__.__name__}") from exc
    if r.status_code != 200:
        raise KeycloakError(f"Keycloak 管理授權失敗（{r.status_code}）：請確認 KEYCLOAK_CLIENT_SECRET", r.status_code)
    body = r.json()
    _token.update(value=body["access_token"], exp=time.monotonic() + max(30, int(body.get("expires_in", 60)) - 30))
    return _token["value"]


def _call(method: str, path: str, *, json: Any = None, params: dict | None = None, ok404: bool = False) -> Any:
    if not configured():
        raise KeycloakError("Keycloak 尚未部署或未設定（infra/15-keycloak.sh、KEYCLOAK_URL / KEYCLOAK_CLIENT_SECRET）", 503)
    url = f"{base()}/admin/realms/{settings().keycloak_realm}{path}"
    try:
        with _client() as c:
            r = c.request(method, url, json=json, params=params, headers={"Authorization": f"Bearer {_admin_token()}"})
    except httpx.HTTPError as exc:
        raise KeycloakError(f"Keycloak 無法連線：{exc.__class__.__name__}") from exc
    if r.status_code == 401:
        reset()
    if ok404 and r.status_code == 404:
        return None
    if r.status_code >= 400:
        try:
            body = r.json()
            msg = body.get("errorMessage") or body.get("error_description") or body.get("error") or r.text[:200]
        except ValueError:
            msg = r.text[:200]
        raise KeycloakError(f"Keycloak {r.status_code}：{msg}", r.status_code)
    if r.status_code == 201 and r.headers.get("location"):
        return {"id": r.headers["location"].rstrip("/").rsplit("/", 1)[-1]}
    return r.json() if r.content else None


def ping() -> dict:
    """{ok, error}: can the backend reach Keycloak with its admin client?"""
    if not configured():
        return {"ok": False, "error": "未設定"}
    try:
        _call("GET", "/identity-provider/instances")
        return {"ok": True, "error": ""}
    except KeycloakError as exc:
        return {"ok": False, "error": str(exc)}


# --- Microsoft Entra ID (an OIDC identity provider in the realm) -----------------------------------------------------

def entra_representation(tenant_id: str, client_id: str, client_secret: str, *, enabled: bool, display_name: str) -> dict:
    t = f"https://login.microsoftonline.com/{tenant_id}"
    return {
        "alias": ENTRA, "providerId": "oidc", "displayName": display_name or "Microsoft", "enabled": enabled,
        "trustEmail": True,  # Entra verified the address; Firebase needs email_verified
        "storeToken": False, "addReadTokenRoleOnCreate": False, "linkOnly": False,
        "firstBrokerLoginFlowAlias": "first broker login",
        "config": {
            "clientId": client_id, "clientSecret": client_secret or SECRET, "clientAuthMethod": "client_secret_post",
            "authorizationUrl": f"{t}/oauth2/v2.0/authorize", "tokenUrl": f"{t}/oauth2/v2.0/token",
            "logoutUrl": f"{t}/oauth2/v2.0/logout", "issuer": f"{t}/v2.0", "jwksUrl": f"{t}/discovery/v2.0/keys",
            "userInfoUrl": "https://graph.microsoft.com/oidc/userinfo", "useJwksUrl": "true", "validateSignature": "true",
            "defaultScope": "openid profile email", "pkceEnabled": "true", "pkceMethod": "S256", "syncMode": "IMPORT",
            "guiOrder": "1",
        },
    }


def get_entra() -> dict | None:
    return _call("GET", f"/identity-provider/instances/{ENTRA}", ok404=True)


def put_entra(tenant_id: str, client_id: str, client_secret: str, *, enabled: bool, display_name: str = "") -> None:
    """Create or update the Entra provider. An empty client_secret keeps the stored one (required on create)."""
    rep = entra_representation(tenant_id, client_id, client_secret, enabled=enabled, display_name=display_name)
    if get_entra() is None:
        if not client_secret:
            raise KeycloakError("第一次設定 Entra ID 需要填用戶端密碼（client secret）", 422)
        _call("POST", "/identity-provider/instances", json=rep)
    else:
        _call("PUT", f"/identity-provider/instances/{ENTRA}", json=rep)


def delete_entra() -> None:
    _call("DELETE", f"/identity-provider/instances/{ENTRA}", ok404=True)


# --- LDAP / Active Directory (user federation, read-only) ------------------------------------------------------------

def _first(cfg: dict, key: str, default: str = "") -> str:
    v = (cfg or {}).get(key)
    return (v[0] if isinstance(v, list) and v else v) if v not in (None, []) else default


def ldap_config(*, enabled: bool, vendor: str, connection_url: str, bind_dn: str, bind_password: str, users_dn: str,
                username_attr: str = "", user_filter: str = "", start_tls: bool = False) -> dict:
    d = VENDORS.get(vendor, VENDORS["other"])
    cfg = {
        "enabled": "true" if enabled else "false", "vendor": vendor if vendor in VENDORS else "other",
        "connectionUrl": connection_url, "startTls": "true" if start_tls else "false", "authType": "simple",
        "bindDn": bind_dn, "bindCredential": bind_password or SECRET, "usersDn": users_dn,
        "usernameLDAPAttribute": username_attr or d["username"], "rdnLDAPAttribute": d["rdn"], "uuidLDAPAttribute": d["uuid"],
        "userObjectClasses": d["classes"], "customUserSearchFilter": user_filter, "searchScope": "2",  # subtree
        "editMode": "READ_ONLY", "importEnabled": "true", "syncRegistrations": "false", "trustEmail": "true",
        "pagination": "true", "connectionPooling": "true", "useTruststoreSpi": "always", "priority": "0",
        "fullSyncPeriod": "-1", "changedSyncPeriod": "-1", "cachePolicy": "DEFAULT", "batchSizeForSync": "1000",
    }
    return {k: [v] for k, v in cfg.items()}


def get_ldap() -> dict | None:
    rows = _call("GET", "/components", params={"type": STORAGE, "name": LDAP}) or []
    return rows[0] if rows else None


def _realm_id() -> str:
    return (_call("GET", "") or {}).get("id") or settings().keycloak_realm


def put_ldap(*, email_attr: str = "mail", **fields) -> str:
    """Create or update the LDAP federation; returns its component id. An empty bind_password keeps the stored one."""
    cur = get_ldap()
    if cur is None and not fields.get("bind_password"):
        raise KeycloakError("第一次設定 LDAP 需要填 Bind 密碼", 422)
    rep = {"name": LDAP, "providerId": "ldap", "providerType": STORAGE, "config": ldap_config(**fields)}
    if cur is None:
        cid = (_call("POST", "/components", json={**rep, "parentId": _realm_id()}) or {}).get("id", "")
        cid = cid or (get_ldap() or {}).get("id", "")
    else:
        cid = cur["id"]
        _call("PUT", f"/components/{cid}", json={**cur, **rep, "id": cid, "config": {**(cur.get("config") or {}), **rep["config"]}})
    _set_email_attr(cid, email_attr or "mail")
    return cid


def _set_email_attr(cid: str, attr: str) -> None:
    """Point Keycloak's default `email` mapper (created with the provider) at the directory's e-mail attribute."""
    if not cid:
        return
    for m in _call("GET", "/components", params={"parent": cid, "type": LDAP_MAPPER}) or []:
        if m.get("name") == "email" and _first(m.get("config"), "ldap.attribute") != attr:
            _call("PUT", f"/components/{m['id']}", json={**m, "config": {**(m.get("config") or {}), "ldap.attribute": [attr]}})


def delete_ldap() -> None:
    cur = get_ldap()
    if cur:
        _call("DELETE", f"/components/{cur['id']}", ok404=True)


def test_ldap(action: str, *, connection_url: str, bind_dn: str = "", bind_password: str = "", start_tls: bool = False) -> None:
    """Raise KeycloakError unless Keycloak can reach the directory (testConnection) or bind with the account
    (testAuthentication). An empty password tests the stored one."""
    cur = get_ldap()
    body = {"action": action, "connectionUrl": connection_url, "bindDn": bind_dn, "bindCredential": bind_password or SECRET,
            "useTruststoreSpi": "always", "connectionTimeout": "5000", "startTls": "true" if start_tls else "false",
            "authType": "simple"}
    if cur and not bind_password:
        body["componentId"] = cur["id"]
    _call("POST", "/testLDAPConnection", json=body)
