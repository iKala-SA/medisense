"""Sign-in methods (登入與 SSO) kept in config/sso. No secrets here: Entra / LDAP secrets live in Keycloak only.

  config/sso {google: {enabled, allowed_domains: [..], hd},
              entra:  {enabled, tenant_id, client_id, display_name},
              ldap:   {enabled, vendor, connection_url, start_tls, bind_dn, users_dn, username_attr, email_attr, user_filter,
                       display_name},
              updated_at, updated_by}

Read on every request by auth.current_user (allowed domains, which providers may sign in), so it is cached for CACHE_S.
"""
from __future__ import annotations

import time

from .. import db
from ..config import settings

CACHE_S = 30.0
GOOGLE_PROVIDER = "google.com"

DEFAULTS = {
    "google": {"enabled": True, "allowed_domains": [], "hd": ""},
    "entra": {"enabled": False, "tenant_id": "", "client_id": "", "display_name": "Microsoft"},
    "ldap": {"enabled": False, "vendor": "ad", "connection_url": "", "start_tls": False, "bind_dn": "", "users_dn": "",
             "username_attr": "", "email_attr": "mail", "user_filter": "", "display_name": "院內帳號"},
}

_cache: dict[str, tuple[float, dict]] = {}


def ref():
    return db.client().collection("config").document("sso")


def reset_cache() -> None:
    _cache.clear()


def load(fresh: bool = False) -> dict:
    hit = _cache.get("cfg")
    if hit and not fresh and time.monotonic() - hit[0] < CACHE_S:
        return hit[1]
    try:
        snap = ref().get()
        raw = (snap.to_dict() if snap.exists else None) or {}
    except Exception:  # noqa: BLE001 - a config outage must not lock everyone out: fall back to the defaults
        raw = {}
    cfg = {k: {**v, **(raw.get(k) or {})} for k, v in DEFAULTS.items()}
    cfg["updated_at"], cfg["updated_by"] = raw.get("updated_at"), raw.get("updated_by", "")
    _cache["cfg"] = (time.monotonic(), cfg)
    return cfg


def allowed_domains(cfg: dict | None = None) -> list[str]:
    """ALLOWED_DOMAINS (deployment) plus the domains an admin added on the settings page. Empty = any domain."""
    extra = [d.strip().lower() for d in ((cfg or load())["google"].get("allowed_domains") or []) if isinstance(d, str) and d.strip()]
    return list(dict.fromkeys([*settings().allowed_domain_list, *extra]))


def provider_allowed(sign_in_provider: str, cfg: dict | None = None) -> bool:
    """May a token from this Firebase sign-in provider sign in right now? Unknown providers (custom tokens in tooling)
    are left alone; bootstrap admins are exempted by the caller."""
    cfg = cfg or load()
    if sign_in_provider == GOOGLE_PROVIDER:
        return bool(cfg["google"].get("enabled", True))
    if sign_in_provider == settings().sso_oidc_provider_id:
        return bool(cfg["entra"].get("enabled") or cfg["ldap"].get("enabled"))
    return True


def public_providers() -> dict:
    """What the login page may show (GET /api/auth/providers, no sign-in): buttons only, no directory details."""
    cfg = load()
    oidc = settings().sso_oidc_provider_id
    return {
        "google": {"enabled": bool(cfg["google"]["enabled"]), "hd": cfg["google"].get("hd", "")},
        "entra": {"enabled": bool(cfg["entra"]["enabled"]), "label": cfg["entra"].get("display_name") or "Microsoft",
                  "provider_id": oidc, "hint": "entra"},
        "ldap": {"enabled": bool(cfg["ldap"]["enabled"]), "label": cfg["ldap"].get("display_name") or "院內帳號",
                 "provider_id": oidc, "hint": ""},
    }
