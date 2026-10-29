#!/usr/bin/env bash
# On-prem stand-in for the TCVGH POC: a Compute Engine VM running Ollama (Gemma 3) that LiteLLM's `sovereign`
# group points at (OLLAMA_API_BASE in env.sh). Internal IP only; the firewall admits TCP 11434 from the asia-east1
# default subnet only, which is where Cloud Run Direct VPC egress (03-deploy-litellm.sh) comes from. Cloud NAT on
# the default VPC gives the VM outbound access for `ollama pull`. The startup script (ollama-vm-startup.sh) runs on
# every boot: installs Ollama as a systemd service, waits for the NVIDIA driver, pulls OLLAMA_MODELS, warms the first.
#
# Created 2026-10-29 as a SPOT VM (on-demand L4 was stocked out in all three asia-east1 zones that day). A Spot VM
# can be preempted (it STOPs; start it again with `gcloud compute instances start`). To move to on-demand once
# capacity is back: stop it, then
#   gcloud compute instances set-scheduling "$VM" --zone "$ZONE" --provisioning-model STANDARD --maintenance-policy TERMINATE
# Usage: source infra/env.sh && bash infra/12-ollama-vm.sh            (idempotent: skips what exists)
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
HERE="$(cd "$(dirname "$0")" && pwd)"
VM="${OLLAMA_VM:-tcvgh-onprem-gemma}"
ZONE="${OLLAMA_ZONE:-asia-east1-a}"
MODELS="${OLLAMA_MODELS:-gemma3:12b,gemma3:4b}"   # first one is warmed at boot and is the `sovereign` primary
PROVISIONING="${OLLAMA_PROVISIONING:-SPOT}"        # SPOT | STANDARD

if ! gcloud compute firewall-rules describe allow-ollama-internal --format='value(name)' >/dev/null 2>&1; then
  gcloud compute firewall-rules create allow-ollama-internal --network default --direction INGRESS --action ALLOW \
    --rules tcp:11434 --source-ranges 10.140.0.0/20 --target-tags ollama \
    --description "Ollama (Gemma) on the on-prem stand-in VM; only from the asia-east1 default subnet (Cloud Run Direct VPC egress)"
fi

if ! gcloud compute instances describe "$VM" --zone "$ZONE" --format='value(name)' >/dev/null 2>&1; then
  EXTRA=()
  if [ "$PROVISIONING" = "SPOT" ]; then
    EXTRA=(--provisioning-model SPOT --instance-termination-action STOP)
  else
    EXTRA=(--maintenance-policy TERMINATE)
  fi
  gcloud compute instances create "$VM" --zone "$ZONE" "${EXTRA[@]}" \
    --machine-type g2-standard-4 --accelerator type=nvidia-l4,count=1 \
    --image-family common-cu129-ubuntu-2204-nvidia-580 --image-project deeplearning-platform-release \
    --boot-disk-size 100GB --boot-disk-type pd-balanced \
    --network default --subnet default --no-address --tags ollama --scopes default \
    --metadata "^;^install-nvidia-driver=True;ollama-models=${MODELS}" \
    --metadata-from-file "startup-script=${HERE}/ollama-vm-startup.sh" \
    --labels purpose=tcvgh-onprem-stand-in,owner=esther
fi

IP="$(gcloud compute instances describe "$VM" --zone "$ZONE" --format='value(networkInterfaces[0].networkIP)')"
echo "Ollama VM $VM ($ZONE): http://${IP}:11434  -> set OLLAMA_API_BASE in infra/env.sh, then 03-deploy-litellm.sh"
echo "Watch first boot: gcloud compute ssh $VM --zone $ZONE --tunnel-through-iap -- sudo tail -f /var/log/ollama-startup.log"
