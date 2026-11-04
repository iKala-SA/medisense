"""登入與 SSO: which sign-in methods the hospital uses (admin), and what the login page may show (public).

Google Workspace is Firebase's own Google provider (existing users keep their uid). Microsoft Entra ID and LDAP / AD go
through Keycloak (engine/keycloak.py), which Identity Platform trusts as one OIDC provider. Entra client secrets and LDAP
bind passwords are passed straight to Keycloak and never stored or returned here. Every change is audited (sso.*).
"""
from fastapi import APIRouter, Depends, HTTPException, Response

from .. import db
from ..auth import User, require_admin
from ..config import settings
from ..engine import keycloak as kc
from ..engine import sso
from ..schemas import SsoEntraIn, SsoGoogleIn, SsoLdapIn, SsoLdapTestIn

router = APIRouter(prefix="/api/sso", tags=["sso"], dependencies=[Depends(require_admin)])
public_router = APIRouter(prefix="/api/auth", tags=["sso"])


def _kc_error(exc: kc.KeycloakError) -> HTTPException:
    return HTTPException(exc.status if exc.status in (422, 503) else 502, str(exc))


def _save(section: str, values: dict, user: User) -> dict:
    cur = sso.load(fresh=True)
    sso.ref().set({section: {**cur[section], **values}, "updated_at": db.now(), "updated_by": user.email}, merge=True)
    sso.reset_cache()
    return sso.load(fresh=True)


def _identity_platform() -> dict:
    pid = settings().sso_oidc_provider_id
    try:
        from firebase_admin import auth as fb_auth
        p = fb_auth.get_oidc_provider_config(pid)
        return {"provider_id": pid, "ok": bool(p.enabled), "issuer": p.issuer, "error": "" if p.enabled else "提供者已停用"}
    except Exception as exc:  # noqa: BLE001 - not created yet, or the project is not on Identity Platform
        return {"provider_id": pid, "ok": False, "issuer": "", "error": f"尚未建立（infra/15-keycloak.sh）：{exc.__class__.__name__}"}


@router.get("")
def get_sso():
    cfg = sso.load(fresh=True)
    s = settings()
    status = kc.ping()
    entra_live = ldap_live = None
    if status["ok"]:
        try:
            entra_live, ldap_live = kc.get_entra(), kc.get_ldap()
        except kc.KeycloakError as exc:
            status = {"ok": False, "error": str(exc)}
    return {
        "google": {**cfg["google"], "env_domains": s.allowed_domain_list, "effective_domains": sso.allowed_domains(cfg)},
        "entra": {**cfg["entra"], "in_keycloak": entra_live is not None, "has_secret": entra_live is not None,
                  "redirect_uri": kc.entra_redirect_uri() if s.keycloak_url else ""},
        "ldap": {**cfg["ldap"], "in_keycloak": ldap_live is not None, "has_password": ldap_live is not None},
        "keycloak": {"configured": kc.configured(), "url": s.keycloak_url, "realm": s.keycloak_realm, **status},
        "identity_platform": _identity_platform(),
        "updated_at": cfg.get("updated_at"), "updated_by": cfg.get("updated_by", ""),
    }


@router.put("/google")
def put_google(body: SsoGoogleIn, user: User = Depends(require_admin)):
    old = sso.load(fresh=True)["google"]
    cfg = _save("google", body.model_dump(), user)
    db.audit(user.uid, "sso.google.update", user.email, enabled=body.enabled, allowed_domains=body.allowed_domains,
             allowed_domains_old=old.get("allowed_domains", []), hd=body.hd)
    return cfg["google"]


@router.put("/entra")
def put_entra(body: SsoEntraIn, user: User = Depends(require_admin)):
    try:
        kc.put_entra(body.tenant_id, body.client_id, body.client_secret, enabled=body.enabled, display_name=body.display_name)
    except kc.KeycloakError as exc:
        raise _kc_error(exc) from exc
    cfg = _save("entra", body.model_dump(exclude={"client_secret"}), user)
    db.audit(user.uid, "sso.entra.update", user.email, enabled=body.enabled, tenant_id=body.tenant_id, client_id=body.client_id,
             secret_changed=bool(body.client_secret))
    return {**cfg["entra"], "redirect_uri": kc.entra_redirect_uri()}


@router.delete("/entra", status_code=204)
def delete_entra(user: User = Depends(require_admin)):
    try:
        kc.delete_entra()
    except kc.KeycloakError as exc:
        raise _kc_error(exc) from exc
    _save("entra", {**sso.DEFAULTS["entra"]}, user)
    db.audit(user.uid, "sso.entra.delete", user.email)
    return Response(status_code=204)


@router.put("/ldap")
def put_ldap(body: SsoLdapIn, user: User = Depends(require_admin)):
    f = body.model_dump()
    try:
        kc.put_ldap(enabled=body.enabled, vendor=body.vendor, connection_url=body.connection_url, bind_dn=body.bind_dn,
                    bind_password=body.bind_password, users_dn=body.users_dn, username_attr=body.username_attr,
                    user_filter=body.user_filter, start_tls=body.start_tls, email_attr=body.email_attr)
    except kc.KeycloakError as exc:
        raise _kc_error(exc) from exc
    cfg = _save("ldap", {k: v for k, v in f.items() if k != "bind_password"}, user)
    db.audit(user.uid, "sso.ldap.update", user.email, enabled=body.enabled, vendor=body.vendor, connection_url=body.connection_url,
             bind_dn=body.bind_dn, users_dn=body.users_dn, password_changed=bool(body.bind_password))
    return cfg["ldap"]


@router.delete("/ldap", status_code=204)
def delete_ldap(user: User = Depends(require_admin)):
    try:
        kc.delete_ldap()
    except kc.KeycloakError as exc:
        raise _kc_error(exc) from exc
    _save("ldap", {**sso.DEFAULTS["ldap"]}, user)
    db.audit(user.uid, "sso.ldap.delete", user.email)
    return Response(status_code=204)


@router.post("/ldap/test")
def test_ldap(body: SsoLdapTestIn, user: User = Depends(require_admin)):
    """{ok, message}: a failed test is an answer (200), not an error; only an unreachable Keycloak is."""
    action = "testConnection" if body.action == "connection" else "testAuthentication"
    try:
        kc.test_ldap(action, connection_url=body.connection_url, bind_dn=body.bind_dn, bind_password=body.bind_password,
                     start_tls=body.start_tls)
        ok, msg = True, "連線成功" if body.action == "connection" else "Bind 帳號驗證成功"
    except kc.KeycloakError as exc:
        if exc.status in (0, 401, 403, 503):
            raise _kc_error(exc) from exc
        ok, msg = False, str(exc)
    db.audit(user.uid, "sso.ldap.test", user.email, test=body.action, connection_url=body.connection_url, ok=ok)
    return {"ok": ok, "message": msg}


@public_router.get("/providers")
def providers():
    """No sign-in needed: which buttons the login page shows. Labels and switches only."""
    return sso.public_providers()
