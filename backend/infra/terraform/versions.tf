terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is local by default. For a shared team state, create a bucket once and uncomment:
  #   gcloud storage buckets create gs://medisense-ai-portal-project-tfstate --location=asia-east1 \
  #     --uniform-bucket-level-access --public-access-prevention --project medisense-ai-portal-project
  # backend "gcs" {
  #   bucket = "medisense-ai-portal-project-tfstate"
  #   prefix = "medisense"
  # }
}

# user_project_override: Firebase / Identity Toolkit calls are billed to (and quota-checked against) the target project.
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

data "google_project" "this" {
  project_id = var.project_id
}
