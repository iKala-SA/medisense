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


def _account(uid: str, email: str, name: str) -> dict:
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
                "first_login_at": at, "last_seen_at": at}
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
            patch["uid"] = uid
            if not data.get("first_login_at"):
                patch["first_login_at"] = at
                db.audit(uid, "user.first_login", email, target_email=email, role=effective_role(data), preregistered=True)
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

    allowed = settings().allowed_domain_list
    domain = email.rsplit("@", 1)[-1]
    hd = (claims.get("firebase", {}).get("sign_in_attributes", {}) or {}).get("hd") or claims.get("hd")
    if allowed and domain not in allowed and (hd or "").lower() not in allowed:
        raise HTTPException(403, f"domain {domain} is not allowed on this platform")

    name = claims.get("name") or email
    account = _account(claims["uid"], email, name)
    if account.get("status") == "suspended" and not is_bootstrap_admin(email):
        raise HTTPException(403, "account suspended")
    return User(uid=claims["uid"], email=email, name=name, role=effective_role(account),
                department=account.get("department", ""))


def require_builder(user: User = Depends(current_user)) -> User:
    """Build features (Studio, connectors, knowledge library). Run-only users chat with published agents."""
    if user.role not in ("builder", "admin"):
        raise HTTPException(403, "builder role required")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "admin role required")
    return user
