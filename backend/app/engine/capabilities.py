"""What a picked agent may use (PRD §4.3), resolved for the PERSON running it: sharing an agent never shares its
knowledge, so spaces and documents are always filtered by what that person may see."""
from google.cloud import firestore  # noqa: F401  (kept for parity with other engine modules)

from .. import db
from ..auth import User
from ..schemas import AgentIn


def space_rag_files(user: User, space_ids: list[str]) -> list[str]:
    """ragFiles of the documents in these spaces that `user` may see (spaces they cannot view are skipped)."""
    from ..routers.knowledge import resolve_rag_files
    from ..routers.spaces import _viewable, doc_visible

    ids: list[str] = []
    for sid in space_ids:
        snap = db.client().collection("spaces").document(sid).get()
        d = snap.to_dict() if snap.exists else None
        if not d or not _viewable(user, d):
            continue
        for doc_id in d.get("document_ids") or []:
            ds = db.client().collection("documents").document(doc_id).get()
            if ds.exists and doc_visible(user, ds.to_dict() or {}):
                ids.append(doc_id)
    return resolve_rag_files(list(dict.fromkeys(ids)))


def rag_files_for(agent: AgentIn, user: User, attached: list[str]) -> list[str]:
    """The agent's attached documents (as resolved by the caller) plus the documents of its knowledge spaces that `user` may see."""
    return [*attached, *[f for f in space_rag_files(user, agent.capabilities.spaces) if f not in attached]]
