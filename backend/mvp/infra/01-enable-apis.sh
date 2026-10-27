#!/usr/bin/env bash
# Enable every API the MVP touches. Safe to re-run.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  dlp.googleapis.com \
  cloudkms.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  identitytoolkit.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  compute.googleapis.com \
  vpcaccess.googleapis.com \
  cloudscheduler.googleapis.com \
  --project "$PROJECT_ID"

echo "APIs enabled on $PROJECT_ID"
