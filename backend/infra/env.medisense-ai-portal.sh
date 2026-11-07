# Source this instead of env.sh for the medisense-ai-portal-project deployment:
#   source infra/env.medisense-ai-portal.sh
# Loads env.sh (sandbox defaults), then overrides what differs (values from `terraform output env_sh`).
# The project is pinned with CLOUDSDK_CORE_PROJECT for this shell only, so the global gcloud config stays as it is.
_here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
source "$_here/env.sh" >/dev/null

export PROJECT_ID="medisense-ai-portal-project"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null)"
export UPLOAD_BUCKET="${PROJECT_ID}-tcvgh-agent-uploads"
export MODEL_ARMOR_PROJECT="$PROJECT_ID"
export MODEL_ARMOR_LOCATION="us-central1"
export MODEL_ARMOR_TEMPLATE_ID="medisense-prompt-guard"
export DLP_INSPECT_TEMPLATE="projects/${PROJECT_ID}/locations/global/inspectTemplates/medisense-phi-inspect"
export UPLOAD_KMS_KEY="projects/${PROJECT_ID}/locations/${REGION}/keyRings/medisense/cryptoKeys/upload-key"
export OLLAMA_API_BASE="http://10.140.0.31:11434"
# Must match the Cloud Scheduler job Terraform created.
export SCHEDULER_TOKEN="$(terraform -chdir="$_here/terraform" output -raw scheduler_token 2>/dev/null)"
unset _here

echo "env: project=$PROJECT_ID number=$PROJECT_NUMBER region=$REGION scheduler_token=${SCHEDULER_TOKEN:+set}"
