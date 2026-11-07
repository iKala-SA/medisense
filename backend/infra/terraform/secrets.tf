# Secret Manager (infra/02, 04, 10-litellm-apply-cicd, 10-open-connector, toolbox). Connector credentials
# (tcvgh-conn-<id>-<field>) are created by the backend at runtime and are NOT managed here.

resource "random_id" "litellm_master_key" {
  byte_length = 24
}

resource "random_id" "oc_encryption_key" {
  byte_length = 32
}

resource "random_id" "oc_admin_token" {
  byte_length = 32
}

resource "random_id" "original_link_signing_key" {
  byte_length = 32
}

resource "random_password" "toolbox_db" {
  length  = 32
  special = false
}

# Not a secret in the sandbox either: a plain env var on the backend and a header on the scheduler job.
resource "random_id" "scheduler_token" {
  byte_length = 24
}

locals {
  # regional = user-managed replication in var.region (as in the sandbox); false = automatic.
  # accessors = SA keys from iam.tf that get secretAccessor on this secret (backend/litellm/toolbox also have it project-wide).
  secrets = {
    "litellm-master-key"         = { regional = true, value = "sk-${random_id.litellm_master_key.hex}", accessors = [] }
    "azure-openai-api-key"       = { regional = true, value = "REPLACE_ME", accessors = [] }
    "bedrock-aws-access-key"     = { regional = true, value = "REPLACE_ME", accessors = [] }
    "bedrock-aws-secret-key"     = { regional = true, value = "REPLACE_ME", accessors = [] }
    "onprem-vllm-api-key"        = { regional = true, value = "REPLACE_ME", accessors = [] }
    "github-dispatch-token"      = { regional = false, value = "REPLACE_ME", accessors = ["backend"] }
    "google-oauth-client-id"     = { regional = false, value = "REPLACE_ME", accessors = ["backend"] }
    "google-oauth-client-secret" = { regional = false, value = "REPLACE_ME", accessors = ["backend"] }
    "original-link-signing-key"  = { regional = false, value = random_id.original_link_signing_key.hex, accessors = ["backend"] }
    "oc-encryption-key"          = { regional = true, value = random_id.oc_encryption_key.b64_std, accessors = ["open_connector"] }
    "oc-admin-token"             = { regional = true, value = random_id.oc_admin_token.b64_std, accessors = ["open_connector", "backend"] }
    "oc-database-url"            = { regional = true, value = local.oc_database_url, accessors = ["open_connector"] }
    "toolbox-test-dbpw"          = { regional = false, value = random_password.toolbox_db.result, accessors = ["toolbox"] }
    "toolbox-tools"              = { regional = true, value = "REPLACE_ME", accessors = ["toolbox"] }
  }

  secret_accessors = {
    for b in flatten([
      for s, cfg in local.secrets : [for sa in cfg.accessors : { key = "${s}/${sa}", secret = s, sa = sa }]
    ]) : b.key => b
  }
}

resource "google_secret_manager_secret" "s" {
  for_each  = local.secrets
  secret_id = each.key

  replication {
    dynamic "user_managed" {
      for_each = each.value.regional ? [1] : []
      content {
        replicas {
          location = var.region
        }
      }
    }
    dynamic "auto" {
      for_each = each.value.regional ? [] : [1]
      content {}
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "s" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = lookup(var.secret_values, each.key, each.value.value)

  # Values rotated later with `gcloud secrets versions add` are newer versions; Terraform keeps only this first one.
  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each  = local.secret_accessors
  secret_id = google_secret_manager_secret.s[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.sa_email[each.value.sa]}"
}

# The LiteLLM apply workflow can push a new toolbox tools.yaml (as in the sandbox).
resource "google_secret_manager_secret_iam_member" "toolbox_tools_github" {
  secret_id = google_secret_manager_secret.s["toolbox-tools"].id
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${local.sa_email.github_litellm}"
}
