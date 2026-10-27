#!/usr/bin/env bash
# Publish the model registry to LiteLLM: reads the YAML the admin rendered in the platform
# (POST /api/model-registry/apply -> Firestore config/litellm_render), writes litellm/config.yaml
# (previous one kept as config.yaml.bak) and runs the existing 03-deploy-litellm.sh.
# NOT run automatically. Set YES=1 to skip the confirmation prompt.
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HERE/../litellm/config.yaml"

DOC_URL="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${FIRESTORE_DATABASE}/documents/config/litellm_render"
TOKEN="$(gcloud auth print-access-token)"
RAW="$(curl -sf -H "Authorization: Bearer ${TOKEN}" "$DOC_URL")" || { echo "no rendered config found: press 'apply' in the admin Model registry first" >&2; exit 1; }

# Parse with python3 stdlib: yaml text -> $TARGET.new ; "ENV=secret:latest,..." -> stdout
EXTRA="$(RAW="$RAW" OUT="$TARGET.new" python3 - <<'PY'
import json, os
f = json.loads(os.environ["RAW"])["fields"]
open(os.environ["OUT"], "w").write(f["yaml"]["stringValue"])
secrets = f.get("secrets", {}).get("arrayValue", {}).get("values", [])
pairs = []
for s in secrets:
    m = s["mapValue"]["fields"]
    pairs.append(f'{m["env"]["stringValue"]}={m["secret"]["stringValue"]}:latest')
print(",".join(pairs))
PY
)"
echo "--- version $(echo "$RAW" | python3 -c 'import json,sys; print(json.load(sys.stdin)["fields"]["version"]["integerValue"])') ---"
diff -u "$TARGET" "$TARGET.new" || true
if [ "${YES:-}" != "1" ]; then
  read -r -p "Deploy this LiteLLM config now? [y/N] " ans
  [ "$ans" = "y" ] || { rm -f "$TARGET.new"; echo "aborted"; exit 1; }
fi
cp "$TARGET" "$TARGET.bak"
mv "$TARGET.new" "$TARGET"
EXTRA_SECRETS="$EXTRA" bash "$HERE/03-deploy-litellm.sh"
