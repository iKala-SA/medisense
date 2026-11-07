# On-prem stand-in for the `sovereign` model group (infra/12): Ollama on an L4 VM, internal IP only.
# Off by default: new projects usually have 0 NVIDIA L4 quota (request GPUS_ALL_REGIONS + NVIDIA_L4_GPUS first).
resource "google_compute_instance" "ollama" {
  count        = var.enable_ollama_vm ? 1 : 0
  name         = "tcvgh-onprem-gemma"
  zone         = var.zone
  machine_type = "g2-standard-4"
  tags         = ["ollama"]
  labels       = { purpose = "tcvgh-onprem-stand-in", owner = "esther" }

  boot_disk {
    initialize_params {
      image = "projects/deeplearning-platform-release/global/images/family/common-cu129-ubuntu-2204-nvidia-580"
      size  = 100
      type  = "pd-balanced"
    }
  }

  guest_accelerator {
    type  = "nvidia-l4"
    count = 1
  }

  scheduling {
    provisioning_model          = var.ollama_provisioning
    preemptible                 = var.ollama_provisioning == "SPOT"
    automatic_restart           = var.ollama_provisioning == "SPOT" ? false : true
    on_host_maintenance         = "TERMINATE"
    instance_termination_action = var.ollama_provisioning == "SPOT" ? "STOP" : null
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id
    network_ip = var.ollama_ip # LiteLLM's OLLAMA_API_BASE points here
  }

  metadata = {
    install-nvidia-driver = "True"
    ollama-models         = var.ollama_models
    startup-script        = file("${path.module}/../ollama-vm-startup.sh")
  }

  service_account {
    email  = local.sa_email.ollama_vm
    scopes = ["cloud-platform"]
  }

  depends_on = [google_compute_router_nat.nat]
}
