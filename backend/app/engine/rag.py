"""Knowledge: Vertex AI RAG Engine, ONE hospital-wide corpus for the knowledge library.

Decided 2026-10-26: documents live in a shared library (documents/{id}) and agents attach them
(AgentIn.knowledge_doc_ids). Retrieval passes the attached ragFile ids (`rag_file_ids`, verified live:
an unknown id returns nothing) so each agent only searches its own documents. Before this there was
one corpus per agent; scripts/migrate_knowledge_library.py moves those files into the library.

Why RAG Engine: Google manages chunking, embeddings and the vector store; we only keep the file
list in Firestore and the original bytes in the upload bucket (audit + re-index). Uses the
`google-cloud-agentplatform` client (the older `vertexai.rag` module is deprecated).

Direct upload (`upload_file`) is used instead of a GCS import so the RAG service agent needs no
IAM on our bucket. Upload size is capped by settings.max_upload_mb.

Timings seen 2026-10-24 in asia-east1: the FIRST corpus in the project took ~137 s (RAG managed DB
provisioning), later corpora ~22 s, a small file upload ~23 s. Cloud Run's 300 s request timeout
covers the normal case; the very first upload in a fresh project may need a second click.
"""
from __future__ import annotations

import logging
import time
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote

from google.api_core.exceptions import Conflict
from google.genai import errors as gerrors
from google.genai import types as gtypes

from .. import db
from ..config import settings

log = logging.getLogger(__name__)
_UPLOAD_ATTEMPTS = 3
_UPLOAD_RETRY_SECONDS = 10


@lru_cache
def _client():
    import agentplatform  # imported lazily: heavy, and optional when RAG is disabled

    s = settings()
    return agentplatform.Client(project=s.google_cloud_project, location=s.rag_location)


def _ascii_name(name: str, limit: int = 128) -> str:
    """The upload API sends display_name in an HTTP header, which must be ASCII (a Chinese file name
    raised UnicodeEncodeError). Percent-encode it, shortening the stem so the result fits `limit`."""
    p = Path(name)
    stem, suffix = p.stem, p.suffix
    while len(quote(stem + suffix, safe="")) > limit and stem:
        stem = stem[:-1]
    return quote(stem + suffix, safe="")


def create_corpus(display_name: str, description: str = "") -> str:
    """Return the corpus resource name (projects/.../locations/.../ragCorpora/...)."""
    from agentplatform import types as t

    s = settings()
    corpus = _client().rag.create_corpus(
        rag_corpus=t.RagCorpus(
            display_name=display_name[:128],
            description=description[:512],
            rag_vector_db_config=t.RagVectorDbConfig(
                rag_embedding_model_config=t.RagEmbeddingModelConfig(
                    vertex_prediction_endpoint=t.RagEmbeddingModelConfigVertexPredictionEndpoint(
                        endpoint=s.rag_embedding_model
                    )
                )
            ),
        )
    )
    assert corpus.name
    return corpus.name


def upload_file(corpus_name: str, local_path: str, display_name: str) -> str:
    """Synchronously chunk + embed one local file into the corpus. Returns the ragFile name.

    `local_path` must have an ASCII name too; `display_name` may be any text (stored percent-encoded,
    decoded again in retrieve())."""
    from agentplatform import types as t

    s = settings()
    cfg = t.UploadRagFileConfig(
        rag_file_transformation_config=t.RagFileTransformationConfig(
            rag_file_chunking_config=t.RagFileChunkingConfig(
                fixed_length_chunking=t.RagFileChunkingConfigFixedLengthChunking(
                    chunk_size=s.rag_chunk_size, chunk_overlap=s.rag_chunk_overlap
                )
            )
        )
    )
    # Observed 2026-10-24 (asia-east1): an upload issued right after create_corpus can come back as an
    # empty RagFile (no name) while the corpus is still provisioning; the next attempt succeeds.
    for attempt in range(_UPLOAD_ATTEMPTS):
        f = _client().rag.upload_file(corpus_name=corpus_name, path=local_path,
                                      display_name=_ascii_name(display_name), upload_rag_file_config=cfg)
        if f.name:
            return f.name
        log.warning("rag upload_file returned no name (attempt %d/%d), corpus %s", attempt + 1, _UPLOAD_ATTEMPTS, corpus_name)
        time.sleep(_UPLOAD_RETRY_SECONDS)
    raise RuntimeError("RAG Engine accepted the upload but returned no file; the corpus may still be provisioning, retry shortly")


def delete_file(rag_file_name: str) -> None:
    try:
        _client().rag.delete_file(name=rag_file_name)
    except gerrors.APIError as exc:  # already gone, or corpus deleted
        log.warning("rag delete_file %s: %s", rag_file_name, exc)


def delete_corpus(corpus_name: str) -> None:
    try:
        _client().rag.delete_corpus(name=corpus_name)
    except gerrors.APIError as exc:
        log.warning("rag delete_corpus %s: %s", corpus_name, exc)


_CONFIG_DOC = ("config", "knowledge")
_hospital_corpus = ""  # cached per process once known


def hospital_corpus() -> str:
    """The shared corpus, created on the first library upload. Its name is recorded with a Firestore
    `create`, so if two first uploads race, the loser deletes its corpus and uses the winner's."""
    global _hospital_corpus
    if _hospital_corpus:
        return _hospital_corpus
    ref = db.client().collection(_CONFIG_DOC[0]).document(_CONFIG_DOC[1])
    name = (ref.get().to_dict() or {}).get("rag_corpus")
    if name:
        _hospital_corpus = name
        return name
    name = create_corpus("tcvgh-hospital-knowledge", "TCVGH 院內指引與醫學知識庫 (de-identified text only)")
    try:
        ref.create({"rag_corpus": name, "created_at": db.now()})
    except Conflict:
        delete_corpus(name)
        name = ref.get().to_dict()["rag_corpus"]
    _hospital_corpus = name
    return name


def file_id(rag_file_name: str) -> str:
    """projects/.../ragCorpora/C/ragFiles/F -> F (what `rag_file_ids` expects)."""
    return rag_file_name.rsplit("/", 1)[-1]


def retrieve(corpus_name: str, rag_files: list[str], query: str, top_k: int | None = None) -> list[dict]:
    """Return [{text, source, uri, score}] ordered by relevance, searching only `rag_files`."""
    from agentplatform import types as t

    if not rag_files:
        return []
    s = settings()
    resp = _client().rag.retrieve_contexts(
        vertex_rag_store=gtypes.VertexRagStore(
            rag_resources=[gtypes.VertexRagStoreRagResource(rag_corpus=corpus_name, rag_file_ids=[file_id(f) for f in rag_files])]
        ),
        query=t.RagQuery(
            text=query[:4000],
            rag_retrieval_config=gtypes.RagRetrievalConfig(top_k=top_k or s.rag_top_k),
        ),
    )
    ctxs = (resp.contexts.contexts if resp.contexts and resp.contexts.contexts else []) or []
    return [
        {
            "text": c.text or "",
            "source": unquote(c.source_display_name or "") or (c.source_uri or "").rsplit("/", 1)[-1],
            "uri": c.source_uri or "",
            "score": c.score,
        }
        for c in ctxs
    ]
