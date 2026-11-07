# Defaults mirror medisense-ai-portal-project (infra/env.sh, live state on 2026-11-06) unless a comment says otherwise.

variable "project_id" {
  type    = string
  default = "medisense-ai-portal-project"
}

variable "region" {
  type    = string
  default = "asia-east1"
}

variable "zone" {
  type    = string
  default = "asia-east1-a"
}

# --- Network ---------------------------------------------------------------------------------------------------------
# The sandbox used the auto-mode "default" VPC. Here it is a custom-mode VPC with one subnet, still named "default"
# because infra/03, 04, 12 and 15 pass `--network default --subnet default`.
variable "network_name" {
  type    = string
  default = "default"
}

variable "subnet_name" {
  type    = string
  default = "default"
}

variable "subnet_cidr" {
  type    = string
  default = "10.140.0.0/20" # same range as the sandbox default subnet, so OLLAMA_API_BASE can keep 10.140.0.31
}

# --- Data ------------------------------------------------------------------------------------------------------------
variable "firestore_database" {
  type    = string
  default = "tcvgh-agent-platform"
}

variable "upload_bucket_name" {
  type        = string
  default     = null
  description = "Defaults to <project_id>-tcvgh-agent-uploads."
}

variable "kms_keyring" {
  type    = string
  default = "medisense" # sandbox: esther-key
}

variable "kms_upload_key" {
  type    = string
  default = "upload-key" # sandbox: esther-tcvgh-upload-key
}

variable "chat_image_retention_days" {
  type    = number
  default = 182 # SESSION_RETENTION_DAYS (180) + 2, as in infra/11-retention-ttl.sh
}

# --- App settings (backend env) ---------------------------------------------------------------------------------------
variable "allowed_domains" {
  type    = string
  default = "ikala.ai,cloud.ikala.tv"
}

variable "admin_emails" {
  type    = string
  default = "esther.shih@ikala.ai,paggie.chen@ikala.ai"
}

variable "monthly_budget_usd" {
  type    = string
  default = "5000"
}

variable "usd_twd_rate" {
  type    = string
  default = "32"
}

variable "github_repo" {
  type    = string
  default = "iKala-SA/medisense"
}

variable "vertex_location" {
  type    = string
  default = "global"
}

variable "rag_enabled" {
  type    = string
  default = "true"
}

variable "rag_location" {
  type    = string
  default = "asia-east1"
}

variable "rag_embedding_model" {
  type    = string
  default = "publishers/google/models/text-multilingual-embedding-002"
}

# --- Guardrails ------------------------------------------------------------------------------------------------------
variable "dlp_template_id" {
  type    = string
  default = "medisense-phi-inspect" # sandbox: esther-inspect-test
}

variable "dlp_info_types" {
  type = list(string)
  default = [
    "TAIWAN_ID_NUMBER", "STREET_ADDRESS", "AGE", "PHONE_NUMBER", "MEDICAL_RECORD_NUMBER",
    "PERSON_NAME", "GENDER", "DATE_OF_BIRTH", "CREDIT_CARD_NUMBER",
  ]
}

variable "model_armor_location" {
  type        = string
  default     = "us-central1"
  description = "Sandbox value. Prompts leave Taiwan for the check; switch to asia-east1 if Model Armor is offered there."
}

variable "model_armor_template_id" {
  type    = string
  default = "medisense-prompt-guard" # sandbox: esther-modelArmor
}

# --- LiteLLM providers -----------------------------------------------------------------------------------------------
variable "bedrock_role_arn" {
  type        = string
  default     = "arn:aws:iam::628893726885:role/tcvgh-litellm-bedrock"
  description = "Empty string deploys LiteLLM without Bedrock. The AWS role trust policy must allow the NEW LiteLLM SA (output litellm_sa_unique_id)."
}

variable "bedrock_web_identity_token" {
  type    = string
  default = "oidc/google/tcvgh-litellm-bedrock"
}

variable "bedrock_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "litellm_ingress" {
  type        = string
  default     = "INGRESS_TRAFFIC_ALL" # sandbox: all (IAM still required); TCVGH: INGRESS_TRAFFIC_INTERNAL_ONLY
  description = "INGRESS_TRAFFIC_ALL | INGRESS_TRAFFIC_INTERNAL_ONLY"
}

variable "extra_litellm_invokers" {
  type        = list(string)
  default     = []
  description = "Extra members with run.invoker on LiteLLM (sandbox also had poc-litellm-agent-sa for the Agent Runtime POC)."
}

# --- Ollama VM (on-prem stand-in for the `sovereign` model group) -----------------------------------------------------
variable "enable_ollama_vm" {
  type        = bool
  default     = false
  description = "Needs NVIDIA L4 quota in the zone (new projects usually start at 0). The sandbox VM is normally stopped."
}

variable "ollama_ip" {
  type    = string
  default = "10.140.0.31"
}

variable "ollama_models" {
  type    = string
  default = "gemma4:12b"
}

variable "ollama_provisioning" {
  type    = string
  default = "SPOT" # SPOT | STANDARD
}

# --- Database Toolbox (DB connectors) ---------------------------------------------------------------------------------
variable "enable_toolbox" {
  type        = bool
  default     = true
  description = "Cloud SQL medisense-connector-toolbox (Postgres 18, private IP + PSC), its SA and secrets."
}

variable "deploy_toolbox_service" {
  type        = bool
  default     = false
  description = "Cloud Run tcvgh-toolbox. Turn on once secret_values[\"toolbox-tools\"] holds a tools.yaml that points at the NEW database."
}

# --- Firebase --------------------------------------------------------------------------------------------------------
variable "hosting_site_id" {
  type        = string
  default     = "medisense-ai-portal"
  description = "Globally unique. medisense-portal stays taken while the sandbox site exists."
}

# --- Images ----------------------------------------------------------------------------------------------------------
# Cloud Run services are created with a placeholder image; the deploy scripts (infra/03, 04, 10) and CI replace it,
# and Terraform ignores image changes afterwards.
variable "litellm_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "backend_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "open_connector_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "toolbox_image" {
  type    = string
  default = "us-central1-docker.pkg.dev/database-toolbox/toolbox/toolbox:latest"
}

# --- Secret values ---------------------------------------------------------------------------------------------------
variable "secret_values" {
  type        = map(string)
  default     = {}
  sensitive   = true
  description = <<-EOT
    Overrides for Secret Manager values, keyed by secret name. Secrets not listed here get a generated value
    (litellm-master-key, oc-*, original-link-signing-key, toolbox-test-dbpw) or the placeholder REPLACE_ME
    (provider keys, github-dispatch-token, google-oauth-*, toolbox-tools).
    Copy oc-encryption-key from the sandbox BEFORE the first apply if you migrate the Open Connector database,
    otherwise its stored OAuth grants cannot be decrypted.
  EOT
}

variable "cloud_run_deletion_protection" {
  type    = bool
  default = false
}
