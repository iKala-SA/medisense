# Cloud SQL: medisense-oc-db (Open Connector, infra/10-open-connector.sh) and medisense-connector-toolbox (DB connectors,
# created outside the scripts; settings copied from the live instance).

# --- medisense-oc-db ----------------------------------------------------------------------------------------------------
resource "google_sql_database_instance" "oc" {
  name                = "medisense-oc-db"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier                        = "db-f1-micro"
    edition                     = "ENTERPRISE"
    availability_type           = "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    deletion_protection_enabled = true

    # Public IP with no authorized networks: only the Cloud SQL connector (Cloud Run socket) can reach it.
    ip_configuration {
      ipv4_enabled = true
    }

    backup_configuration {
      enabled    = true
      start_time = "18:00"
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 19
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "open_connector" {
  name     = "open_connector"
  instance = google_sql_database_instance.oc.name
}

resource "random_password" "oc_db" {
  length  = 48
  special = false
}

resource "google_sql_user" "oc" {
  name     = "oc"
  instance = google_sql_database_instance.oc.name
  password = random_password.oc_db.result
}

locals {
  oc_sql_connection = google_sql_database_instance.oc.connection_name
  # Placeholder host "localhost" is required by the gateway's URL check; host= points at the Cloud SQL unix socket.
  oc_database_url = "postgresql://oc:${random_password.oc_db.result}@localhost/open_connector?host=/cloudsql/${local.oc_sql_connection}"
}

# --- medisense-connector-toolbox ----------------------------------------------------------------------------------------
resource "google_sql_database_instance" "toolbox" {
  count               = var.enable_toolbox ? 1 : 0
  name                = "medisense-connector-toolbox"
  region              = var.region
  database_version    = "POSTGRES_18"
  deletion_protection = true

  settings {
    tier                        = "db-custom-2-8192"
    edition                     = "ENTERPRISE"
    availability_type           = "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    deletion_protection_enabled = true

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    ip_configuration {
      ipv4_enabled       = false
      private_network    = google_compute_network.vpc.id
      allocated_ip_range = google_compute_global_address.psa.name
      ssl_mode           = "ENCRYPTED_ONLY"

      psc_config {
        psc_enabled = true
      }
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "08:00"
      location                       = "asia"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day          = 7 # Sunday; Cloud SQL rejects update_track without a day
      hour         = 19
      update_track = "canary"
    }
  }

  depends_on = [google_service_networking_connection.psa]
}
