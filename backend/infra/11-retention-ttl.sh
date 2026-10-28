#!/usr/bin/env bash
# Turn on Firestore TTL for conversations and feedback: a document is deleted automatically once its `expire_at` passes
# (the backend sets it to now + SESSION_RETENTION_DAYS / FEEDBACK_RETENTION_DAYS on every write; defaults 180 / 365 days).
# Idempotent. Deletion is done by Firestore, normally within about a day of expiry, and is not billed as a normal delete.
# Documents written before this change have no expire_at and are NOT deleted: see "backfill" at the end.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
: "${FIRESTORE_DATABASE:?run: source infra/env.sh}"

for COLLECTION in sessions feedback; do
  gcloud firestore fields ttls update expire_at --collection-group="$COLLECTION" --enable-ttl \
    --database="$FIRESTORE_DATABASE" --project "$PROJECT_ID" --async
  echo "TTL on ${COLLECTION}.expire_at enabled (database ${FIRESTORE_DATABASE})"
done
echo "backfill (optional): .venv/bin/python -m scripts.backfill_expiry   # sets expire_at on existing sessions/feedback"
