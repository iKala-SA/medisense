"""BigQuery as the signed-in user (docs/DB-CONNECTORS-DESIGN.md §6).

Two ways to be the user, tried in this order:
  1. The user's own Google grant held by the Open Connector gateway (service `google_bigquery`, connected once in 連接器 →
     我的連線; the gateway refreshes it, so it lasts until revoked). Queries run through the gateway's `start_query_job` +
     `get_query_results` actions, which keep `maximumBytesBilled` and the default dataset.
  2. A short-lived Google access token (scope `bigquery`) the browser obtained and sent in the `X-BigQuery-Auth` header; the
     backend calls the BigQuery REST API with it and never stores it (the hourly fallback, and what the admin's test uses).
Google IAM decides what the user can read either way. Rows come back as one JSON object per line, so the row cut,
de-identification and audit are shared with the other engines."""
import contextlib
import contextvars
import json
import time

import httpx

from . import open_connector as oc

GATEWAY_SERVICE = "google_bigquery"
_LINK_TTL = 60.0
_linked_cache: dict[str, tuple[float, bool]] = {}

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


def linked(uid: str | None) -> bool:
    """Does this user have an active google_bigquery grant in the gateway? Cached a minute per user (one gateway call)."""
    if not uid or not oc.configured():
        return False
    hit = _linked_cache.get(uid)
    if hit and time.monotonic() - hit[0] < _LINK_TTL:
        return hit[1]
    try:
        c = oc.connection(GATEWAY_SERVICE, uid)
        ok = bool(c and c.get("status") == "active")
    except oc.OpenConnectorError:
        ok = False
    _linked_cache[uid] = (time.monotonic(), ok)
    return ok


def reset_link_cache() -> None:
    _linked_cache.clear()


NEEDS_AUTH = ("需要你的 Google BigQuery 授權：請到「連接器 → 我的連線」連線 Google BigQuery（授權一次，長期有效），"
              "或點輸入框旁的「授權 BigQuery」做一小時的臨時授權，再問一次")


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
    """Rows of a BigQuery REST response (`rows[].f[].v`), or of the gateway's normalised shape (`rows[].values[]`)."""
    fields = (resp.get("schema") or {}).get("fields") or []
    lines = []
    for r in resp.get("rows") or []:
        if isinstance(r, dict) and "f" in r:
            cells = r.get("f") or []
        else:
            cells = [{"v": v} for v in ((r.get("values") if isinstance(r, dict) else r) or [])]
        lines.append(json.dumps({f["name"]: _cell(f, c) for f, c in zip(fields, cells)}, ensure_ascii=False, default=str))
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


def _gateway_error(exc: oc.OpenConnectorError) -> BqError:
    if exc.not_connected:
        reset_link_cache()
        return BqError("BigQuery 的 Google 授權已失效或被撤銷，請到「連接器 → 我的連線」重新授權後再問一次", needs_auth=True)
    msg = str(exc)
    if "bytesBilledLimitExceeded" in msg:
        return BqError(f"查詢掃描的資料量超過上限，請縮小範圍（例如加上日期條件）：{msg}")
    if "accessDenied" in msg or "insufficientPermissions" in msg or "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in msg:
        return BqError(f"你的 Google 帳號沒有權限執行這個查詢（需要專案的 BigQuery 工作使用者與資料集的資料檢視者）：{msg}")
    return BqError(f"BigQuery 錯誤（經連接器閘道）：{msg}")


def _run_gateway(conn: dict, sql: str, *, max_rows: int, param_defs: list[dict], values: dict, uid: str) -> str:
    """The same query through the user's gateway grant: start the job (keeps the bytes-billed cap and default dataset), then
    fetch the results with the synchronous timeout."""
    location = conn.get("location") or "asia-east1"
    job: dict = {"projectId": conn["project"], "query": sql, "location": location, "useLegacySql": False,
                 "maximumBytesBilled": str(int(conn.get("max_bytes_billed") or MAX_BYTES_BILLED)), "labels": {"source": "medisense"}}
    if (ps := _params(param_defs, values)):
        job |= {"parameterMode": "NAMED", "queryParameters": ps}
    if conn.get("datasets"):
        job["defaultDataset"] = {"projectId": conn["project"], "datasetId": conn["datasets"].split(",")[0].strip()}
    try:
        started = oc.execute(f"{GATEWAY_SERVICE}.start_query_job", job, uid) or {}
        ref = ((started.get("job") or started).get("jobReference") or {}) if isinstance(started, dict) else {}
        job_id = ref.get("jobId")
        if not job_id:
            raise BqError("BigQuery 沒有回傳工作編號，請稍後再試")
        res = oc.execute(f"{GATEWAY_SERVICE}.get_query_results",
                         {"projectId": conn["project"], "jobId": job_id, "location": ref.get("location") or location,
                          "maxResults": max_rows, "timeoutMs": TIMEOUT_MS}, uid) or {}
    except oc.OpenConnectorError as exc:
        raise _gateway_error(exc) from exc
    raw = res.get("raw") if isinstance(res.get("raw"), dict) and res["raw"].get("rows") is not None else res
    if not raw.get("jobComplete", True):
        raise BqError(f"查詢超過 {TIMEOUT_MS // 1000} 秒仍未完成，請縮小範圍")
    return _rows(raw)


def run(conn: dict, sql: str, *, max_rows: int, param_defs: list[dict] | None = None, values: dict | None = None,
        token: str | None = None, client: httpx.Client | None = None, uid: str | None = None) -> str:
    """Run one read-only query as the user. -> one JSON object per row (newline separated).
    The user's gateway grant (`uid`) wins when they have one; otherwise the browser token of this request."""
    if token is None and linked(uid):
        return _run_gateway(conn, sql, max_rows=max_rows, param_defs=param_defs or [], values=values or {}, uid=uid)
    token = token if token is not None else current_token()
    if not token:
        raise BqError(NEEDS_AUTH, needs_auth=True)
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


def schema(conn: dict, match: str = "", *, token: str | None = None, client: httpx.Client | None = None, uid: str | None = None) -> str:
    """Tables and columns of the connector's datasets (what the user's own Google account can see)."""
    from .db_direct import describe

    rows = []
    for ds in datasets(conn):
        sql = (f"SELECT table_name, column_name, data_type FROM `{conn['project']}.{ds}`.INFORMATION_SCHEMA.COLUMNS "
               "ORDER BY table_name, ordinal_position")
        for ln in run(conn, sql, max_rows=20000, token=token, client=client, uid=uid).splitlines():
            r = json.loads(ln)
            rows.append((f"{ds}.{r['table_name']}", r["column_name"], r["data_type"]))
    return describe(rows, match)
