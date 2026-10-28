"""Runtime settings. Every value comes from the environment (Cloud Run env vars / secrets)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    google_cloud_project: str
    region: str = "asia-east1"
    # Signs the short-lived links that open a library document's ORIGINAL file (routers/originals.py). Empty = the
    # feature is off (fail closed). Must be the same on every Cloud Run instance.
    download_signing_key: str = ""
    original_link_ttl_seconds: int = 120
    # Retention (days). Firestore deletes a document once its `expire_at` passes (TTL policy: infra/11-retention-ttl.sh).
    # Every write pushes `expire_at` out again, so an active conversation stays; 0 disables expiry for that collection.
    session_retention_days: int = 180
    feedback_retention_days: int = 365

    litellm_base_url: str
    litellm_api_key: str

    # Named Firestore database in asia-east1. The shared sandbox's "(default)" database is in nam5 (US).
    firestore_database: str = "tcvgh-agent-platform"
    upload_bucket: str
    allowed_domains: str = ""  # comma-separated Workspace domains allowed to sign in
    admin_emails: str = "esther.shih@ikala.ai"  # comma-separated; these sign in as role=admin

    # Monitoring & cost (admin dashboard). Cap is hospital-wide per calendar month, USD.
    monthly_budget_usd: float = 5000.0
    usd_twd_rate: float = 32.0

    # De-identification is mandatory (no on/off flag, decided 2026-10-26): every message, knowledge file
    # and retrieved chunk goes through Sensitive Data Protection; if DLP fails, the request fails.
    # Sensitive Data Protection inspect template (infoTypes + likelihood), e.g.
    # projects/<p>/locations/global/inspectTemplates/<id>. Empty -> deid.FALLBACK_INFO_TYPES.
    dlp_inspect_template: str = ""

    # Knowledge (Vertex AI RAG Engine). asia-east1 is a Preview region for RAG Engine (checked 2026-10-24).
    rag_enabled: bool = True
    rag_location: str = "asia-east1"
    # Multilingual embeddings so Chinese clinical documents retrieve well.
    rag_embedding_model: str = "publishers/google/models/text-multilingual-embedding-002"
    rag_chunk_size: int = 512
    rag_chunk_overlap: int = 100
    rag_top_k: int = 5
    max_upload_mb: int = 25

    # Shared secret for POST /api/schedules/tick (one Cloud Scheduler job drives every schedule). Empty = tick disabled.
    scheduler_token: str = ""

    # Open Connector (oomol-lab/open-connector, pinned release): the OAuth + action gateway behind per-user connectors
    # such as Google Calendar. Internal service; the token is its admin/runtime bearer. Empty URL = feature off.
    open_connector_url: str = ""
    open_connector_token: str = ""
    # Set to the service URL when it sits behind Cloud Run IAM; a Google ID token is then sent as X-Serverless-Authorization.
    open_connector_iam_audience: str = ""
    # One platform-wide Google OAuth app reused by every Google service enabled through the gateway (empty = the wizard asks).
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    # 套用到 LiteLLM: POST /api/model-registry/apply dispatches this GitHub Actions workflow, which runs
    # infra/09-apply-litellm-config.sh and commits litellm/config.yaml. Token = fine-grained PAT with Actions: write
    # on the repo only, mounted from Secret Manager. Empty repo or token = deploy disabled (render still works).
    github_repo: str = ""  # owner/name, e.g. iKala-SA/medisense
    github_ref: str = "main"
    litellm_apply_workflow: str = "litellm-apply.yml"
    github_dispatch_token: str = ""

    @property
    def allowed_domain_list(self) -> list[str]:
        return [d.strip().lower() for d in self.allowed_domains.split(",") if d.strip()]

    @property
    def admin_email_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]


@lru_cache
def settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
