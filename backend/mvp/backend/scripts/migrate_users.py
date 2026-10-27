"""One-off: create users/{email} as `builder` for everyone who already owns something, decided 2026-10-26.

New sign-ins default to the run-only `user` role. Without this, people who built agents,
connectors or knowledge documents before accounts existed would lose access to them on their
next request. Run it BEFORE deploying the backend that enforces roles.

Owners come from agents (owner_uid/owner_email), connectors (owner_uid/owner_email) and documents
(uploaded_uid/uploaded_by). Existing records are only raised from `user` to `builder` when no
admin has set the role yet; admins and suspended accounts are left alone. ADMIN_EMAILS get `admin`.

Dry run by default; pass --apply to write. Uses the backend env, e.g. from backend/.env:

    cd mvp/backend && set -a && . ./.env && set +a
    .venv/bin/python -m scripts.migrate_users           # list who would be created / promoted
    .venv/bin/python -m scripts.migrate_users --apply
"""
import sys

from app import db
from app.auth import is_bootstrap_admin, users

SOURCES = (("agents", "owner_uid", "owner_email"), ("connectors", "owner_uid", "owner_email"),
           ("documents", "uploaded_uid", "uploaded_by"))


def owners() -> dict[str, dict]:
    """email -> {uid, what: {collection: count}}"""
    out: dict[str, dict] = {}
    for col, uid_field, email_field in SOURCES:
        for d in db.client().collection(col).select([uid_field, email_field]).stream():
            r = d.to_dict() or {}
            email = str(r.get(email_field) or "").lower()
            if not email:
                print(f"  skip {col}/{d.id}: no owner e-mail (uid {r.get(uid_field)})")
                continue
            o = out.setdefault(email, {"uid": r.get(uid_field) or "", "what": {}})
            o["uid"] = o["uid"] or r.get(uid_field) or ""
            o["what"][col] = o["what"].get(col, 0) + 1
    return out


def main(apply: bool) -> int:
    created = promoted = kept = 0
    for email, o in sorted(owners().items()):
        role = "admin" if is_bootstrap_admin(email) else "builder"
        what = ", ".join(f"{n} {c}" for c, n in o["what"].items())
        ref = users().document(email)
        snap = ref.get()
        if not snap.exists:
            print(f"create  {email:40} {role:8} ({what})")
            created += 1
            if apply:
                at = db.now()
                ref.set({"email": email, "uid": o["uid"], "name": "", "role": role, "status": "active", "department": "",
                         "created_at": at, "created_by": "migrate_users", "first_login_at": None, "last_seen_at": None})
                db.audit("migrate_users", "user.role", "", target_email=email, old="", new=role, reason="既有建置者帳號移轉")
            continue
        r = snap.to_dict() or {}
        if r.get("role") == "user" and not r.get("role_changed_by"):
            print(f"promote {email:40} user -> {role} ({what})")
            promoted += 1
            if apply:
                ref.update({"role": role, "role_changed_at": db.now(), "role_changed_by": "migrate_users"})
                db.audit("migrate_users", "user.role", "", target_email=email, old="user", new=role, reason="既有建置者帳號移轉")
        else:
            print(f"keep    {email:40} {r.get('role')}/{r.get('status')} ({what})")
            kept += 1
    print(f"\n{'applied' if apply else 'dry run'}: {created} create, {promoted} promote, {kept} unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main("--apply" in sys.argv))
