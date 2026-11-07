# Service accounts and project-level roles (infra/02, 07, 10, 10-open-connector, plus tcvgh-toolbox-sa as found live).
locals {
  service_accounts = {
    litellm         = { id = "tcvgh-litellm-sa", name = "tcvgh-litellm-sa" }
    backend         = { id = "tcvgh-backend-sa", name = "tcvgh-backend-sa" }
    open_connector  = { id = "medisense-oc-sa", name = "Medisense Open Connector" }
    toolbox         = { id = "tcvgh-toolbox-sa", name = "tcvgh-toolbox-sa" }
    ollama_vm       = { id = "tcvgh-ollama-vm-sa", name = "Ollama VM (on-prem stand-in)" } # sandbox VM ran as the compute default SA
    github_litellm  = { id = "github-litellm-deploy", name = "GitHub Actions: LiteLLM config apply" }
    github_firebase = { id = "github-firebase-deploy", name = "GitHub Actions: Firebase Hosting deploy" }
  }

  project_roles = {
    # Call Vertex AI, read its secrets, screen prompts with Model Armor.
    litellm = [
      "roles/aiplatform.user", "roles/secretmanager.secretAccessor", "roles/logging.logWriter", "roles/modelarmor.user",
    ]
    # Firestore, secrets (connector credentials are created by the API), DLP, invoke LiteLLM, RAG Engine, Firebase Auth.
    backend = [
      "roles/datastore.user", "roles/secretmanager.secretAccessor", "roles/secretmanager.admin", "roles/dlp.user",
      "roles/dlp.inspectTemplatesReader", "roles/logging.logWriter", "roles/run.invoker", "roles/aiplatform.user",
      "roles/firebaseauth.admin",
    ]
    open_connector = ["roles/cloudsql.client"]
    toolbox        = ["roles/cloudsql.client", "roles/logging.logWriter", "roles/secretmanager.secretAccessor"]
    ollama_vm      = ["roles/logging.logWriter", "roles/monitoring.metricWriter"]
    # Build + redeploy LiteLLM, read config/litellm_deploy (infra/09, .github/workflows/litellm-apply.yml).
    github_litellm = [
      "roles/cloudbuild.builds.editor", "roles/logging.viewer", "roles/run.admin", "roles/datastore.viewer",
      "roles/serviceusage.serviceUsageConsumer", "roles/secretmanager.viewer", "roles/artifactregistry.reader",
    ]
    # Upload + release the site, validate the /api/** -> Cloud Run rewrite.
    github_firebase = [
      "roles/firebasehosting.admin", "roles/run.viewer", "roles/serviceusage.serviceUsageViewer",
    ]
  }

  project_bindings = {
    for b in flatten([
      for sa, roles in local.project_roles : [for r in roles : { key = "${sa}/${r}", sa = sa, role = r }]
    ]) : b.key => b
  }

  sa_email = { for k, v in google_service_account.sa : k => v.email }

  # Cloud Build in new projects runs as the Compute Engine default SA (gcloud builds submit / run deploy --source).
  compute_default_sa = "${data.google_project.this.number}-compute@developer.gserviceaccount.com"
}

resource "google_service_account" "sa" {
  for_each     = local.service_accounts
  account_id   = each.value.id
  display_name = each.value.name
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "sa" {
  for_each = local.project_bindings
  project  = var.project_id
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.sa[each.value.sa].email}"
}

# infra/03 (gcloud builds submit) and infra/04 (gcloud run deploy --source) need the build SA to build, push and log.
# If this fails with "service account does not exist", the Compute API was just enabled: re-run apply after a minute.
resource "google_project_iam_member" "build_sa" {
  project    = var.project_id
  role       = "roles/run.builder"
  member     = "serviceAccount:${local.compute_default_sa}"
  depends_on = [google_project_service.apis]
}

# The CI deploy SA submits builds that run as the build SA.
resource "google_service_account_iam_member" "github_litellm_act_as_build_sa" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.compute_default_sa}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.sa_email.github_litellm}"
  depends_on         = [google_project_iam_member.build_sa]
}

# Deploy LiteLLM *as* its runtime SA (actAs on that one SA only).
resource "google_service_account_iam_member" "github_litellm_act_as_litellm" {
  service_account_id = google_service_account.sa["litellm"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.sa_email.github_litellm}"
}
