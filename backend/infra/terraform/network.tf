# VPC used by Cloud Run Direct VPC egress (LiteLLM -> Ollama, backend -> everything, toolbox -> Cloud SQL private IP).
resource "google_compute_network" "vpc" {
  name                    = var.network_name
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  name                     = var.subnet_name
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true # infra/04: VPC-egress traffic still reaches *.googleapis.com
}

# Cloud NAT: the backend sends ALL traffic through the VPC, so it needs NAT to reach GitHub, MCP servers, webhooks;
# the Ollama VM (no external IP) needs it for `ollama pull`.
resource "google_compute_router" "nat" {
  name    = "${var.network_name}-${var.region}-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.network_name}-nat"
  router                             = google_compute_router.nat.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

resource "google_compute_firewall" "allow_ollama_internal" {
  name          = "allow-ollama-internal"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = [var.subnet_cidr]
  target_tags   = ["ollama"]
  description   = "Ollama (Gemma) on the on-prem stand-in VM; only from the subnet (Cloud Run Direct VPC egress)"

  allow {
    protocol = "tcp"
    ports    = ["11434"]
  }
}

# `gcloud compute ssh --tunnel-through-iap` to the Ollama VM (infra/12 prints this for watching first boot).
resource "google_compute_firewall" "allow_iap_ssh" {
  name          = "allow-iap-ssh-ollama"
  network       = google_compute_network.vpc.id
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["ollama"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# Private services access for the toolbox Cloud SQL instance (sandbox range "medisense", /24).
resource "google_compute_global_address" "psa" {
  name          = "medisense"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 24
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa.name]
}
