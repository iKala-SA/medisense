"""De-identify text before it is stored, indexed, or sent to any model.

Sensitive Data Protection `deidentify_content` replaces every finding with its infoType name
(`王小明` -> `[PERSON_NAME]`). Decided 2026-10-26: replacement, no recovery, so there is no KMS
key and no re-identify path. Which infoTypes count is configured in the inspect template
(DLP_INSPECT_TEMPLATE), so the hospital can tune detectors in the console without a deploy.

Applied at three points: the chat message at ingress, knowledge file text before RAG indexing,
and retrieved chunks before they reach the LLM (covers files indexed before upload de-id existed).

There is no off switch (decided 2026-10-26, after a local backend with DEID_ENABLED=false indexed
raw PHI into the shared sandbox corpus). A DLP error propagates and fails the request: fail closed.
"""
from functools import lru_cache

from google.api_core.exceptions import InvalidArgument
from google.cloud import dlp_v2

from ..config import settings

# Used only when no inspect template is configured. Names must be valid in asia-east1
# (TAIWAN_NATIONAL_ID_NUMBER is not; the detector is TAIWAN_ID_NUMBER).
FALLBACK_INFO_TYPES = [
    "PERSON_NAME", "TAIWAN_ID_NUMBER", "PHONE_NUMBER", "EMAIL_ADDRESS", "DATE_OF_BIRTH",
    "MEDICAL_RECORD_NUMBER", "STREET_ADDRESS", "PASSPORT",
]
MAX_REQUEST_BYTES = 400_000  # deidentify_content caps a request at 0.5 MB; leave room for the envelope
_REPLACE = {"info_type_transformations": {"transformations": [{"primitive_transformation": {"replace_with_info_type_config": {}}}]}}


@lru_cache
def _client() -> dlp_v2.DlpServiceClient:
    return dlp_v2.DlpServiceClient()


def _request(item: dict) -> dict:
    s = settings()
    req: dict = {"parent": f"projects/{s.google_cloud_project}/locations/{s.region}", "deidentify_config": _REPLACE, "item": item}
    if s.dlp_inspect_template:
        req["inspect_template_name"] = s.dlp_inspect_template
    else:
        req["inspect_config"] = {"info_types": [{"name": t} for t in FALLBACK_INFO_TYPES], "min_likelihood": "POSSIBLE"}
    return req


def _pieces(text: str) -> list[str]:
    """Split on line boundaries into pieces under the request size cap (a single huge line is hard-cut)."""
    out, cur, size = [], [], 0
    for line in text.splitlines(keepends=True):
        n = len(line.encode())
        while n > MAX_REQUEST_BYTES:  # pathological: no newline for 400 KB
            cut = len(line) // 2
            out.extend(_pieces(line[:cut]))
            line = line[cut:]
            n = len(line.encode())
        if size + n > MAX_REQUEST_BYTES and cur:
            out.append("".join(cur))
            cur, size = [], 0
        cur.append(line)
        size += n
    if cur:
        out.append("".join(cur))
    return out


def _deidentify_piece(text: str) -> str:
    """DLP also caps findings per request ("Too many findings"); dense text (rosters, lists) is halved until it fits."""
    try:
        return _client().deidentify_content(request=_request({"value": text})).item.value
    except InvalidArgument as exc:
        if "Too many findings" not in str(exc) or len(text) < 2:
            raise
        lines = text.splitlines(keepends=True)
        if len(lines) > 1:
            mid = len(lines) // 2
            left, right = "".join(lines[:mid]), "".join(lines[mid:])
        else:
            left, right = text[: len(text) // 2], text[len(text) // 2:]
        return _deidentify_piece(left) + _deidentify_piece(right)


def deidentify(text: str) -> str:
    if not text.strip():
        return text
    return "".join(_deidentify_piece(p) for p in _pieces(text))


def deidentify_many(texts: list[str]) -> list[str]:
    """One call for a batch of short texts (retrieved chunks), sent as a one-column table."""
    if not texts:
        return texts
    table = {"headers": [{"name": "text"}], "rows": [{"values": [{"string_value": t}]} for t in texts]}
    rows = _client().deidentify_content(request=_request({"table": table})).item.table.rows
    return [r.values[0].string_value for r in rows]
