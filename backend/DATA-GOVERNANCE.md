# Data handling controls (what keeps hospital data from being retained or used for training)

Code and configuration cannot prove what a model vendor does with data; they limit what the vendor ever receives and how long we
keep our own copies. Vendor contracts (no training, retention, zero-retention options) still have to be confirmed separately.

| Control | Where | Operate it |
|---|---|---|
| De-identify before any model sees text (messages, retrieved passages, connector results, saved blocks, feedback text) | `engine/deid.py` and callers | always on, no switch |
| 僅本地模型 (nothing leaves the hospital) | 路由 admin page | admin switch |
| Web search is off unless an admin allows it, and the term is masked again | 路由 admin page, `engine/agent.py` | admin switch + user toggle |
| **Images in chat**: personal data written in an image is blacked out with Sensitive Data Protection (`redact_image`) before the image is stored or shown to a model; the original is never kept; a redaction error rejects the upload; images are removed with their conversation and by a bucket lifecycle rule | `engine/deid.redact_image`, `engine/chat_images.py`, `infra/11-retention-ttl.sh`; audit `chat.attach_image` | `IMAGE_REDACT_ALL_TEXT=true` blacks out all text; faces and handwriting are not detected |
| **Agent step runs**: what a user types into a step flow is de-identified before it is stored; uploaded input files are stored as de-identified text only; runs and files are readable only by the person who started them and expire with conversations (Firestore TTL on `expire_at`, `infra/11-retention-ttl.sh`) | `routers/step_runs.py`, `engine/steps.py`; audit `step_run.*` | none |
| **Connector de-identification** can only be switched off by an admin, with a reason; each call is audited with `redacted` | 連接器 → 合規設定; audit `connector.deid_off` / `connector.deid_on` / `connector.invoke` | admin |
| **Retention**: conversations expire 180 days after the last message, feedback after 365 days (Firestore TTL on `expire_at`) | `SESSION_RETENTION_DAYS`, `FEEDBACK_RETENTION_DAYS`; `infra/11-retention-ttl.sh`; `scripts/backfill_expiry.py` for old documents | run the TTL script once; 0 disables |
| **No outbound calls from the gateway for pricing data**: LiteLLM uses its bundled model-cost map | `LITELLM_LOCAL_MODEL_COST_MAP=True` in `infra/03-deploy-litellm.sh` (reused by 09) | redeploy LiteLLM |
| LiteLLM has no external logging callbacks (Langfuse, Sentry, …) and its own usage telemetry flag is a deprecated no-op in the version tested (1.106.5) | `litellm/config.yaml` | re-check when upgrading |
| **No third-party font requests**: fonts are served from the app itself | `frontend/public/fonts`, `src/fonts.css` | none |
| Usage ledger has no prompt text | `engine/usage.py` | none |

## Still to confirm outside the code
- Chat images are redacted in `global`, not Taiwan (see the images row). Decided 2026-10-29: keep `global`, the feature matters more; revisit if the hospital's policy requires images to stay in Taiwan. Tested 2026-10-29 on a synthetic ID card: personal-data-only mode missed the ID number (`A123456789`), all-text mode blacked out everything, which is why all-text is the default.
- Chat images: all text is blacked out by default (decided 2026-10-29); try it on real screenshots (lab reports, wristbands, EMR screens) to confirm nothing readable is left; Sensitive Data Protection does not detect faces or handwriting, and images with no recognisable text pass through as they are. Images are not sent to on-prem models (they have no vision).
- Vertex AI project settings: data caching, abuse-monitoring log retention, whether zero retention can be requested, and the terms that
  apply to preview models; `global` is not a Taiwan region.
- A signed DPA with audit and breach-notification rights for every cloud provider whose models are registered.
- Pin the LiteLLM image to the version that runs today (`litellm/Dockerfile` still uses the moving `main-stable` tag):
  `gcloud run services proxy tcvgh-litellm --region "$REGION" --port 4000 &` then `curl -s localhost:4000/health/readiness`
  prints `litellm_version`; use that version's tag in the Dockerfile.
- DLP coverage: test Chinese names, ID and medical-record-number formats on real-looking samples.
