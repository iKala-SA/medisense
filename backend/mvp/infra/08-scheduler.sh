#!/usr/bin/env bash
# ONE Cloud Scheduler job drives every agent schedule: each minute it POSTs /api/schedules/tick on the backend,
# which runs whatever is due (Asia/Taipei). Idempotent: creates the job, or updates it if it exists.
# Needs: infra/01 (cloudscheduler API enabled), the backend deployed with the SAME SCHEDULER_TOKEN
# (export it, then run 04-deploy-backend.sh). NOT run automatically; review first.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
: "${SCHEDULER_TOKEN:?export SCHEDULER_TOKEN (same value the backend was deployed with)}"

JOB="${SCHEDULER_JOB:-tcvgh-schedule-tick}"
BACKEND_URL="$(gcloud run services describe "$BACKEND_SERVICE" --region "$REGION" --format='value(status.url)')"
: "${BACKEND_URL:?deploy the backend first (04-deploy-backend.sh)}"

ARGS=(--location "$REGION" --schedule "* * * * *" --time-zone "Asia/Taipei"
      --uri "${BACKEND_URL}/api/schedules/tick" --http-method POST
      --update-headers "X-Scheduler-Token=${SCHEDULER_TOKEN},Content-Type=application/json"
      --attempt-deadline 300s --max-retry-attempts 0)

if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" "${ARGS[@]}"
else
  # create has no --update-headers flag; --headers is the create-time spelling.
  CREATE_ARGS=("${ARGS[@]/--update-headers/--headers}")
  gcloud scheduler jobs create http "$JOB" "${CREATE_ARGS[@]}"
fi
echo "scheduler job $JOB -> ${BACKEND_URL}/api/schedules/tick (every minute, Asia/Taipei)"
