# Upload bucket with CMEK (infra/02, infra/11), Artifact Registry, Cloud Build staging bucket (infra/10).
locals {
  upload_bucket = coalesce(var.upload_bucket_name, "${var.project_id}-tcvgh-agent-uploads")
}

# --- KMS key for the upload bucket (original knowledge files keep their PHI) ------------------------------------------
resource "google_kms_key_ring" "main" {
  name       = var.kms_keyring
  location   = var.region
  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key" "upload" {
  name            = var.kms_upload_key
  key_ring        = google_kms_key_ring.main.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "15552000s" # 180 days, as in the sandbox

  lifecycle {
    prevent_destroy = true
  }
}

data "google_storage_project_service_account" "gcs" {
  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key_iam_member" "gcs_upload_key" {
  crypto_key_id = google_kms_crypto_key.upload.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

# --- Upload bucket ----------------------------------------------------------------------------------------------------
resource "google_storage_bucket" "uploads" {
  name                        = local.upload_bucket
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.upload.id
  }

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  # Pasted chat images are deleted when their conversation expires (infra/11).
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age            = var.chat_image_retention_days
      matches_prefix = ["chat-images/"]
    }
  }

  depends_on = [google_kms_crypto_key_iam_member.gcs_upload_key]
}

resource "google_storage_bucket_iam_member" "uploads_backend" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${local.sa_email.backend}"
}

# --- Artifact Registry (LiteLLM, Open Connector, Keycloak images) -----------------------------------------------------
resource "google_artifact_registry_repository" "main" {
  repository_id = "tcvgh-agent-platform"
  location      = var.region
  format        = "DOCKER"
  description   = "TCVGH agent platform images"
  depends_on    = [google_project_service.apis]
}

resource "google_artifact_registry_repository_iam_member" "github_litellm" {
  repository = google_artifact_registry_repository.main.name
  location   = var.region
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${local.sa_email.github_litellm}"
}

# --- Cloud Build staging bucket -----------------------------------------------------------------------------------------
# gcloud would create it on the first `builds submit`; created here so the CI deploy SA can be granted access up front.
resource "google_storage_bucket" "cloudbuild" {
  name                        = "${var.project_id}_cloudbuild"
  location                    = "US"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  depends_on                  = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "cloudbuild_github_litellm" {
  bucket = google_storage_bucket.cloudbuild.name
  role   = "roles/storage.admin"
  member = "serviceAccount:${local.sa_email.github_litellm}"
}
