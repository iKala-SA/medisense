# Firestore Native, named database in Taiwan (infra/02), composite indexes (infra/02) and TTL (infra/11).
resource "google_firestore_database" "main" {
  name                    = var.firestore_database
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.apis]
}

locals {
  # collection => list of [field, order] in index order
  firestore_indexes = {
    agents_owner     = { collection = "agents", fields = [["owner_uid", "ASCENDING"], ["updated_at", "DESCENDING"]] }
    agents_published = { collection = "agents", fields = [["status", "ASCENDING"], ["updated_at", "DESCENDING"]] }
    audit_actor      = { collection = "audit", fields = [["actor", "ASCENDING"], ["at", "DESCENDING"]] }
    audit_action     = { collection = "audit", fields = [["action", "ASCENDING"], ["at", "ASCENDING"]] }
    audit_actor_act  = { collection = "audit", fields = [["actor", "ASCENDING"], ["action", "ASCENDING"], ["at", "DESCENDING"]] }
    usage_daily_dept = { collection = "usage_daily", fields = [["department", "ASCENDING"], ["day", "ASCENDING"]] }
    sessions_uid     = { collection = "sessions", fields = [["uid", "ASCENDING"], ["updated_at", "DESCENDING"]] }
  }

  # Sandbox has TTL on the first four; infra/11 also lists shares.
  ttl_collections = ["sessions", "feedback", "step_runs", "run_files", "shares"]
}

resource "google_firestore_index" "composite" {
  for_each    = local.firestore_indexes
  database    = google_firestore_database.main.name
  collection  = each.value.collection
  query_scope = "COLLECTION"

  dynamic "fields" {
    for_each = each.value.fields
    content {
      field_path = fields.value[0]
      order      = fields.value[1]
    }
  }
}

resource "google_firestore_field" "ttl" {
  for_each   = toset(local.ttl_collections)
  database   = google_firestore_database.main.name
  collection = each.value
  field      = "expire_at"

  ttl_config {}
}
