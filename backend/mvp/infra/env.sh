# Source this file: `source infra/env.sh`
# Everything below is a name or a knob; nothing here creates resources.

export PROJECT_ID="cloud-sa-sandbox-1"
export REGION="asia-east1"                      # Taiwan; matches diagram
# Vertex AI Gemini is NOT served from asia-east1 (verified 2026-10-23); use the global endpoint.
export VERTEX_LOCATION="global"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null)"

# Firestore / GCS
export FIRESTORE_LOCATION="asia-east1"
# Named database: the sandbox "(default)" DB is in nam5 (US) and shared with other teams.
export FIRESTORE_DATABASE="tcvgh-agent-platform"
export UPLOAD_BUCKET="${PROJECT_ID}-tcvgh-agent-uploads"

# Artifact Registry + Cloud Run service names
export AR_REPO="tcvgh-agent-platform"
export LITELLM_SERVICE="tcvgh-litellm"
export BACKEND_SERVICE="tcvgh-platform-api"

# Service accounts (short names)
export LITELLM_SA="tcvgh-litellm-sa"
export BACKEND_SA="tcvgh-backend-sa"

# Who may sign in. Comma-separated Google Workspace domains.
# For the sandbox we allow iKala; for TCVGH replace with their Workspace domain.
export ALLOWED_DOMAINS="ikala.ai,cloud.ikala.tv"  # cloud.ikala.tv: non-admin test account (2026-10-26)

# De-identification is always on (no flag; decided 2026-10-26): findings are replaced with [INFO_TYPE], no
# recovery, no KMS. The inspect template holds the infoTypes; the backend SA needs
# roles/dlp.user + roles/dlp.inspectTemplatesReader.
export DLP_INSPECT_TEMPLATE="projects/${PROJECT_ID}/locations/global/inspectTemplates/esther-inspect-test"
# CMEK for the upload bucket (original knowledge files keep their PHI). The GCS service agent needs
# roles/cloudkms.cryptoKeyEncrypterDecrypter on this key.
export UPLOAD_KMS_KEY="projects/${PROJECT_ID}/locations/${REGION}/keyRings/esther-key/cryptoKeys/esther-tcvgh-upload-key"
# Admin dashboard (Agent 監控與成本): who is admin, hospital-wide monthly cap (USD), NT$ display rate.
export ADMIN_EMAILS="esther.shih@ikala.ai,paggie.chen@ikala.ai"
export MONTHLY_BUDGET_USD="5000"
export USD_TWD_RATE="32"

# 套用到 LiteLLM: the backend dispatches .github/workflows/litellm-apply.yml in this repo (infra/10 sets it up).
export GITHUB_REPO="iKala-SA/medisense"

# Knowledge: Vertex AI RAG Engine. asia-east1 is a Preview region for RAG Engine (checked 2026-10-24).
export RAG_ENABLED="true"
export RAG_LOCATION="asia-east1"
export RAG_EMBEDDING_MODEL="publishers/google/models/text-multilingual-embedding-002"

gcloud config set project "$PROJECT_ID" >/dev/null
echo "env: project=$PROJECT_ID number=$PROJECT_NUMBER region=$REGION"
