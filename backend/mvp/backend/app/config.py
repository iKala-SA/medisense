"""Runtime settings. Every value comes from the environment (Cloud Run env vars / secrets)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    google_cloud_project: str
    region: str = "asia-east1"

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
