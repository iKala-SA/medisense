#!/usr/bin/env bash
# Foundation: Firestore, upload bucket, Artifact Registry, service accounts, IAM, secrets.
# Idempotent: every create is guarded by a describe.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"

# --- Firestore (Native mode, dedicated named database in Taiwan) -----------------------
if ! gcloud firestore databases describe --database="$FIRESTORE_DATABASE" >/dev/null 2>&1; then
  gcloud firestore databases create --database="$FIRESTORE_DATABASE" --location="$FIRESTORE_LOCATION" --type=firestore-native
else
  echo "firestore: $FIRESTORE_DATABASE exists"
fi

# Composite index for: agents where owner_uid == X order by updated_at desc (list page)
if ! gcloud firestore indexes composite list --database="$FIRESTORE_DATABASE" --format="value(fields.fieldPath)" 2>/dev/null | grep -q "owner_uid"; then
  gcloud firestore indexes composite create --database="$FIRESTORE_DATABASE" --collection-group=agents --query-scope=COLLECTION \
    --field-config=field-path=owner_uid,order=ascending --field-config=field-path=updated_at,order=descending --async
else
  echo "firestore: agents index exists"
fi

# Indexes added 2026-10-24 (hub visibility + audit page + knowledge):
#   agents: status == published ORDER BY updated_at DESC          (hub: everyone's published agents)
#   audit:  actor == X ORDER BY at DESC                           (audit page, builder view)
#   audit:  action == X AND at >= T                               (hub stat: runs today)
#   audit:  actor == X AND action == Y ORDER BY at DESC           (audit page with action filter)
ensure_index() { # collection, then field=order pairs; "already exists" is not an error
  local col="$1"; shift
  local args=()
  for f in "$@"; do args+=(--field-config="field-path=${f%%=*},order=${f##*=}"); done
  local out
  if out="$(gcloud firestore indexes composite create --database="$FIRESTORE_DATABASE" --collection-group="$col" \
      --query-scope=COLLECTION "${args[@]}" --async 2>&1)"; then
    echo "firestore: $col index ($*) creating"
  elif grep -q "ALREADY_EXISTS" <<<"$out"; then
    echo "firestore: $col index ($*) exists"
  else
    echo "$out" >&2; return 1
  fi
}
ensure_index agents status=ascending updated_at=descending
ensure_index audit actor=ascending at=descending
ensure_index audit action=ascending at=ascending
ensure_index audit actor=ascending action=ascending at=descending
# Added 2026-10-25 (admin monitoring dashboard): usage_daily rollups filtered by department over a day range.
ensure_index usage_daily department=ascending day=ascending
# Added with the Medisense integration: my conversations (routers/sessions.py): uid == X ORDER BY updated_at DESC
# (also with updated_at < cursor). All other new queries (skills/schedules/spaces/groups/models/config) are
# single-field equality or array-contains(-any) and need no composite index.
ensure_index sessions uid=ascending updated_at=descending

# --- Upload bucket: uniform access, no public, versioning for audit --------------------
if ! gcloud storage buckets describe "gs://$UPLOAD_BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$UPLOAD_BUCKET" \
    --location="$REGION" --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "gs://$UPLOAD_BUCKET" --versioning
else
  echo "bucket: $UPLOAD_BUCKET exists"
fi
# Default CMEK applies to objects written from now on; older objects keep Google-managed encryption.
if [[ -n "${UPLOAD_KMS_KEY:-}" ]]; then
  gcloud storage buckets update "gs://$UPLOAD_BUCKET" --default-encryption-key="$UPLOAD_KMS_KEY"
fi

# --- Artifact Registry for the LiteLLM image -------------------------------------------
if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION" \
    --description="TCVGH agent platform images"
else
  echo "artifact registry: $AR_REPO exists"
fi

# --- Service accounts -------------------------------------------------------------------
for SA in "$LITELLM_SA" "$BACKEND_SA"; do
  if ! gcloud iam service-accounts describe "${SA}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SA" --display-name="$SA"
  else
    echo "sa: $SA exists"
  fi
done
LITELLM_SA_EMAIL="${LITELLM_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
BACKEND_SA_EMAIL="${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

# LiteLLM: call Vertex AI, read its secrets, screen prompts with Model Armor (sanitizeUserPrompt). Nothing else.
for ROLE in roles/aiplatform.user roles/secretmanager.secretAccessor roles/logging.logWriter roles/modelarmor.user; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${LITELLM_SA_EMAIL}" --role="$ROLE" --condition=None >/dev/null
done

# Backend: Firestore, the upload bucket only, secrets, DLP (de-identify), invoke LiteLLM, RAG Engine.
# roles/aiplatform.user: Vertex AI RAG Engine corpora (knowledge). Files are uploaded directly by the backend,
# so the RAG service agent needs no access to our bucket.
# roles/secretmanager.admin: connector credentials are created/deleted by the API (one secret per credential field).
# roles/dlp.inspectTemplatesReader: deid uses the DLP_INSPECT_TEMPLATE (dlp.user alone cannot read templates).
# roles/firebaseauth.admin: suspending an account disables its Firebase user and revokes its refresh tokens.
for ROLE in roles/datastore.user roles/secretmanager.secretAccessor roles/secretmanager.admin roles/dlp.user roles/dlp.inspectTemplatesReader roles/logging.logWriter roles/run.invoker roles/aiplatform.user roles/firebaseauth.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${BACKEND_SA_EMAIL}" --role="$ROLE" --condition=None >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$UPLOAD_BUCKET" \
  --member="serviceAccount:${BACKEND_SA_EMAIL}" --role=roles/storage.objectAdmin >/dev/null

# --- Secrets: LiteLLM master key (generated once), placeholders for other providers ------
if ! gcloud secrets describe litellm-master-key >/dev/null 2>&1; then
  printf 'sk-%s' "$(openssl rand -hex 24)" | gcloud secrets create litellm-master-key --data-file=- --replication-policy=user-managed --locations="$REGION"
else
  echo "secret: litellm-master-key exists"
fi
for S in azure-openai-api-key bedrock-aws-access-key bedrock-aws-secret-key onprem-vllm-api-key; do
  if ! gcloud secrets describe "$S" >/dev/null 2>&1; then
    printf 'REPLACE_ME' | gcloud secrets create "$S" --data-file=- --replication-policy=user-managed --locations="$REGION"
  fi
done

echo "foundation ready: firestore, gs://$UPLOAD_BUCKET, AR $AR_REPO, SAs $LITELLM_SA/$BACKEND_SA, secrets"
