# Cloud Run services (infra/03, 04, 10-open-connector, tcvgh-toolbox) and the Open Connector migrate job.
# Terraform owns the service shape (SA, scaling, network, env, secrets, IAM). Images are built and rolled out by the
# deploy scripts / CI, so image and args changes made by `gcloud run deploy` are ignored here.

locals {
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
  run_url_suffix    = "${data.google_project.this.number}.${var.region}.run.app"
  site_origin       = "https://${var.hosting_site_id}.web.app"
  # Deterministic URLs (known before the first deploy).
  open_connector_url = "https://medisense-open-connector-${local.run_url_suffix}"
  toolbox_host       = "tcvgh-toolbox-${local.run_url_suffix}"

  litellm_env = merge(
    {
      VERTEX_PROJECT               = var.project_id
      VERTEX_LOCATION              = var.vertex_location
      LITELLM_LOG                  = "INFO"
      LITELLM_LOCAL_MODEL_COST_MAP = "True"
      MODEL_ARMOR_PROJECT          = var.project_id
      MODEL_ARMOR_LOCATION         = var.model_armor_location
      MODEL_ARMOR_TEMPLATE_ID      = var.model_armor_template_id
      OLLAMA_API_BASE              = "http://${var.ollama_ip}:11434"
    },
    var.bedrock_role_arn == "" ? {} : {
      BEDROCK_REGION             = var.bedrock_region
      BEDROCK_ROLE_ARN           = var.bedrock_role_arn
      BEDROCK_WEB_IDENTITY_TOKEN = var.bedrock_web_identity_token
    },
  )

  backend_env = {
    GOOGLE_CLOUD_PROJECT        = var.project_id
    REGION                      = var.region
    LITELLM_BASE_URL            = google_cloud_run_v2_service.litellm.uri
    FIRESTORE_DATABASE          = google_firestore_database.main.name
    UPLOAD_BUCKET               = google_storage_bucket.uploads.name
    ALLOWED_DOMAINS             = var.allowed_domains
    DLP_INSPECT_TEMPLATE        = google_data_loss_prevention_inspect_template.phi.id
    RAG_ENABLED                 = var.rag_enabled
    RAG_LOCATION                = var.rag_location
    RAG_EMBEDDING_MODEL         = var.rag_embedding_model
    ADMIN_EMAILS                = var.admin_emails
    MONTHLY_BUDGET_USD          = var.monthly_budget_usd
    USD_TWD_RATE                = var.usd_twd_rate
    SCHEDULER_TOKEN             = random_id.scheduler_token.hex
    GITHUB_REPO                 = var.github_repo
    OPEN_CONNECTOR_URL          = "${google_cloud_run_v2_service.open_connector.uri}/api/oc"
    OPEN_CONNECTOR_IAM_AUDIENCE = google_cloud_run_v2_service.open_connector.uri
  }

  backend_secrets = {
    LITELLM_API_KEY            = "litellm-master-key"
    GITHUB_DISPATCH_TOKEN      = "github-dispatch-token"
    DOWNLOAD_SIGNING_KEY       = "original-link-signing-key"
    OPEN_CONNECTOR_TOKEN       = "oc-admin-token"
    GOOGLE_OAUTH_CLIENT_ID     = "google-oauth-client-id"
    GOOGLE_OAUTH_CLIENT_SECRET = "google-oauth-client-secret"
  }

  oc_secrets = {
    OOMOL_CONNECT_ENCRYPTION_KEY = "oc-encryption-key"
    OOMOL_CONNECT_ADMIN_TOKEN    = "oc-admin-token"
    OOMOL_CONNECT_DATABASE_URL   = "oc-database-url"
  }

  run_ignore_note = "image/args/client fields are set by gcloud deploys"
}

# --- LiteLLM (model gateway) ---------------------------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "litellm" {
  name                = "tcvgh-litellm"
  location            = var.region
  ingress             = var.litellm_ingress
  deletion_protection = var.cloud_run_deletion_protection

  template {
    service_account                  = local.sa_email.litellm
    max_instance_request_concurrency = 40
    timeout                          = "300s"

    scaling {
      min_instance_count = 1 # cold start ~50 s; backend calls would time out
      max_instance_count = 3
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY" # Ollama VM only; Vertex/Bedrock leave via Google's edge
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
    }

    containers {
      image = var.litellm_image
      args  = var.litellm_image == local.placeholder_image ? [] : ["--config", "/app/config.yaml", "--port", "4000"]

      ports {
        container_port = 4000
      }

      resources {
        limits            = { cpu = "1", memory = "1Gi" }
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.litellm_env
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name = "LITELLM_MASTER_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.s["litellm-master-key"].secret_id
            version = "latest"
          }
        }
      }
    }
  }

  lifecycle {
    # infra/09 adds EXTRA_SECRETS env entries for providers in the rendered registry; keep them.
    ignore_changes = [client, client_version, template[0].containers[0].image, template[0].containers[0].args, template[0].containers[0].env]
  }

  depends_on = [google_secret_manager_secret_version.s, google_project_iam_member.sa]
}

resource "google_cloud_run_v2_service_iam_member" "litellm_invoker" {
  for_each = toset(concat(["serviceAccount:${local.sa_email.backend}"], var.extra_litellm_invokers))
  name     = google_cloud_run_v2_service.litellm.name
  location = var.region
  role     = "roles/run.invoker"
  member   = each.value
}

# --- Open Connector gateway (per-user OAuth connectors) --------------------------------------------------------------
resource "google_cloud_run_v2_service" "open_connector" {
  name                = "medisense-open-connector"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL" # private at the IAM layer: only the backend SA may invoke
  deletion_protection = var.cloud_run_deletion_protection

  template {
    service_account                  = local.sa_email.open_connector
    max_instance_request_concurrency = 40
    timeout                          = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.oc_sql_connection]
      }
    }

    containers {
      image = var.open_connector_image

      ports {
        container_port = 3000
      }

      resources {
        limits            = { cpu = "1", memory = "1Gi" }
        startup_cpu_boost = true
      }

      env {
        name  = "OOMOL_CONNECT_ORIGIN"
        value = "${local.site_origin}/api/oc"
      }

      dynamic "env" {
        for_each = local.oc_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version, template[0].containers[0].image]
  }

  depends_on = [google_secret_manager_secret_iam_member.accessor, google_project_iam_member.sa]
}

resource "google_cloud_run_v2_service_iam_member" "open_connector_invoker" {
  name     = google_cloud_run_v2_service.open_connector.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.sa_email.backend}"
}

# Postgres needs `migrate` before the gateway starts: gcloud run jobs execute medisense-oc-migrate --region ... --wait
resource "google_cloud_run_v2_job" "oc_migrate" {
  name                = "medisense-oc-migrate"
  location            = var.region
  deletion_protection = var.cloud_run_deletion_protection

  template {
    template {
      service_account = local.sa_email.open_connector
      max_retries     = 0
      timeout         = "300s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.oc_sql_connection]
        }
      }

      containers {
        image = var.open_connector_image
        args  = ["migrate"]

        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }

        env {
          name = "OOMOL_CONNECT_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s["oc-database-url"].secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version, template[0].template[0].containers[0].image]
  }

  depends_on = [google_secret_manager_secret_iam_member.accessor]
}

# --- Platform API (FastAPI backend) ------------------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "backend" {
  name                = "tcvgh-platform-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.cloud_run_deletion_protection

  template {
    service_account                  = local.sa_email.backend
    max_instance_request_concurrency = 40
    timeout                          = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    vpc_access {
      egress = "ALL_TRAFFIC" # LiteLLM / toolbox are reached in-VPC; internet goes out through Cloud NAT
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
    }

    containers {
      image = var.backend_image

      ports {
        container_port = 8080
      }

      resources {
        limits            = { cpu = "1", memory = "2Gi" }
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.backend_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.backend_secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version, template[0].containers[0].image]
  }

  depends_on = [google_secret_manager_secret_iam_member.accessor, google_project_iam_member.sa]
}

# Public at the IAM layer because Firebase Hosting rewrites require it; every /api route verifies a Firebase ID token.
resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- Database Toolbox (DB connectors over MCP) -------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "toolbox" {
  count               = var.enable_toolbox && var.deploy_toolbox_service ? 1 : 0
  name                = "tcvgh-toolbox"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.cloud_run_deletion_protection

  template {
    service_account                  = local.sa_email.toolbox
    max_instance_request_concurrency = 40
    timeout                          = "300s"

    scaling {
      min_instance_count = 1
      max_instance_count = 3
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
    }

    volumes {
      name = "toolbox-tools"
      secret {
        secret = google_secret_manager_secret.s["toolbox-tools"].secret_id
        items {
          version = "latest"
          path    = "tools.yaml"
        }
      }
    }

    containers {
      image = var.toolbox_image
      args = [
        "--config=/app/tools.yaml", "--address=0.0.0.0", "--port=8080",
        "--allowed-hosts=${local.toolbox_host}", "--allowed-origins=https://${local.toolbox_host}",
      ]

      ports {
        container_port = 8080
      }

      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        startup_cpu_boost = true
      }

      env {
        name = "DBPW_1"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.s["toolbox-test-dbpw"].secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "toolbox-tools"
        mount_path = "/app"
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.accessor, google_project_iam_member.sa]
}

resource "google_cloud_run_v2_service_iam_member" "toolbox_invoker" {
  count    = length(google_cloud_run_v2_service.toolbox)
  name     = google_cloud_run_v2_service.toolbox[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.sa_email.backend}"
}
