#!/usr/bin/env bash
# Build the LiteLLM image (base image + our config.yaml) in Cloud Build, push to Artifact
# Registry, deploy to Cloud Run with INTERNAL ingress so only in-VPC callers (the backend,
# via Direct VPC egress) can reach it. Vertex AI auth = the service account (ADC), no keys.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
cd "$(dirname "$0")/../litellm"

# Set IMAGE=<existing tag> to redeploy without rebuilding.
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/litellm:$(date +%Y%m%d-%H%M%S)}"
if [ -z "${IMAGE_PREBUILT:-}" ]; then gcloud builds submit --tag "$IMAGE" .; fi

# EXTRA_SECRETS="ENV=secret:latest,..." mounts the provider secrets named in a rendered registry config (infra/09).
gcloud run deploy "$LITELLM_SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --service-account "${LITELLM_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --ingress internal \
  --no-allow-unauthenticated \
  --port 4000 \
  --cpu 1 --memory 1Gi --min-instances 0 --max-instances 3 --concurrency 40 \
  --set-env-vars "VERTEX_PROJECT=${PROJECT_ID},VERTEX_LOCATION=${VERTEX_LOCATION:-global},LITELLM_LOG=INFO" \
  --set-secrets "LITELLM_MASTER_KEY=litellm-master-key:latest${EXTRA_SECRETS:+,$EXTRA_SECRETS}" \
  --args="--config,/app/config.yaml,--port,4000"

# Let the backend SA invoke LiteLLM (IAM layer) in addition to the LiteLLM key (app layer).
gcloud run services add-iam-policy-binding "$LITELLM_SERVICE" --region "$REGION" \
  --member="serviceAccount:${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com" --role=roles/run.invoker >/dev/null

LITELLM_URL="$(gcloud run services describe "$LITELLM_SERVICE" --region "$REGION" --format='value(status.url)')"
echo "LiteLLM deployed (internal ingress): $LITELLM_URL"
echo "Note: min-instances is 0 in the sandbox to save cost; set 1 for TCVGH to avoid cold starts."
