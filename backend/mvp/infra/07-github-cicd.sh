#!/usr/bin/env bash
# One-time setup for the Firebase Hosting GitHub Action (.github/workflows/firebase-hosting.yml).
# Grants the deploy service account its roles, mints a key, and stores it plus the Firebase web
# config as GitHub Actions secrets. Needs: gcloud (project owner) and gh (member of iKala-aix-tech).
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
REPO="iKala-aix-tech/tcvgh-agent-platform"
SA_NAME="github-firebase-deploy"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
ENV_FILE="$(dirname "$0")/../frontend/.env"
KEY="$(mktemp)"
trap 'rm -f "$KEY"' EXIT   # the key must only live in GitHub secrets

if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions: Firebase Hosting deploy" --project "$PROJECT_ID"
fi

echo "1/3 grant roles to $SA"
# firebasehosting.admin: upload + release the site.  run.viewer: validate the /api/** -> Cloud Run rewrite.
# serviceusage.serviceUsageViewer: the CLI checks that firebasehosting.googleapis.com is enabled (403 without it).
for r in roles/firebasehosting.admin roles/run.viewer roles/serviceusage.serviceUsageViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$r" --condition=None --quiet >/dev/null
  echo "   granted $r"
done

echo "2/3 create key and store it as a GitHub secret"
gcloud iam service-accounts keys create "$KEY" --iam-account="$SA" --project "$PROJECT_ID" --quiet
gh secret set FIREBASE_SERVICE_ACCOUNT_CLOUD_SA_SANDBOX_1 -R "$REPO" < "$KEY"

echo "3/3 store Firebase web config (read from frontend/.env)"
grep '^VITE_FIREBASE_API_KEY=' "$ENV_FILE" | cut -d= -f2- | gh secret set VITE_FIREBASE_API_KEY -R "$REPO"
grep '^VITE_FIREBASE_APP_ID='  "$ENV_FILE" | cut -d= -f2- | gh secret set VITE_FIREBASE_APP_ID  -R "$REPO"

echo
gh secret list -R "$REPO"
echo "Done. Push to main (or run the workflow manually) to deploy."
