#!/usr/bin/env bash
# One-time setup for 套用 on the 資料庫連接器 page (.github/workflows/toolbox-apply.yml -> infra/13-deploy-toolbox.sh).
# The workflow reuses the deploy service account of 套用到 LiteLLM (github-litellm-deploy, key already in the GitHub secret
# LITELLM_DEPLOY_SA_KEY) and the backend's workflow-dispatch token, so run infra/10-litellm-apply-cicd.sh first.
# Adds what Toolbox needs on top of that account:
#   - roles/secretmanager.viewer: Cloud Run reads the secrets it mounts at deploy time
#   - versions on the toolbox-tools secret: created here, so the account only needs to add versions
#   - roles/iam.serviceAccountUser on the Toolbox runtime SA (deploy the service *as* it)
# run.admin / datastore.viewer / artifactregistry were granted by infra/10.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
: "${TOOLBOX_SA:?set TOOLBOX_* in infra/env.sh}"
CI_SA="github-litellm-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$CI_SA" --project "$PROJECT_ID" >/dev/null || { echo "run infra/10-litellm-apply-cicd.sh first" >&2; exit 1; }

if ! gcloud iam service-accounts describe "${TOOLBOX_SA}@${PROJECT_ID}.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$TOOLBOX_SA" --display-name="MCP Toolbox for Databases" --project "$PROJECT_ID"
fi
if ! gcloud secrets describe toolbox-tools --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create toolbox-tools --replication-policy=user-managed --locations="$REGION" --project "$PROJECT_ID"
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${CI_SA}" --role=roles/secretmanager.viewer --condition=None --quiet >/dev/null
gcloud secrets add-iam-policy-binding toolbox-tools --project "$PROJECT_ID" \
  --member="serviceAccount:${CI_SA}" --role=roles/secretmanager.secretVersionAdder --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${TOOLBOX_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${CI_SA}" --role=roles/iam.serviceAccountUser --project "$PROJECT_ID" --quiet >/dev/null
echo "Done. Next: run infra/13-deploy-toolbox.sh once by hand (or press 套用 on the page), then set TOOLBOX_URL on the backend."
