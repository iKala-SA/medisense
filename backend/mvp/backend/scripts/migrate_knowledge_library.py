"""One-off: move per-agent knowledge files (agents/{id}/knowledge + one RAG corpus per agent) into the
hospital knowledge library (documents/{id} + one shared corpus), decided 2026-10-26.

For every legacy file with a stored original: re-index it from the GCS original through the normal
library path (extract -> de-identify -> shared corpus), create the document (category "other",
the agent's department, the original uploader), and attach it to the agent's draft AND every saved
snapshot (published agents run from agents/{id}/versions/{n}). When all of an agent's files moved,
its per-agent corpus, legacy records and rag_corpus/knowledge_count fields are deleted.

Dry run by default; pass --apply to write. Uses the backend env, e.g. from backend/.env:

    cd mvp/backend && set -a && . ./.env && set +a
    .venv/bin/python -m scripts.migrate_knowledge_library           # list what would move
    .venv/bin/python -m scripts.migrate_knowledge_library --apply   # move it and delete old corpora
"""
import sys

from google.cloud import firestore, storage

from app import db
from app.config import settings
from app.engine import rag
from app.routers.knowledge import _index


def main(apply: bool) -> int:
    s = settings()
    bucket = storage.Client(project=s.google_cloud_project).bucket(s.upload_bucket)
    c = db.client()
    moved = failed = 0
    for agent in c.collection("agents").stream():
        a = agent.to_dict() or {}
        legacy = [f for f in agent.reference.collection("knowledge").stream() if (f.to_dict() or {}).get("gcs_uri")]
        if not legacy and not a.get("rag_corpus"):
            continue
        print(f"{agent.id} {a.get('name')} [{a.get('status')}] corpus={str(a.get('rag_corpus') or '-').rsplit('/', 1)[-1]}")
        ok = True
        for f in legacy:
            rec = f.to_dict() or {}
            print(f"  {rec.get('name')} ({rec.get('size_bytes', 0)} bytes, legacy status {rec.get('status')})")
            moved += 1
            if not apply:
                continue
            try:
                data = bucket.blob(rec["gcs_uri"].removeprefix(f"gs://{s.upload_bucket}/")).download_as_bytes()
                ref = c.collection("documents").document()
                ref.set({"name": rec["name"], "category": "other", "department": a.get("department", ""),
                         "content_type": rec.get("content_type", ""), "size_bytes": len(data), "version": 1,
                         "uploaded_by": rec.get("uploaded_by", ""), "uploaded_uid": a.get("owner_uid", ""),
                         "created_at": rec.get("created_at") or db.now(), "updated_at": db.now(), "status": "indexing"})
                ref.update(_index(ref.id, 1, rec["name"], data, rec.get("content_type", "")))
                attach = {"knowledge_doc_ids": firestore.ArrayUnion([ref.id])}
                agent.reference.update(attach)
                for v in agent.reference.collection("versions").stream():
                    v.reference.update(attach)
                db.audit("system", "knowledge.upload", "", doc_id=ref.id, file=rec["name"], bytes=len(data),
                         deidentified=True, migrated_from=agent.id)
                print(f"    -> documents/{ref.id}, attached to the draft and saved snapshots")
            except Exception as exc:  # noqa: BLE001 - keep going; this agent keeps its old corpus until a rerun
                ok, failed = False, failed + 1
                print(f"    FAILED: {exc.__class__.__name__}: {exc}")
        if apply and ok:
            if a.get("rag_corpus"):
                rag.delete_corpus(a["rag_corpus"])
            for f in agent.reference.collection("knowledge").stream():
                f.reference.delete()
            agent.reference.update({"rag_corpus": firestore.DELETE_FIELD, "knowledge_count": firestore.DELETE_FIELD})
            print("  old corpus + legacy records deleted")
    print(f"{moved} file(s) {'migrated' if apply else 'would be migrated'}{f', {failed} failed' if failed else ''}.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main("--apply" in sys.argv))
