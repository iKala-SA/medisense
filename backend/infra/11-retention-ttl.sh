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

# Images pasted into chats live in the upload bucket under chat-images/ (redacted copies only). They are deleted with their
# conversation; this rule also removes them when a conversation just expires. Existing lifecycle rules are kept (an update
# replaces the whole list, so the current rules are read and merged first). Idempotent.
: "${UPLOAD_BUCKET:?run: source infra/env.sh}"
DAYS=$(( ${SESSION_RETENTION_DAYS:-180} + 2 ))
CUR="$(gcloud storage buckets describe "gs://${UPLOAD_BUCKET}" --project "$PROJECT_ID" --format=json)"
CUR="$CUR" DAYS="$DAYS" python3 - > /tmp/chat-images-lifecycle.json <<'PY'
import json, os
rules = (json.loads(os.environ["CUR"]).get("lifecycle_config") or {}).get("rule", [])
rules = [r for r in rules if "chat-images/" not in (r.get("condition", {}).get("matchesPrefix") or [])]
rules.append({"action": {"type": "Delete"}, "condition": {"age": int(os.environ["DAYS"]), "matchesPrefix": ["chat-images/"]}})
print(json.dumps({"rule": rules}))
PY
gcloud storage buckets update "gs://${UPLOAD_BUCKET}" --project "$PROJECT_ID" --lifecycle-file=/tmp/chat-images-lifecycle.json
echo "chat-images/ objects in ${UPLOAD_BUCKET} expire after ${DAYS} days"
echo "backfill (optional): .venv/bin/python -m scripts.backfill_expiry   # sets expire_at on existing sessions/feedback"
