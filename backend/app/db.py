"""Firestore access. Collections:

agents/{agentId}                 draft definition (mutable)      owner_uid, name, ..., flow{nodes,edges}, knowledge_doc_ids
agents/{agentId}/versions/{n}    immutable snapshot on publish
agents/{agentId}/knowledge/{id}  LEGACY per-agent files (before the library; see scripts/migrate_knowledge_library.py)
documents/{docId}                hospital knowledge library: name, category, department, gcs_uri, deid_uri, rag_file, version, pii(none|found|unknown), pii_types[]
config/knowledge                 {rag_corpus}: the single hospital RAG corpus
sessions/{sessionId}             test-chat / channel conversations, pseudonymized content only; expire_at = TTL (180 d after the last message)
audit/{autoId}                   who did what, when (append-only)
usage/{autoId}                   one row per LLM call: tokens, cost, served model (no prompt text)
usage_daily/{day}_{agentId}      per-agent daily rollup read by the admin monitoring dashboard
groups/{id}                      admin-managed groups: name, description, member_emails[] (also used by sharing; see BE-GROUP-SPEC)
roles/{id}                       role definitions: system roles (admin/builder/user) may be overridden; custom roles are the rest.
                                 id, name, en, desc, custom, suspended, can[labels], created_at, created_by, updated_at, updated_by
skills/{id}                      reusable instructions: name, description, instructions, enabled, share, owner_*
schedules/{id}                   agent runs on a rhythm: agent_id, frequency, time, prompt, enabled, last_run, share
schedule_locks/{id}_{slot}       one doc per schedule per minute, created atomically so a run happens once
spaces/{id}                      groups of library documents: type, document_ids[], share, owner_*
models/{id}                      model registry (provider models, group, deploy, prices, secret NAME)
config/routing                   hospital-wide switches: sovereign_only (僅本地模型), model_armor
config/litellm_render            last rendered litellm config.yaml (never deployed by the API)
(share-able docs also carry share_keys[] = "u:<email>" / "g:<groupId>" for list queries; see sharing.py)
"""
from datetime import UTC, datetime
from functools import lru_cache

from google.cloud import firestore

from .config import settings


@lru_cache
def client() -> firestore.Client:
    return firestore.Client(project=settings().google_cloud_project, database=settings().firestore_database)


def now() -> datetime:
    return datetime.now(UTC)


def expiry(days: int) -> datetime | None:
    """`expire_at` for a TTL-managed document: `days` from now, or None when retention is off (0)."""
    from datetime import timedelta

    return now() + timedelta(days=days) if days > 0 else None


def audit(actor_uid: str, action: str, actor_email: str = "", **details) -> None:
    client().collection("audit").add({"actor": actor_uid, "actor_email": actor_email, "action": action,
                                      "at": now(), **details})
