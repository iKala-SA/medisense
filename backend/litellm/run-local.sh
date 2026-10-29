#!/usr/bin/env bash
# Run the LiteLLM proxy locally on :4000 (what backend/.env LITELLM_BASE_URL points to).
# Install once:  uv tool install "litellm[proxy]" --with google-cloud-aiplatform
# Uses your gcloud Application Default Credentials for Vertex AI (run `gcloud auth application-default login` if needed).
# nova-2-lite (Bedrock): set AWS_PROFILE_NAME to an `aws login` profile, e.g. AWS_PROFILE_NAME=gateway-mfa ./run-local.sh
# (needs `uv tool install ... --with "botocore[crt]"`). Without it, LiteLLM uses your default AWS creds.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
# Master key must match LITELLM_API_KEY in ../.env
KEY="$(grep -E '^LITELLM_API_KEY=' ../.env | cut -d= -f2- | awk '{print $1}')"
export LITELLM_MASTER_KEY="$KEY"
export VERTEX_PROJECT="${VERTEX_PROJECT:-cloud-sa-sandbox-1}"
export VERTEX_LOCATION="${VERTEX_LOCATION:-global}"
# Model Armor guardrail template (same defaults as infra/env.sh); without these every screened request fails closed.
export MODEL_ARMOR_PROJECT="${MODEL_ARMOR_PROJECT:-cloud-sa-sandbox-1}"
export MODEL_ARMOR_LOCATION="${MODEL_ARMOR_LOCATION:-us-central1}"
export MODEL_ARMOR_TEMPLATE_ID="${MODEL_ARMOR_TEMPLATE_ID:-esther-modelArmor}"
# nova-2-lite region (role/token env stay unset locally so LiteLLM uses AWS_PROFILE_NAME).
export BEDROCK_REGION="${BEDROCK_REGION:-ap-northeast-1}"
# On-prem Gemma via Ollama. Default: local `ollama serve` (needs `ollama pull gemma4:12b`, ~8 GB; gemma3 has no tool template).
# To use the VM instead: gcloud compute start-iap-tunnel tcvgh-onprem-gemma 11434 --local-host-port=localhost:11435 --zone asia-east1-a
# then OLLAMA_API_BASE=http://127.0.0.1:11435 ./run-local.sh
export OLLAMA_API_BASE="${OLLAMA_API_BASE:-http://127.0.0.1:11434}"
exec litellm --config config.yaml --host 127.0.0.1 --port 4000
