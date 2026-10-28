"""Accounts & access (design: 帳號與存取權限管理 + 編輯同仁帳號權限與狀態). Admin-only.

Decided 2026-10-26: roles admin / builder / user (run-only), statuses active / suspended. The
directory is whoever has signed in plus e-mails an admin pre-registered; there is no Workspace
Directory sync and no account creation (Google accounts belong to Workspace). Allowed domains
stay in the ALLOWED_DOMAINS env var and are only displayed. Role and status changes need a reason
and go to the audit log. Suspending also disables the Firebase user and revokes its refresh tokens,
so the person cannot sign in again; the platform check in auth.current_user is what blocks API
calls already in flight (within auth.CACHE_TTL on other instances).
"""
import csv
import io
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from firebase_admin import auth as fb_auth
from google.cloud import firestore

from .. import db
from ..auth import User, effective_role, forget, is_bootstrap_admin, require_admin, users
from ..config import settings
from ..schemas import (
    DEPARTMENTS,
    DomainCount,
    OwnedCounts,
    UserCreate,
    UserDetail,
    UserDirectory,
    UserOut,
    UserPatch,
)

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)])
log = logging.getLogger(__name__)
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _out(data: dict, cls: type[UserOut] = UserOut, **extra) -> UserOut:
    email = data.get("email", "")
    return cls(**{**data, "role": effective_role(data), "bootstrap_admin": is_bootstrap_admin(email), **extra})


def _load(email: str):
    snap = users().document(email.lower()).get()
    if not snap.exists:
        raise HTTPException(404, "user not found")
    return snap


def _owned(uid: str) -> OwnedCounts:
    if not uid:
        return OwnedCounts()
    c = db.client()
    agents = [d.to_dict() or {} for d in c.collection("agents").where(
        filter=firestore.FieldFilter("owner_uid", "==", uid)).select(["status"]).stream()]
    count = lambda col, field: sum(1 for _ in c.collection(col).where(
        filter=firestore.FieldFilter(field, "==", uid)).select([]).stream())
    return OwnedCounts(agents=len(agents), published_agents=sum(1 for a in agents if a.get("status") == "published"),
                       connectors=count("connectors", "owner_uid"), documents=count("documents", "uploaded_uid"))


def _other_active_admins(email: str) -> int:
    """Admins who would remain if `email` stopped being one. ADMIN_EMAILS always count."""
    n = sum(1 for e in settings().admin_email_list if e != email)
    for d in users().where(filter=firestore.FieldFilter("role", "==", "admin")).stream():
        r = d.to_dict() or {}
        if d.id != email and not is_bootstrap_admin(d.id) and r.get("status") != "suspended":
            n += 1
    return n


def _all() -> list[UserOut]:
    rows = [_out(d.to_dict() or {"email": d.id}) for d in users().stream()]
    return sorted(rows, key=lambda u: str(u.last_seen_at or ""), reverse=True)


@router.get("", response_model=UserDirectory)
def list_users():
    rows = _all()
    counts: dict[str, int] = {}
    for u in rows:
        dom = u.email.rsplit("@", 1)[-1]
        counts[dom] = counts.get(dom, 0) + 1
    return UserDirectory(users=rows, domains=[DomainCount(domain=d, users=counts.get(d, 0)) for d in settings().allowed_domain_list])


@router.get("/export.csv")
def export_csv(user: User = Depends(require_admin)):
    rows = _all()
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM so Excel opens Chinese headers correctly
    w = csv.writer(buf)
    w.writerow(["email", "name", "role", "status", "department", "bootstrap_admin", "first_login_at", "last_seen_at",
                "created_by", "status_reason", "status_changed_by", "status_changed_at"])
    for u in rows:
        w.writerow([u.email, u.name, u.role, u.status, u.department, u.bootstrap_admin, u.first_login_at or "",
                    u.last_seen_at or "", u.created_by, u.status_reason, u.status_changed_by, u.status_changed_at or ""])
    db.audit(user.uid, "users.export", user.email, rows=len(rows))
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="tcvgh-accounts.csv"'})


@router.get("/{email}", response_model=UserDetail)
def get_user(email: str):
    data = _load(email).to_dict() or {}
    return _out(data, UserDetail, owned=_owned(data.get("uid", "")))


@router.post("", response_model=UserDetail, status_code=201)
def preregister(body: UserCreate, user: User = Depends(require_admin)):
    email = body.email.strip().lower()
    if not EMAIL.match(email):
        raise HTTPException(422, "invalid e-mail")
    allowed = settings().allowed_domain_list
    if allowed and email.rsplit("@", 1)[-1] not in allowed:
        raise HTTPException(422, f"{email.rsplit('@', 1)[-1]} is not an allowed sign-in domain")
    if body.department and body.department not in DEPARTMENTS:
        raise HTTPException(422, f"unknown department {body.department}")
    ref = users().document(email)
    if ref.get().exists:
        raise HTTPException(409, "this e-mail already has an account")
    data = {"email": email, "uid": "", "name": "", "role": body.role, "status": "active", "department": body.department,
            "created_at": db.now(), "created_by": user.email, "first_login_at": None, "last_seen_at": None}
    ref.set(data)
    forget(email)
    db.audit(user.uid, "user.preregister", user.email, target_email=email, role=body.role)
    return _out(data, UserDetail)


def _set_firebase_disabled(uid: str, disabled: bool) -> bool:
    """Best effort: our own status check already blocks the API; this stops new sign-ins."""
    if not uid:
        return False
    try:
        fb_auth.update_user(uid, disabled=disabled)
        if disabled:
            fb_auth.revoke_refresh_tokens(uid)
        return True
    except Exception:  # missing roles/firebaseauth.admin, user deleted in Firebase, ...
        log.exception("could not %s Firebase user %s", "disable" if disabled else "enable", uid)
        return False


@router.patch("/{email}", response_model=UserDetail)
def update_user(email: str, body: UserPatch, user: User = Depends(require_admin)):
    snap = _load(email)
    email = snap.id
    data = snap.to_dict() or {}
    reason = body.reason.strip()
    role_change = body.role is not None and body.role != effective_role(data)
    status_change = body.status is not None and body.status != data.get("status", "active")
    if role_change or status_change:
        if email == user.email:
            raise HTTPException(409, "you cannot change your own role or status")
        if is_bootstrap_admin(email):
            raise HTTPException(409, "this admin is set by ADMIN_EMAILS; change it in the deployment, not here")
        if not reason:
            raise HTTPException(422, "a reason is required to change role or status")
        losing_admin = effective_role(data) == "admin" and (body.role not in (None, "admin") or body.status == "suspended")
        if losing_admin and _other_active_admins(email) == 0:
            raise HTTPException(409, "cannot remove the last active admin")
    if body.department is not None and body.department and body.department not in DEPARTMENTS:
        raise HTTPException(422, f"unknown department {body.department}")

    at = db.now()
    patch: dict = {}
    if body.department is not None and body.department != data.get("department", ""):
        patch["department"] = body.department
    if role_change:
        patch |= {"role": body.role, "role_changed_at": at, "role_changed_by": user.email}
    if status_change:
        patch |= {"status": body.status, "status_reason": reason, "status_changed_at": at, "status_changed_by": user.email}
    if not patch:
        return _out(data, UserDetail, owned=_owned(data.get("uid", "")))
    snap.reference.update(patch)
    forget(email)

    if role_change:
        db.audit(user.uid, "user.role", user.email, target_email=email, old=effective_role(data), new=body.role, reason=reason)
    if status_change:
        synced = _set_firebase_disabled(data.get("uid", ""), body.status == "suspended")
        db.audit(user.uid, "user.suspend" if body.status == "suspended" else "user.reactivate", user.email,
                 target_email=email, reason=reason, firebase_synced=synced)
    if "department" in patch:
        db.audit(user.uid, "user.update", user.email, target_email=email, old=data.get("department", ""), department=patch["department"])
    data = {**data, **patch}
    return _out(data, UserDetail, owned=_owned(data.get("uid", "")))


@router.delete("/{email}", status_code=204)
def cancel_preregistration(email: str, user: User = Depends(require_admin)):
    """Only for pre-registrations nobody has used yet; real accounts are suspended, not deleted."""
    snap = _load(email)
    if (snap.to_dict() or {}).get("uid"):
        raise HTTPException(409, "this person has signed in; suspend the account instead")
    snap.reference.delete()
    forget(snap.id)
    db.audit(user.uid, "user.preregister_cancel", user.email, target_email=snap.id)
