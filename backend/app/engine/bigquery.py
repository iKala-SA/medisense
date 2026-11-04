"""BigQuery as the signed-in user (docs/DB-CONNECTORS-DESIGN.md §6).

The browser obtains a short-lived Google access token (scope `bigquery`) and sends it with the chat request in the
`X-BigQuery-Auth` header; the backend calls the BigQuery REST API with it and never stores it. Google IAM decides what the
user can read (BigQuery Job User on the project, Data Viewer on the datasets/views). Rows come back in the same shape as
the other engines' results — one JSON object per line — so the row cut, de-identification and audit are shared."""
import contextlib
import contextvars
import json

import httpx

API = "https://bigquery.googleapis.com/bigquery/v2"
TIMEOUT_MS = 30_000
MAX_BYTES_BILLED = 10 * 1024**3  # 10 GiB per query unless the connector sets `max_bytes_billed`
_TOKEN: contextvars.ContextVar[str] = contextvars.ContextVar("bigquery_user_token", default="")


class BqError(Exception):
    """Shown to the model; `needs_auth` = the user must (re)authorise BigQuery in the browser."""

    def __init__(self, msg: str, needs_auth: bool = False):
        super().__init__(msg)
        self.needs_auth = needs_auth


@contextlib.contextmanager
def user_token(token: str | None):
    """Make the caller's BigQuery token available to database tools for the duration of one run."""
    reset = _TOKEN.set((token or "").removeprefix("Bearer ").strip())
    try:
        yield
    finally:
        _TOKEN.reset(reset)


def current_token() -> str:
    return _TOKEN.get()


_PTYPE = {"string": "STRING", "integer": "INT64", "float": "FLOAT64", "boolean": "BOOL"}


def _params(defs: list[dict], values: dict) -> list[dict]:
    out = []
    for p in defs:
        if p["name"] not in values:
            continue
        v = values[p["name"]]
        v = str(v).lower() if isinstance(v, bool) else str(v)
        out.append({"name": p["name"], "parameterType": {"type": _PTYPE.get(p.get("type", "string"), "STRING")}, "parameterValue": {"value": v}})
    return out


def _cell(field: dict, cell):
    """BigQuery REST returns every value as a string inside {"v": ...}; convert the common scalar types back."""
    v = cell.get("v") if isinstance(cell, dict) else cell
    if v is None:
        return None
    if field.get("mode") == "REPEATED":
        return [_cell({**field, "mode": ""}, x) for x in v]
    t = field.get("type")
    if t in ("RECORD", "STRUCT"):
        return {f["name"]: _cell(f, c) for f, c in zip(field.get("fields") or [], v.get("f") or [])}
    try:
        if t in ("INTEGER", "INT64"):
            return int(v)
        if t in ("FLOAT", "FLOAT64"):
            return float(v)
        if t in ("BOOLEAN", "BOOL"):
            return v == "true"
    except (TypeError, ValueError):
        pass
    return v


def _rows(resp: dict) -> str:
    fields = (resp.get("schema") or {}).get("fields") or []
    lines = []
    for r in resp.get("rows") or []:
        lines.append(json.dumps({f["name"]: _cell(f, c) for f, c in zip(fields, r.get("f") or [])}, ensure_ascii=False, default=str))
    return "\n".join(lines)


def _error(r: httpx.Response) -> BqError:
    try:
        err = r.json().get("error") or {}
    except ValueError:
        err = {}
    msg, reason = err.get("message") or r.text[:200], ((err.get("errors") or [{}])[0]).get("reason", "")
    if r.status_code == 401:
        return BqError("BigQuery 授權已過期，請重新授權後再問一次", needs_auth=True)
    if r.status_code == 403 and reason in ("accessDenied", "insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"):
        return BqError(f"你的 Google 帳號沒有權限執行這個查詢（需要專案的 BigQuery 工作使用者與資料集的資料檢視者）：{msg}")
    if reason == "bytesBilledLimitExceeded":
        return BqError(f"查詢掃描的資料量超過上限，請縮小範圍（例如加上日期條件）：{msg}")
    return BqError(f"BigQuery 錯誤（{r.status_code} {reason}）：{msg}")


def run(conn: dict, sql: str, *, max_rows: int, param_defs: list[dict] | None = None, values: dict | None = None,
        token: str | None = None, client: httpx.Client | None = None) -> str:
    """Run one read-only query as the user. -> one JSON object per row (newline separated)."""
    token = token if token is not None else current_token()
    if not token:
        raise BqError("需要你的 Google BigQuery 授權：請點輸入框旁的「授權 BigQuery」完成 Google 授權，再問一次", needs_auth=True)
    body = {"query": sql, "useLegacySql": False, "maxResults": max_rows, "timeoutMs": TIMEOUT_MS,
            "maximumBytesBilled": str(int(conn.get("max_bytes_billed") or MAX_BYTES_BILLED)),
            "location": conn.get("location") or "asia-east1", "jobCreationMode": "JOB_CREATION_OPTIONAL",
            "labels": {"source": "medisense"}}
    if (ps := _params(param_defs or [], values or {})):
        body |= {"parameterMode": "NAMED", "queryParameters": ps}
    if conn.get("datasets"):  # unqualified table names resolve against the first allowed dataset
        body["defaultDataset"] = {"projectId": conn["project"], "datasetId": conn["datasets"].split(",")[0].strip()}
    http = client or httpx.Client(timeout=TIMEOUT_MS / 1000 + 15)
    try:
        r = http.post(f"{API}/projects/{conn['project']}/queries", json=body, headers={"Authorization": f"Bearer {token}"})
        if r.status_code >= 400:
            raise _error(r)
        resp = r.json()
        if not resp.get("jobComplete", True):
            raise BqError(f"查詢超過 {TIMEOUT_MS // 1000} 秒仍未完成，請縮小範圍")
        return _rows(resp)
    finally:
        if client is None:
            http.close()


def datasets(conn: dict) -> list[str]:
    return [d.strip() for d in (conn.get("datasets") or "").split(",") if d.strip()]


def schema(conn: dict, match: str = "", *, token: str | None = None, client: httpx.Client | None = None) -> str:
    """Tables and columns of the connector's datasets (what the user's own Google account can see)."""
    from .db_direct import describe

    rows = []
    for ds in datasets(conn):
        sql = (f"SELECT table_name, column_name, data_type FROM `{conn['project']}.{ds}`.INFORMATION_SCHEMA.COLUMNS "
               "ORDER BY table_name, ordinal_position")
        for ln in run(conn, sql, max_rows=20000, token=token, client=client).splitlines():
            r = json.loads(ln)
            rows.append((f"{ds}.{r['table_name']}", r["column_name"], r["data_type"]))
    return describe(rows, match)
