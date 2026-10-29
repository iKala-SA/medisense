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
export LITELLM_INGRESS="all"                      # sandbox: public run.app URL (IAM required) for the Agent Runtime POC; TCVGH: internal
export BEDROCK_ROLE_ARN="arn:aws:iam::628893726885:role/tcvgh-litellm-bedrock"  # keyless Bedrock (nova-2-lite)
export BEDROCK_WEB_IDENTITY_TOKEN="oidc/google/tcvgh-litellm-bedrock"
export BEDROCK_REGION="ap-northeast-1"            # the only region the tcvgh-litellm-bedrock role may call (jp. profile)
# On-prem stand-in: Ollama (Gemma 4 12B, tool-capable) on VM tcvgh-onprem-gemma (asia-east1-a, Spot L4, internal IP only, infra/12-ollama-vm.sh).
# LiteLLM reaches it via Direct VPC egress; the firewall rule allow-ollama-internal admits only the default subnet.
export OLLAMA_API_BASE="http://10.140.0.31:11434"
export BACKEND_SA="tcvgh-backend-sa"
# Model Armor template LiteLLM screens prompts with (before smart-router/any model; on/off = 路由 page). Sandbox: us-central1, so
# prompts leave Taiwan for the check; TCVGH should use a template in asia-east1.
export MODEL_ARMOR_PROJECT="$PROJECT_ID"
export MODEL_ARMOR_LOCATION="us-central1"
export MODEL_ARMOR_TEMPLATE_ID="esther-modelArmor"

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
