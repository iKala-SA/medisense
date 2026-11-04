"""Firebase ID-token verification, Workspace-domain allow-list and the platform account record.

Flow: browser signs in with Google through Firebase Auth -> gets an ID token -> sends it as
`Authorization: Bearer <token>` -> we verify signature/expiry with firebase-admin and then
enforce that the e-mail belongs to an allowed Google Workspace domain (the `hd` claim is
only present for Workspace accounts, so we check both).

Accounts (decided 2026-10-26): users/{email} holds role (admin | builder | user) and status
(active | suspended). The first request of an unknown e-mail creates it as a run-only `user`;
an admin may pre-register an e-mail with a role, and the uid is filled in on first sign-in.
ADMIN_EMAILS are always admin and can never be suspended, so the platform cannot lock itself out.
Records are cached per instance for CACHE_TTL seconds, so a change reaches other instances
within that time (suspension also disables the Firebase user, see routers/users.py).

SSO (2026-11-04): besides Google, Microsoft Entra ID and LDAP sign in through Keycloak, which Identity Platform trusts as
the OIDC provider settings().sso_oidc_provider_id. The token is still a Firebase ID token. Allowed domains are
ALLOWED_DOMAINS plus the ones an admin adds on 登入與 SSO (engine/sso.py); a switched-off provider is refused (bootstrap
admins excepted). The Firebase uid keys every user's data, so a second provider must be LINKED to the existing Firebase
user (same uid), never sign in as a new one: a different uid for an e-mail whose user still exists is refused (409).
"""
import threading
import time
from dataclasses import dataclass

import firebase_admin
from fastapi import Depends, HTTPException, Request
from firebase_admin import auth as fb_auth
from google.api_core.exceptions import AlreadyExists

from . import db
from .config import settings
from .engine import sso
from .permissions import RESOURCES

if not firebase_admin._apps:  # documented firebase-admin idiom
    firebase_admin.initialize_app(options={"projectId": settings().google_cloud_project})

ROLES = ("admin", "builder", "user")
DEFAULT_ROLE = "user"
CACHE_TTL = 30  # seconds an account record is trusted before re-reading Firestore
LAST_SEEN_EVERY = 600  # seconds between last_seen_at writes per account

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


@dataclass(frozen=True)
class User:
    uid: str
    email: str
    name: str
    role: str  # "admin" | "builder" | "user"
    department: str = ""
    original_view: bool = False  # may open original files that contain personal data (an admin grants it per account)
    roles: tuple[str, ...] = ()  # assigned role ids (roles/{id}); record only, access still follows `role`
    groups: tuple[str, ...] = ()  # group ids the user belongs to (groups/{id}); membership, grants no access itself


def is_bootstrap_admin(email: str) -> bool:
    return email.lower() in settings().admin_email_list


def effective_role(data: dict) -> str:
    if is_bootstrap_admin(data.get("email", "")):
        return "admin"
    return data.get("role") if data.get("role") in ROLES else DEFAULT_ROLE


def users():
    return db.client().collection("users")


def forget(email: str) -> None:
    """Drop the cached record so this instance sees an admin's change immediately."""
    with _lock:
        _cache.pop(email.lower(), None)


def _other_user_exists(uid: str) -> bool:
    try:
        return not fb_auth.get_user(uid).disabled
    except Exception:  # noqa: BLE001 - not found (or lookup failed): nothing left to protect
        return False


def _account(uid: str, email: str, name: str, provider: str = "") -> dict:
    with _lock:
        hit = _cache.get(email)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    ref = users().document(email)
    snap = ref.get()
    at = db.now()
    created = False
    if not snap.exists:
        data = {"email": email, "uid": uid, "name": name, "role": "admin" if is_bootstrap_admin(email) else DEFAULT_ROLE,
                "status": "active", "department": "", "created_at": at, "created_by": "",
                "first_login_at": at, "last_seen_at": at, "login_provider": provider}
        try:  # create() fails if a parallel first request (any instance) got there first
            ref.create(data)
            created = True
            db.audit(uid, "user.first_login", email, target_email=email, role=data["role"])
        except AlreadyExists:
            snap = ref.get()
    if not created:
        data = snap.to_dict() or {}
        patch: dict = {}
        if data.get("uid") != uid:  # pre-registered (no uid yet) or the Google account was re-created
            if data.get("uid") and provider and provider != sso.GOOGLE_PROVIDER and _other_user_exists(data["uid"]):
                # an SSO sign-in that was not linked: taking over the record would orphan every session and file
                raise HTTPException(409, "此 email 已用其他方式登入過。請先用原本的方式登入，再連結這個登入方式。")
            patch["uid"] = uid
            if not data.get("first_login_at"):
                patch["first_login_at"] = at
                db.audit(uid, "user.first_login", email, target_email=email, role=effective_role(data), preregistered=True)
        if provider and data.get("login_provider") != provider:
            patch["login_provider"] = provider
        if name and data.get("name") != name:
            patch["name"] = name
        last = data.get("last_seen_at")
        if not last or (at - last).total_seconds() > LAST_SEEN_EVERY:
            patch["last_seen_at"] = at
        if patch:
            ref.update(patch)
            data = {**data, **patch}
    with _lock:
        _cache[email] = (time.monotonic() + CACHE_TTL, data)
    return data


def _bearer(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    return header.split(" ", 1)[1].strip()


def current_user(token: str = Depends(_bearer)) -> User:
    try:
        claims = fb_auth.verify_id_token(token, check_revoked=False)
    except Exception as exc:  # expired, bad signature, wrong project
        raise HTTPException(401, f"invalid token: {exc.__class__.__name__}") from exc

    email = (claims.get("email") or "").lower()
    if not email or not claims.get("email_verified", False):
        raise HTTPException(403, "verified e-mail required")

    cfg = sso.load()
    allowed = sso.allowed_domains(cfg)
    domain = email.rsplit("@", 1)[-1]
    fb = claims.get("firebase", {}) or {}
    hd = (fb.get("sign_in_attributes", {}) or {}).get("hd") or claims.get("hd")
    if allowed and domain not in allowed and (hd or "").lower() not in allowed:
        raise HTTPException(403, f"domain {domain} is not allowed on this platform")
    provider = str(fb.get("sign_in_provider") or "")
    if provider and not sso.provider_allowed(provider, cfg) and not is_bootstrap_admin(email):
        raise HTTPException(403, "這個登入方式已被管理員關閉")

    name = claims.get("name") or email
    account = _account(claims["uid"], email, name, provider)
    if account.get("status") == "suspended" and not is_bootstrap_admin(email):
        raise HTTPException(403, "account suspended")
    return User(uid=claims["uid"], email=email, name=name, role=effective_role(account),
                department=account.get("department", ""), original_view=bool(account.get("original_view", False)),
                roles=tuple(r for r in account.get("roles") or [] if isinstance(r, str)),
                groups=tuple(g for g in account.get("groups") or [] if isinstance(g, str)))


def require_builder(user: User = Depends(current_user)) -> User:
    """Build features (Studio, connectors, knowledge library). Run-only users chat with published agents."""
    if user.role not in ("builder", "admin"):
        raise HTTPException(403, "builder role required")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "admin role required")
    return user


def granted_permissions(user: User) -> list[str]:
    """Permission ids from the user's assigned roles (users.roles) and from the roles of each group the user belongs
    to (users.groups -> groups.role_ids), in the order of app/permissions.py. The account role (users.role) is not
    considered; a missing role or group document contributes nothing."""
    role_ids = set(user.roles)
    for gid in user.groups:
        snap = db.client().collection("groups").document(gid).get()
        role_ids.update(r for r in (snap.to_dict() or {}).get("role_ids") or [] if isinstance(r, str))
    granted: set[str] = set()
    for rid in role_ids:
        snap = db.client().collection("roles").document(rid).get()
        granted.update(p for p in (snap.to_dict() or {}).get("permissions") or [] if isinstance(p, str))
    return [rid for rid, _name, _desc in RESOURCES if rid in granted]


def require_permission(resource: str, *, write: bool = False):
    """Route guard for one resource id from app/permissions.py. Holding `resource` allows reads and writes;
    holding `resource-viewer` allows reads only, so write routes use `write=True`. The admin account role always passes
    (as in the other admin guards), so admins are never locked out of the permission-managed routes."""
    def guard(user: User = Depends(current_user)) -> User:
        if user.role == "admin":
            return user
        held = set(granted_permissions(user))
        if resource in held or (not write and f"{resource}-viewer" in held):
            return user
        raise HTTPException(403, "permission required")
    return guard
