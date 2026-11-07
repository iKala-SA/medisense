# Firebase on the project (infra/05), the Hosting site the portal deploys to, the web app (VITE_FIREBASE_*), and the
# Auth authorized domains. Enabling the Google sign-in provider stays a console step (it needs an OAuth client).

resource "google_firebase_project" "this" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.apis]
}

resource "google_firebase_web_app" "portal" {
  provider     = google-beta
  project      = var.project_id
  display_name = "medisense-portal"
  depends_on   = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "portal" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.portal.app_id
}

resource "google_firebase_hosting_site" "portal" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.hosting_site_id
  app_id   = google_firebase_web_app.portal.app_id
}

# Upgrades Firebase Auth to Identity Platform (also needed for the Keycloak OIDC provider, infra/15).
resource "google_identity_platform_config" "auth" {
  provider = google-beta
  project  = var.project_id

  authorized_domains = [
    "localhost",
    "${var.project_id}.firebaseapp.com",
    "${var.project_id}.web.app",
    "${var.hosting_site_id}.web.app",
    "${var.hosting_site_id}.firebaseapp.com",
  ]

  depends_on = [google_firebase_project.this]
}
