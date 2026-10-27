#!/usr/bin/env bash
# Deploy the FastAPI backend (Platform API + Agent Runtime) from source with Cloud Build
# buildpacks (no local Docker). It reaches LiteLLM over Direct VPC egress because LiteLLM
# has internal-only ingress; Google APIs stay reachable through Private Google Access.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
cd "$(dirname "$0")/../backend"

LITELLM_URL="$(gcloud run services describe "$LITELLM_SERVICE" --region "$REGION" --format='value(status.url)')"
: "${LITELLM_URL:?deploy LiteLLM first (03-deploy-litellm.sh)}"

# SCHEDULER_TOKEN: shared secret for POST /api/schedules/tick (infra/08-scheduler.sh uses the same value).
# Export it before deploying (e.g. export SCHEDULER_TOKEN="$(openssl rand -hex 24)"); empty disables the tick endpoint.
if [ -z "${SCHEDULER_TOKEN:-}" ]; then echo "warning: SCHEDULER_TOKEN is empty; schedules will not run automatically" >&2; fi

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
  --set-env-vars "^|^GOOGLE_CLOUD_PROJECT=${PROJECT_ID}|REGION=${REGION}|LITELLM_BASE_URL=${LITELLM_URL}|FIRESTORE_DATABASE=${FIRESTORE_DATABASE}|UPLOAD_BUCKET=${UPLOAD_BUCKET}|ALLOWED_DOMAINS=${ALLOWED_DOMAINS}|DLP_INSPECT_TEMPLATE=${DLP_INSPECT_TEMPLATE}|RAG_ENABLED=${RAG_ENABLED}|RAG_LOCATION=${RAG_LOCATION}|RAG_EMBEDDING_MODEL=${RAG_EMBEDDING_MODEL}|ADMIN_EMAILS=${ADMIN_EMAILS}|MONTHLY_BUDGET_USD=${MONTHLY_BUDGET_USD}|USD_TWD_RATE=${USD_TWD_RATE}|SCHEDULER_TOKEN=${SCHEDULER_TOKEN:-}" \
  --set-secrets "LITELLM_API_KEY=litellm-master-key:latest"

BACKEND_URL="$(gcloud run services describe "$BACKEND_SERVICE" --region "$REGION" --format='value(status.url)')"
echo "backend deployed: $BACKEND_URL"
echo "smoke test: curl -s $BACKEND_URL/api/health"
echo "Public at the IAM layer because Firebase Hosting rewrites require it; every /api route verifies a Firebase ID token."
