#!/usr/bin/env bash
# Open Connector gateway (https://github.com/oomol-lab/open-connector) for per-user OAuth connectors.
# Cloud Run (private: only the backend service account may invoke) + Cloud SQL Postgres + Secret Manager.
# Idempotent: re-running skips what exists. Pinned release (v1.9.4 is the last plain Apache-2.0 version).
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
OC_VERSION="${OC_VERSION:-v1.9.4}"
SITE_ORIGIN="${SITE_ORIGIN:-https://medisense-portal.web.app}"   # public site; the gateway is mounted at <site>/api/oc
OC_SA="medisense-oc-sa"; OC_SQL="medisense-oc-db"; OC_DB="open_connector"; OC_DB_USER="oc"
OC_SERVICE="medisense-open-connector"; OC_JOB="medisense-oc-migrate"
SRC="ghcr.io/oomol-lab/open-connector:${OC_VERSION}"
IMG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/open-connector:${OC_VERSION}"
SA_EMAIL="${OC_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
BACKEND_EMAIL="${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_CONN="${PROJECT_ID}:${REGION}:${OC_SQL}"
say() { printf '\n== %s\n' "$*"; }
secret_exists() { gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1; }

say "1/8 copy image to Artifact Registry (Cloud Run cannot pull from ghcr.io)"
if gcloud artifacts docker images describe "$IMG" --project "$PROJECT_ID" >/dev/null 2>&1; then echo "exists: $IMG"; else
  CB="$(mktemp)"; cat > "$CB" <<'YAML'
steps:
- name: gcr.io/cloud-builders/docker
  entrypoint: bash
  args: ['-c', 'docker pull "$_SRC" && docker tag "$_SRC" "$_DEST" && docker push "$_DEST"']
substitutions:
  _SRC: ''
  _DEST: ''
YAML
  gcloud builds submit --no-source --config "$CB" --substitutions "_SRC=${SRC},_DEST=${IMG}" --project "$PROJECT_ID" --region "$REGION"
fi

say "2/8 service account (Cloud SQL client only)"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$OC_SA" --display-name "Medisense Open Connector" --project "$PROJECT_ID"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${SA_EMAIL}" --role roles/cloudsql.client --condition=None >/dev/null

say "3/8 Cloud SQL (PostgreSQL 16, smallest shared-core, no authorized networks, backups, deletion protection)"
if ! gcloud sql instances describe "$OC_SQL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud sql instances create "$OC_SQL" --project "$PROJECT_ID" --region "$REGION" --database-version POSTGRES_16 --edition ENTERPRISE \
    --tier db-f1-micro --storage-type SSD --storage-size 10 --availability-type zonal \
    --backup --backup-start-time 18:00 --retained-backups-count 7 --maintenance-window-day SUN --maintenance-window-hour 19 --deletion-protection
fi
gcloud sql databases describe "$OC_DB" --instance "$OC_SQL" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud sql databases create "$OC_DB" --instance "$OC_SQL" --project "$PROJECT_ID"

say "4/8 secrets (random values are generated here and never printed)"
mk_secret() { secret_exists "$1" || { printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=user-managed --locations="$REGION" --project "$PROJECT_ID" >/dev/null; echo "created $1"; }; }
mk_secret oc-encryption-key "$(openssl rand -base64 32)"
mk_secret oc-admin-token "$(openssl rand -base64 32)"
if ! secret_exists oc-database-url; then
  PW="$(openssl rand -hex 24)"
  gcloud sql users describe "$OC_DB_USER" --instance "$OC_SQL" --project "$PROJECT_ID" >/dev/null 2>&1 && \
    gcloud sql users set-password "$OC_DB_USER" --instance "$OC_SQL" --password "$PW" --project "$PROJECT_ID" >/dev/null || \
    gcloud sql users create "$OC_DB_USER" --instance "$OC_SQL" --password "$PW" --project "$PROJECT_ID" >/dev/null
  # Credentials need a non-empty host for the gateway's URL check (WHATWG URL), so a placeholder host is used; the `host=` query
  # parameter (node-postgres) is what actually points at the Cloud SQL unix socket.
  mk_secret oc-database-url "postgresql://${OC_DB_USER}:${PW}@localhost/${OC_DB}?host=/cloudsql/${SQL_CONN}"
  unset PW
fi
# Repair a URL created by an earlier run of this script (empty host is rejected by the gateway).
CUR_URL="$(gcloud secrets versions access latest --secret oc-database-url --project "$PROJECT_ID")"
case "$CUR_URL" in *"@/"*) printf '%s' "${CUR_URL/@\//@localhost/}" | gcloud secrets versions add oc-database-url --data-file=- --project "$PROJECT_ID" >/dev/null; echo "repaired oc-database-url";; esac
unset CUR_URL
for s in oc-encryption-key oc-admin-token oc-database-url; do
  gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:${SA_EMAIL}" --role roles/secretmanager.secretAccessor --project "$PROJECT_ID" >/dev/null
done
gcloud secrets add-iam-policy-binding oc-admin-token --member "serviceAccount:${BACKEND_EMAIL}" --role roles/secretmanager.secretAccessor --project "$PROJECT_ID" >/dev/null

say "5/8 database migration (Postgres needs an explicit migrate before the server starts)"
JOB_FLAGS=(--image "$IMG" --region "$REGION" --project "$PROJECT_ID" --service-account "$SA_EMAIL" --set-cloudsql-instances "$SQL_CONN"
  --set-secrets "OOMOL_CONNECT_DATABASE_URL=oc-database-url:latest" --args migrate --max-retries 0 --task-timeout 300s)
if gcloud run jobs describe "$OC_JOB" --region "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then gcloud run jobs update "$OC_JOB" "${JOB_FLAGS[@]}"; else gcloud run jobs create "$OC_JOB" "${JOB_FLAGS[@]}"; fi
gcloud run jobs execute "$OC_JOB" --region "$REGION" --project "$PROJECT_ID" --wait

say "6/8 Cloud Run service (private, scales to zero)"
gcloud run deploy "$OC_SERVICE" --image "$IMG" --region "$REGION" --project "$PROJECT_ID" --service-account "$SA_EMAIL" \
  --no-allow-unauthenticated --port 3000 --cpu 1 --memory 1Gi --min-instances 0 --max-instances 2 --concurrency 40 --timeout 300 \
  --add-cloudsql-instances "$SQL_CONN" --set-env-vars "OOMOL_CONNECT_ORIGIN=${SITE_ORIGIN}/api/oc" \
  --set-secrets "OOMOL_CONNECT_ENCRYPTION_KEY=oc-encryption-key:latest,OOMOL_CONNECT_ADMIN_TOKEN=oc-admin-token:latest,OOMOL_CONNECT_DATABASE_URL=oc-database-url:latest"

say "7/8 only the backend may call it"
gcloud run services add-iam-policy-binding "$OC_SERVICE" --region "$REGION" --project "$PROJECT_ID" \
  --member "serviceAccount:${BACKEND_EMAIL}" --role roles/run.invoker >/dev/null

say "8/8 done"
OC_URL="$(gcloud run services describe "$OC_SERVICE" --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')"
echo "gateway: $OC_URL   (backend uses OPEN_CONNECTOR_URL=${OC_URL}/api/oc  OPEN_CONNECTOR_IAM_AUDIENCE=${OC_URL})"
echo "Back up secret oc-encryption-key somewhere safe: without it the stored OAuth grants cannot be decrypted."
