"""One-off: move secret-kind values out of plain connector config into Secret Manager.

Needed once after the webhook connector's `url` became a secret field. Connectors saved before that
keep the URL in Firestore `config.url`. The API already hides it and the next save migrates it, but
this clears the plaintext from Firestore without waiting for someone to edit each connector.

Dry run by default; pass --apply to write. Uses Application Default Credentials and the same env
as the backend (GOOGLE_CLOUD_PROJECT, FIRESTORE_DATABASE, REGION), e.g. from backend/.env:

    cd mvp/backend && set -a && . ./.env && set +a
    .venv/bin/python -m scripts.migrate_connector_secrets           # list what would move
    .venv/bin/python -m scripts.migrate_connector_secrets --apply   # move it
"""
import sys

from google.cloud import firestore

from app import db
from app.engine import connectors as eng
from app.engine import secrets as sm


def main(apply: bool) -> int:
    moved = 0
    for snap in db.client().collection("connectors").stream():
        d = snap.to_dict() or {}
        type_, config, stored = d.get("type", ""), d.get("config") or {}, dict(d.get("secrets") or {})
        if type_ not in eng.TYPES:
            continue
        legacy = [k for k in eng.secret_fields(type_) if isinstance(config.get(k), str) and config[k]]
        if not legacy:
            continue
        print(f"{snap.id} ({type_}, {d.get('label', '')}): {', '.join(legacy)}"
              f"{' [secret already stored, plaintext copy dropped]' if all(k in stored for k in legacy) else ''}")
        moved += 1
        if not apply:
            continue
        for k in legacy:
            if k not in stored:  # an existing secret is newer than the plaintext copy
                stored[k] = sm.put(snap.id, k, config[k])
        snap.reference.update({"secrets": stored, **{f"config.{k}": firestore.DELETE_FIELD for k in legacy}})
        db.audit("migration-script", "connector.update", connector_id=snap.id, credentials_changed=False,
                 migrated_to_secret_manager=legacy)
    print(f"{'migrated' if apply else 'would migrate (dry run, pass --apply)'}: {moved} connector(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main("--apply" in sys.argv[1:]))
