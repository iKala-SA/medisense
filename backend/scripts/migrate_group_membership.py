"""Move group membership from `groups/{id}.member_emails` to `users/{email}.groups` (a list of group ids), then drop
`member_emails` from the group document. Dry run by default; --apply writes.

Each e-mail is linked only when a `users/{email}` account exists; e-mails without an account are reported and left out
(the same rule the membership endpoints apply). Re-running is safe: ArrayUnion does not duplicate ids.

    cd backend && set -a && . ./.env && set +a
    .venv/bin/python -m scripts.migrate_group_membership            # counts and skipped e-mails only
    .venv/bin/python -m scripts.migrate_group_membership --apply
"""
import sys

from google.cloud import firestore

from app import db
from app.config import settings


def main(apply: bool) -> None:
    print(f"project={settings().google_cloud_project} database={settings().firestore_database}")
    users = db.client().collection("users")
    linked = skipped = groups_done = 0
    for g in db.client().collection("groups").stream():
        row = g.to_dict() or {}
        if "member_emails" not in row:
            continue
        groups_done += 1
        emails = sorted({str(e).strip().lower() for e in row.get("member_emails") or [] if str(e).strip()})
        print(f"  group {g.id} ({row.get('name', '')}): {len(emails)} member e-mail(s)")
        for email in emails:
            ref = users.document(email)
            if not ref.get().exists:
                skipped += 1
                print(f"    skip {email}: no account in users/")
                continue
            linked += 1
            if apply:
                ref.update({"groups": firestore.ArrayUnion([g.id])})
        if apply:
            g.reference.update({"member_emails": firestore.DELETE_FIELD})
    verb = "applied" if apply else "dry run"
    print(f"{verb}: {groups_done} group(s) processed, {linked} membership(s) linked, {skipped} e-mail(s) skipped")


if __name__ == "__main__":
    main("--apply" in sys.argv)
