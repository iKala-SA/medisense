#!/usr/bin/env bash
# Attach Firebase to the existing GCP project, create the web app, and print the config
# the frontend needs. Uses the Firebase CLI through npx (no global install).
# Enabling the Google sign-in provider has no CLI; do it once in the Firebase console.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
FB="npx --yes firebase-tools@latest"

$FB login --no-localhost 2>/dev/null || true   # no-op if already logged in

if ! $FB projects:list 2>/dev/null | grep -q "$PROJECT_ID"; then
  $FB projects:addfirebase "$PROJECT_ID"
else
  echo "firebase: project already attached"
fi

if ! $FB apps:list WEB --project "$PROJECT_ID" 2>/dev/null | grep -q "tcvgh-agent-builder"; then
  $FB apps:create WEB "tcvgh-agent-builder" --project "$PROJECT_ID"
fi

echo
echo "=== paste into frontend/.env (VITE_FIREBASE_*) ==="
$FB apps:sdkconfig WEB --project "$PROJECT_ID"
echo
echo "Console step: Firebase console > Authentication > Sign-in method > Google > Enable."
echo "Then: cd frontend && npm install && npm run build && $FB deploy --only hosting --project $PROJECT_ID"
