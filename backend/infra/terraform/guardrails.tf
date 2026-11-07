# DLP inspect template (de-identification, always on) and Model Armor template (LiteLLM prompt screening).
# Sandbox names: esther-inspect-test, esther-modelArmor. Settings copied from the live templates on 2026-11-06.

resource "google_data_loss_prevention_inspect_template" "phi" {
  parent       = "projects/${var.project_id}/locations/global"
  template_id  = var.dlp_template_id
  display_name = "Medisense PHI inspect"

  inspect_config {
    min_likelihood = "POSSIBLE"

    dynamic "info_types" {
      for_each = var.dlp_info_types
      content {
        name = info_types.value
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_model_armor_template" "prompt_guard" {
  location    = var.model_armor_location
  template_id = var.model_armor_template_id

  filter_config {
    rai_settings {
      dynamic "rai_filters" {
        for_each = ["HATE_SPEECH", "DANGEROUS", "SEXUALLY_EXPLICIT", "HARASSMENT"]
        content {
          filter_type      = rai_filters.value
          confidence_level = "MEDIUM_AND_ABOVE"
        }
      }
    }

    sdp_settings {
      basic_config {
        filter_enforcement = "ENABLED"
      }
    }

    pi_and_jailbreak_filter_settings {
      filter_enforcement = "ENABLED"
      confidence_level   = "MEDIUM_AND_ABOVE"
    }

    malicious_uri_filter_settings {
      filter_enforcement = "ENABLED"
    }
  }

  template_metadata {
    enforcement_type = "INSPECT_AND_BLOCK"
  }

  depends_on = [google_project_service.apis]
}
