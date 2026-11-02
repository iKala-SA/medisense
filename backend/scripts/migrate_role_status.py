"""Rename `roles/{id}.suspended` to the boolean `status` (true = 啟用, so status = not suspended). Dry run by default; --apply writes.

Documents that already have `status` keep it and only lose the old `suspended` field. The value is kept as-is when it is
a bool and otherwise coerced, so the stored type is boolean afterwards.

    cd backend && set -a && . ./.env && set +a
    .venv/bin/python -m scripts.migrate_role_status            # how many documents would change
    .venv/bin/python -m scripts.migrate_role_status --apply
"""
import sys

from google.cloud import firestore

from app import db
from app.config import settings


def main(apply: bool) -> None:
    print(f"project={settings().google_cloud_project} database={settings().firestore_database}")
    renamed = dropped = 0
    for d in db.client().collection("roles").stream():
        row = d.to_dict() or {}
        if "suspended" not in row:
            continue
        if "status" in row:
            dropped += 1
            change = {"suspended": firestore.DELETE_FIELD}
        else:
            renamed += 1
            change = {"status": row["suspended"] is not True, "suspended": firestore.DELETE_FIELD}
        print(f"  {d.id}: suspended={row['suspended']!r} -> {'drop old field' if 'status' in row else 'status'}")
        if apply:
            d.reference.update(change)
    verb = "applied" if apply else "dry run"
    print(f"{verb}: {renamed} renamed to status, {dropped} old field dropped")


if __name__ == "__main__":
    main("--apply" in sys.argv)
