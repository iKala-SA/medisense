output "backend_url" {
  value = google_cloud_run_v2_service.backend.uri
}

output "litellm_url" {
  value = google_cloud_run_v2_service.litellm.uri
}

output "open_connector_url" {
  value = google_cloud_run_v2_service.open_connector.uri
}

output "hosting_url" {
  value = "https://${google_firebase_hosting_site.portal.site_id}.web.app"
}

output "upload_bucket" {
  value = google_storage_bucket.uploads.name
}

output "litellm_sa_unique_id" {
  description = "Add to the AWS role tcvgh-litellm-bedrock trust policy (accounts.google.com:sub) for keyless Bedrock."
  value       = google_service_account.sa["litellm"].unique_id
}

output "firebase_web_config" {
  description = "VITE_FIREBASE_* for frontend/.env.live and the GitHub Actions secrets."
  value = {
    VITE_FIREBASE_API_KEY     = data.google_firebase_web_app_config.portal.api_key
    VITE_FIREBASE_APP_ID      = google_firebase_web_app.portal.app_id
    VITE_FIREBASE_AUTH_DOMAIN = data.google_firebase_web_app_config.portal.auth_domain
    VITE_FIREBASE_PROJECT_ID  = var.project_id
  }
}

output "scheduler_token" {
  description = "export SCHEDULER_TOKEN=<this> before re-running infra/04 or infra/08, or the tick endpoint breaks."
  value       = random_id.scheduler_token.hex
  sensitive   = true
}

output "env_sh" {
  description = "Values that differ from the sandbox; put them in infra/env.sh before running the deploy scripts."
  value       = <<-EOT
    export PROJECT_ID="${var.project_id}"
    export MODEL_ARMOR_LOCATION="${var.model_armor_location}"
    export MODEL_ARMOR_TEMPLATE_ID="${var.model_armor_template_id}"
    export DLP_INSPECT_TEMPLATE="${google_data_loss_prevention_inspect_template.phi.id}"
    export UPLOAD_BUCKET="${google_storage_bucket.uploads.name}"
    export UPLOAD_KMS_KEY="${google_kms_crypto_key.upload.id}"
    export OLLAMA_API_BASE="http://${var.ollama_ip}:11434"
  EOT
}
