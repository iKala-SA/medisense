#!/bin/bash
# Startup script for the on-prem stand-in Gemma VM (infra/12-ollama-vm.sh). Runs on every boot; idempotent.
# Installs Ollama as a systemd service listening on all interfaces (the VM has no external IP; the firewall
# only admits TCP 11434 from the default subnet, i.e. Cloud Run Direct VPC egress), waits for the NVIDIA driver
# the Deep Learning VM image installs on first boot, then pulls the models listed in OLLAMA_MODELS metadata.
set -euo pipefail
export HOME="${HOME:-/root}"   # the metadata script runner sets no HOME and the ollama CLI panics without one
exec > >(tee -a /var/log/ollama-startup.log) 2>&1
echo "=== $(date -Is) ollama startup ==="

MODELS="$(curl -sf -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/attributes/ollama-models' || echo 'gemma3:12b')"

# Wait up to 15 min for the GPU driver (first boot installs it); fall back to CPU if it never shows up.
for i in $(seq 1 90); do
  if nvidia-smi >/dev/null 2>&1; then echo "GPU driver ready"; break; fi
  sleep 10
done
nvidia-smi || echo "WARNING: no GPU driver; Ollama will run on CPU"

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
EOF
systemctl daemon-reload
systemctl enable ollama >/dev/null 2>&1 || true
systemctl restart ollama

for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:11434/api/version >/dev/null && break
  sleep 2
done

for m in $(echo "$MODELS" | tr ',' ' '); do
  echo "pulling $m"
  ollama pull "$m"
done
# Warm the first model into GPU memory so the first real request is fast.
FIRST="$(echo "$MODELS" | cut -d, -f1)"
curl -sf http://127.0.0.1:11434/api/generate -d "{\"model\":\"$FIRST\",\"prompt\":\"hi\",\"stream\":false}" >/dev/null || true
echo "=== $(date -Is) ollama startup done ==="
