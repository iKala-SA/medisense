#!/usr/bin/env bash
# Deploy MCP Toolbox for Databases (docs/DB-CONNECTORS-DESIGN.md) to Cloud Run from the tools.yaml the platform rendered
# from the admin 資料庫連接器 page (Firestore config/toolbox_render, re-rendered on every save). Idempotent: the first run
# also creates the service account and the `toolbox-tools` secret. Set YES=1 to skip the confirmation prompt.
# 套用 in the admin UI runs this from .github/workflows/toolbox-apply.yml with YES=1 and RENDER_DOC=toolbox_deploy
# (the snapshot taken when the button was pressed).
#
# What it does:
#   1. reads the rendered YAML + the list of database-password secrets (ENV=secret) from Firestore
#   2. toolbox-tools secret <- tools.yaml (new version), mounted at /app/tools.yaml
#   3. each ${DBPW_n} in the YAML is mounted as an env var from the Secret Manager secret that holds that login's password
#   4. Cloud Run service: INTERNAL ingress, IAM required, Direct VPC egress (private DB / Cloud SQL private IP); only the
#      backend SA may invoke it. Toolbox's execute_sql tools are unguarded, so nothing else may ever reach this service.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
: "${TOOLBOX_SERVICE:?set TOOLBOX_* in infra/env.sh}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SA="${TOOLBOX_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
YAML_FILE="$(mktemp)"
trap 'rm -f "$YAML_FILE"' EXIT

if [ -n "${TOOLS_FILE:-}" ]; then
  # Manual / first test: deploy a hand-written tools.yaml instead of the rendered one.
  # EXTRA_SECRETS="DBPW_1=my-db-password-secret:latest" mounts the secret(s) your ${DBPW_1} refers to.
  cp "$TOOLS_FILE" "$YAML_FILE"
  EXTRA="${EXTRA_SECRETS:-}"
  RAW='{"fields":{"version":{"integerValue":"0"}}}'
else
DOC_URL="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}/documents/config/${RENDER_DOC:-toolbox_render}"
TOKEN="$(gcloud auth print-access-token)"
RAW="$(curl -sf -H "Authorization: Bearer ${TOKEN}" "$DOC_URL")" || { echo "no rendered tools.yaml: save a database connector with at least one rule in the admin page first" >&2; exit 1; }

# yaml text -> $YAML_FILE ; "DBPW_1=secret:latest,..." -> stdout
EXTRA="$(RAW="$RAW" OUT="$YAML_FILE" python3 - <<'PY'
import json, os
f = json.loads(os.environ["RAW"])["fields"]
y = f["yaml"]["stringValue"]
if not y.strip():
    raise SystemExit("the rendered tools.yaml is empty: no rule grants any query or view")
open(os.environ["OUT"], "w").write(y)
pairs = []
for s in f.get("secrets", {}).get("arrayValue", {}).get("values", []):
    m = s["mapValue"]["fields"]
    pairs.append(f'{m["env"]["stringValue"]}={m["secret"]["stringValue"]}:latest')
print(",".join(pairs))
PY
)"
fi
echo "--- version $(echo "$RAW" | python3 -c 'import json,sys; print(json.load(sys.stdin)["fields"]["version"]["integerValue"])') ---"
cat "$YAML_FILE"
if [ "${YES:-}" != "1" ]; then
  read -r -p "Deploy this tools.yaml to ${TOOLBOX_SERVICE} now? [y/N] " ans
  [ "$ans" = "y" ] || { echo "aborted"; exit 1; }
fi

echo "1/4 service account ${SA}"
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$TOOLBOX_SA" --display-name="MCP Toolbox for Databases" --project "$PROJECT_ID"
fi
# secretAccessor: the tools.yaml secret and every login password (the backend creates one secret per password).
# cloudsql.client: the cloud-sql-* sources connect through the Cloud SQL connector.
for r in roles/secretmanager.secretAccessor roles/cloudsql.client roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$r" --condition=None --quiet >/dev/null
done

echo "2/4 secret toolbox-tools"
if ! gcloud secrets describe toolbox-tools --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create toolbox-tools --replication-policy=user-managed --locations="$REGION" --project "$PROJECT_ID"
fi
gcloud secrets versions add toolbox-tools --data-file="$YAML_FILE" --project "$PROJECT_ID" >/dev/null

echo "3/4 deploy ${TOOLBOX_SERVICE}"
gcloud run deploy "$TOOLBOX_SERVICE" \
  --image "$TOOLBOX_IMAGE" \
  --region "$REGION" \
  --service-account "$SA" \
  --ingress "${TOOLBOX_INGRESS:-internal}" \
  --no-allow-unauthenticated \
  --port 8080 \
  --cpu 1 --memory 512Mi --min-instances 1 --max-instances 3 --concurrency 40 \
  --network default --subnet default --vpc-egress private-ranges-only \
  --set-secrets "/app/tools.yaml=toolbox-tools:latest${EXTRA:+,$EXTRA}" \
  --args="--config=/app/tools.yaml,--address=0.0.0.0,--port=8080"

echo "4/4 invoker + host allow-list"
gcloud run services add-iam-policy-binding "$TOOLBOX_SERVICE" --region "$REGION" \
  --member="serviceAccount:${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com" --role=roles/run.invoker >/dev/null
URL="$(gcloud run services describe "$TOOLBOX_SERVICE" --region "$REGION" --format='value(status.url)')"
HOST="${URL#https://}"
# By default Toolbox accepts any Host / Origin; pin them to this service (docs: Deploy to Cloud Run, hardening).
gcloud run services update "$TOOLBOX_SERVICE" --region "$REGION" \
  --args="--config=/app/tools.yaml,--address=0.0.0.0,--port=8080,--allowed-hosts=${HOST},--allowed-origins=${URL}" >/dev/null
echo "Toolbox: $URL"
echo "Backend env to set (infra/04-deploy-backend.sh): TOOLBOX_URL=$URL"
