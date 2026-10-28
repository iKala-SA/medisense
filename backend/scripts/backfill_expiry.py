"""Give existing conversations and feedback an `expire_at` so the TTL policy (infra/11-retention-ttl.sh) can delete them.

Documents written before retention existed have no `expire_at`. expire_at = last update (or creation) + the retention
period, so an old conversation is deleted promptly once its period has passed. Dry run by default; --apply writes.

    cd backend && set -a && . ./.env && set +a
    .venv/bin/python -m scripts.backfill_expiry            # how many documents would change
    .venv/bin/python -m scripts.backfill_expiry --apply
"""
import sys
from datetime import timedelta

from app import db
from app.config import settings

TARGETS = (("sessions", "session_retention_days"), ("feedback", "feedback_retention_days"))


def main(apply: bool) -> None:
    for coll, attr in TARGETS:
        days = getattr(settings(), attr)
        if days <= 0:
            print(f"{coll}: retention disabled, skipped")
            continue
        n = 0
        for d in db.client().collection(coll).stream():
            row = d.to_dict() or {}
            if row.get("expire_at"):
                continue
            base = row.get("updated_at") or row.get("created_at") or db.now()
            n += 1
            if apply:
                d.reference.update({"expire_at": base + timedelta(days=days)})
        print(f"{coll}: {n} documents {'updated' if apply else 'would be updated'} (+{days} days)")


if __name__ == "__main__":
    main("--apply" in sys.argv)
