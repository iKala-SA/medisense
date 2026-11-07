# ONE Cloud Scheduler job drives every agent schedule (infra/08): POST /api/schedules/tick each minute, Asia/Taipei.
resource "google_cloud_scheduler_job" "tick" {
  name             = "tcvgh-schedule-tick"
  region           = var.region
  schedule         = "* * * * *"
  time_zone        = "Asia/Taipei"
  attempt_deadline = "300s"

  retry_config {
    retry_count = 0
  }

  http_target {
    uri         = "${google_cloud_run_v2_service.backend.uri}/api/schedules/tick"
    http_method = "POST"
    headers = {
      "X-Scheduler-Token" = random_id.scheduler_token.hex
      "Content-Type"      = "application/json"
    }
  }

  depends_on = [google_project_service.apis]
}
