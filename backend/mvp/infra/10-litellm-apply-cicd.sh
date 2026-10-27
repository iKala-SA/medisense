#!/usr/bin/env bash
# One-time setup for 套用到 LiteLLM (admin Model registry -> .github/workflows/litellm-apply.yml -> infra/09).
#  1. Service account github-litellm-deploy: what the workflow runs as (build + redeploy LiteLLM, read Firestore).
#  2. Its key -> GitHub secret LITELLM_DEPLOY_SA_KEY.
#  3. GitHub token the backend uses to dispatch the workflow -> Secret Manager github-dispatch-token,
#     readable by the backend SA. Create it first: GitHub -> Settings -> Developer settings -> Fine-grained tokens,
#     repository access = only GITHUB_REPO, permission "Actions: Read and write". Pass it as GITHUB_DISPATCH_TOKEN
#     or paste it at the prompt.
# Then redeploy the backend (04-deploy-backend.sh) so it picks up GITHUB_REPO and the token.
# Needs: gcloud (project owner) and gh (admin on GITHUB_REPO).
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
: "${GITHUB_REPO:?set GITHUB_REPO in infra/env.sh}"
SA_NAME="github-litellm-deploy"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
TOKEN_SECRET="github-dispatch-token"
KEY="$(mktemp)"
trap 'rm -f "$KEY"' EXIT   # the key must only live in GitHub secrets

if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions: LiteLLM config apply" --project "$PROJECT_ID"
fi

echo "1/3 grant roles to $SA"
# cloudbuild.builds.editor + logging.viewer: `gcloud builds submit` and stream its log (03-deploy-litellm.sh).
# run.admin: deploy tcvgh-litellm and set its invoker binding.  datastore.viewer: read config/litellm_deploy (09).
# serviceusage.serviceUsageConsumer: call the APIs as this project.
for r in roles/cloudbuild.builds.editor roles/logging.viewer roles/run.admin roles/datastore.viewer \
         roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$r" --condition=None --quiet >/dev/null
  echo "   granted $r"
done
# Upload the build source to the Cloud Build staging bucket (only that bucket, not project-wide storage).
gcloud storage buckets add-iam-policy-binding "gs://${PROJECT_ID}_cloudbuild" \
  --member="serviceAccount:${SA}" --role=roles/storage.admin --quiet >/dev/null
echo "   granted roles/storage.admin on gs://${PROJECT_ID}_cloudbuild"
# Deploy LiteLLM *as* its runtime SA (actAs on that one SA only).
gcloud iam service-accounts add-iam-policy-binding "${LITELLM_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${SA}" --role=roles/iam.serviceAccountUser --project "$PROJECT_ID" --quiet >/dev/null
echo "   granted roles/iam.serviceAccountUser on ${LITELLM_SA}"

echo "2/3 create key and store it as GitHub secret LITELLM_DEPLOY_SA_KEY"
gcloud iam service-accounts keys create "$KEY" --iam-account="$SA" --project "$PROJECT_ID" --quiet
gh secret set LITELLM_DEPLOY_SA_KEY -R "$GITHUB_REPO" < "$KEY"

echo "3/3 store the workflow-dispatch token in Secret Manager ($TOKEN_SECRET)"
if [ -z "${GITHUB_DISPATCH_TOKEN:-}" ]; then read -r -s -p "Fine-grained GitHub token (Actions: write on $GITHUB_REPO): " GITHUB_DISPATCH_TOKEN; echo; fi
if ! gcloud secrets describe "$TOKEN_SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create "$TOKEN_SECRET" --replication-policy=automatic --project "$PROJECT_ID"
fi
printf '%s' "$GITHUB_DISPATCH_TOKEN" | gcloud secrets versions add "$TOKEN_SECRET" --data-file=- --project "$PROJECT_ID" >/dev/null
gcloud secrets add-iam-policy-binding "$TOKEN_SECRET" --project "$PROJECT_ID" \
  --member="serviceAccount:${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor >/dev/null

echo
gh secret list -R "$GITHUB_REPO"
echo "Done. Redeploy the backend (bash infra/04-deploy-backend.sh) to enable 套用到 LiteLLM."
