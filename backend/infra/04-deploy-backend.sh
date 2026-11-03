#!/usr/bin/env bash
# Deploy the FastAPI backend (Platform API + Agent Runtime) from source with Cloud Build
# buildpacks (no local Docker). It reaches LiteLLM over Direct VPC egress because LiteLLM
# has internal-only ingress; Google APIs stay reachable through Private Google Access.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
cd "$(dirname "$0")/.."

LITELLM_URL="$(gcloud run services describe "$LITELLM_SERVICE" --region "$REGION" --format='value(status.url)')"
: "${LITELLM_URL:?deploy LiteLLM first (03-deploy-litellm.sh)}"

# Open Connector gateway (infra/10-open-connector.sh): per-user OAuth connectors. Empty when it has not been deployed.
OC_URL="$(gcloud run services describe medisense-open-connector --region "$REGION" --format='value(status.url)' 2>/dev/null || true)"
OC_ENV=""; OC_SECRET=""
if [ -n "$OC_URL" ]; then OC_ENV="|OPEN_CONNECTOR_URL=${OC_URL}/api/oc|OPEN_CONNECTOR_IAM_AUDIENCE=${OC_URL}"; OC_SECRET=",OPEN_CONNECTOR_TOKEN=oc-admin-token:latest"; fi

# SCHEDULER_TOKEN: shared secret for POST /api/schedules/tick (infra/08-scheduler.sh uses the same value).
# Export it before deploying (e.g. export SCHEDULER_TOKEN="$(openssl rand -hex 24)"); empty disables the tick endpoint.
if [ -z "${SCHEDULER_TOKEN:-}" ]; then echo "warning: SCHEDULER_TOKEN is empty; schedules will not run automatically" >&2; fi

# 套用到 LiteLLM: mount the workflow-dispatch token once infra/10-litellm-apply-cicd.sh has created it.
SECRETS="LITELLM_API_KEY=litellm-master-key:latest"
if gcloud secrets describe github-dispatch-token --project "$PROJECT_ID" >/dev/null 2>&1; then
  SECRETS="${SECRETS},GITHUB_DISPATCH_TOKEN=github-dispatch-token:latest"
else
  echo "warning: secret github-dispatch-token missing; 套用到 LiteLLM will return 503 (run infra/10-litellm-apply-cicd.sh)" >&2
fi
# Original-file viewing signs its short-lived links with this key (routers/originals.py); without it the feature stays off.
# Create once: openssl rand -hex 32 | gcloud secrets create original-link-signing-key --data-file=- --project "$PROJECT_ID"
if gcloud secrets describe original-link-signing-key --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets add-iam-policy-binding original-link-signing-key --member "serviceAccount:${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor --project "$PROJECT_ID" >/dev/null
  SECRETS="${SECRETS},DOWNLOAD_SIGNING_KEY=original-link-signing-key:latest"
else
  echo "warning: secret original-link-signing-key missing; opening original library files is disabled" >&2
fi
# One Google OAuth app shared by every Google service (Gmail, Drive, ...): enabling them then needs no client fields.
if gcloud secrets describe google-oauth-client-secret --project "$PROJECT_ID" >/dev/null 2>&1; then
  for s in google-oauth-client-id google-oauth-client-secret; do
    gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor --project "$PROJECT_ID" >/dev/null
  done
  OC_SECRET="${OC_SECRET},GOOGLE_OAUTH_CLIENT_ID=google-oauth-client-id:latest,GOOGLE_OAUTH_CLIENT_SECRET=google-oauth-client-secret:latest"
fi

# Private Google Access on the default subnet so VPC-egress traffic can still hit *.googleapis.com
gcloud compute networks subnets update default --region "$REGION" --enable-private-ip-google-access >/dev/null

# --set-env-vars "^|^...": | is the separator, so comma-separated values (ALLOWED_DOMAINS, ADMIN_EMAILS) survive.
gcloud run deploy "$BACKEND_SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account "${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --network default --subnet default --vpc-egress all-traffic \
  --cpu 1 --memory 2Gi --min-instances 0 --max-instances 5 --concurrency 40 --timeout 300 \
  --set-env-vars "^|^GOOGLE_CLOUD_PROJECT=${PROJECT_ID}|REGION=${REGION}|LITELLM_BASE_URL=${LITELLM_URL}|FIRESTORE_DATABASE=${FIRESTORE_DATABASE}|UPLOAD_BUCKET=${UPLOAD_BUCKET}|ALLOWED_DOMAINS=${ALLOWED_DOMAINS}|DLP_INSPECT_TEMPLATE=${DLP_INSPECT_TEMPLATE}|RAG_ENABLED=${RAG_ENABLED}|RAG_LOCATION=${RAG_LOCATION}|RAG_EMBEDDING_MODEL=${RAG_EMBEDDING_MODEL}|ADMIN_EMAILS=${ADMIN_EMAILS}|MONTHLY_BUDGET_USD=${MONTHLY_BUDGET_USD}|USD_TWD_RATE=${USD_TWD_RATE}|SCHEDULER_TOKEN=${SCHEDULER_TOKEN:-}|GITHUB_REPO=${GITHUB_REPO:-}${OC_ENV}" \
  --set-secrets "${SECRETS}${OC_SECRET}"

BACKEND_URL="$(gcloud run services describe "$BACKEND_SERVICE" --region "$REGION" --format='value(status.url)')"
echo "backend deployed: $BACKEND_URL"
echo "smoke test: curl -s $BACKEND_URL/api/health"
echo "Public at the IAM layer because Firebase Hosting rewrites require it; every /api route verifies a Firebase ID token."
