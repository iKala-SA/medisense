#!/usr/bin/env bash
# Run the LiteLLM proxy locally on :4000 (what backend/.env LITELLM_BASE_URL points to).
# Install once:  uv tool install "litellm[proxy]" --with google-cloud-aiplatform
# Uses your gcloud Application Default Credentials for Vertex AI (run `gcloud auth application-default login` if needed).
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
# Master key must match LITELLM_API_KEY in ../backend/.env
KEY="$(grep -E '^LITELLM_API_KEY=' ../backend/.env | cut -d= -f2- | awk '{print $1}')"
export LITELLM_MASTER_KEY="$KEY"
export VERTEX_PROJECT="${VERTEX_PROJECT:-cloud-sa-sandbox-1}"
export VERTEX_LOCATION="${VERTEX_LOCATION:-global}"
exec litellm --config config.yaml --host 127.0.0.1 --port 4000
