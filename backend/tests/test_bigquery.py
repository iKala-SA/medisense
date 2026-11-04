"""BigQuery as the signed-in user: the user's token is forwarded, never stored; rows are cut, de-identified and audited."""
import json

import httpx
import pytest

from app.engine import bigquery, db_tools

from .conftest import ADMIN, BUILDER
from .test_db_connectors import secrets  # noqa: F401  (fixture)

BQ = {"name": "門診統計", "kind": "bigquery", "connection": {"project": "proj-1", "location": "asia-east1", "datasets": "clinic"}, "max_rows": 2}

ROWS = {"jobComplete": True, "schema": {"fields": [{"name": "dept", "type": "STRING"}, {"name": "n", "type": "INTEGER"}]},
        "rows": [{"f": [{"v": "王小明 內科"}, {"v": "12"}]}, {"f": [{"v": "外科"}, {"v": "3"}]}, {"f": [{"v": "眼科"}, {"v": "1"}]}]}


@pytest.fixture
def bq(fs, as_user, secrets, monkeypatch, audit_log):  # noqa: F811
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("王小明", "[PERSON_NAME]"))
    cid = as_user(ADMIN).post("/api/db-connectors", json=BQ).json()["id"]
    sent, reply = [], {"status": 200, "json": ROWS}

    def handler(req: httpx.Request):
        sent.append({"url": str(req.url), "auth": req.headers.get("authorization"), "body": json.loads(req.content)})
        return httpx.Response(reply["status"], json=reply["json"])
    real = bigquery.run
    monkeypatch.setattr(bigquery, "run", lambda *a, **k: real(*a, **{**k, "client": httpx.Client(transport=httpx.MockTransport(handler))}))
    return cid, sent, reply, audit_log


def spec(cid, kind):
    return next(s for s in db_tools.tool_specs([cid]) if s["meta"]["kind"] == kind)


SQL = "SELECT dept, n FROM clinic.v_visits WHERE dept = '內科'"


def test_query_runs_as_the_user_and_rows_are_cut_and_deidentified(bq):
    cid, sent, _, audit = bq
    with bigquery.user_token("Bearer ya29.user"):
        text, summary = db_tools.execute(spec(cid, "sql")["meta"], {"sql": SQL}, user_id="u", email=BUILDER.email, agent_id="a")
    (req,) = sent
    assert req["url"] == "https://bigquery.googleapis.com/bigquery/v2/projects/proj-1/queries" and req["auth"] == "Bearer ya29.user"
    b = req["body"]
    assert b["useLegacySql"] is False and b["location"] == "asia-east1" and b["maxResults"] == 2 and int(b["maximumBytesBilled"]) > 0
    assert b["query"].endswith("LIMIT 2") and b["defaultDataset"] == {"projectId": "proj-1", "datasetId": "clinic"}
    rows = [json.loads(x) for x in text.splitlines() if x.startswith("{")]
    assert rows == [{"dept": "[PERSON_NAME] 內科", "n": 12}, {"dept": "外科", "n": 3}] and "上限" in text and "王小明" not in text
    a = [x for x in audit() if x["action"] == "db.query"][-1]
    assert a["ok"] and a["rows"] == 2 and "ya29" not in json.dumps(a, default=str)


def test_named_parameters_are_typed():
    assert bigquery._params([{"name": "y", "type": "integer"}], {"y": 2024}) == \
        [{"name": "y", "parameterType": {"type": "INT64"}, "parameterValue": {"value": "2024"}}]


def test_tables_tool_reads_information_schema_as_the_user(bq):
    cid, sent, reply, _ = bq
    reply["json"] = {"jobComplete": True, "schema": {"fields": [{"name": "table_name", "type": "STRING"}, {"name": "column_name", "type": "STRING"},
                                                                {"name": "data_type", "type": "STRING"}]},
                     "rows": [{"f": [{"v": "v_visits"}, {"v": "dept"}, {"v": "STRING"}]}, {"f": [{"v": "v_visits"}, {"v": "n"}, {"v": "INT64"}]}]}
    with bigquery.user_token("tok"):
        text, _ = db_tools.execute(spec(cid, "tables")["meta"], {}, user_id="u", email=BUILDER.email, agent_id="a")
    assert text == "- clinic.v_visits：dept(string), n(int64)" and "`proj-1.clinic`.INFORMATION_SCHEMA.COLUMNS" in sent[0]["body"]["query"]


def test_model_sql_is_guarded_before_it_reaches_bigquery(bq):
    cid, sent, _, _ = bq
    meta = spec(cid, "sql")["meta"]
    with bigquery.user_token("tok"):
        text, _ = db_tools.execute(meta, {"sql": "DELETE FROM clinic.v_visits WHERE TRUE"}, user_id="u", email=BUILDER.email, agent_id="a")
        assert "未通過檢查" in text and sent == []
        db_tools.execute(meta, {"sql": "SELECT dept, n FROM clinic.v_visits WHERE n > 1"}, user_id="u", email=BUILDER.email, agent_id="a")
    assert sent[0]["body"]["query"].endswith("LIMIT 2") and "queryParameters" not in sent[0]["body"]


def test_without_a_token_the_user_is_asked_to_authorise(bq):
    cid, sent, _, audit = bq
    text, summary = db_tools.execute(spec(cid, "sql")["meta"], {"sql": SQL}, user_id="u", email=BUILDER.email, agent_id="a")
    assert "授權 BigQuery" in text and "需要 BigQuery 授權" in summary and sent == []
    assert [x["ok"] for x in audit() if x["action"] == "db.query"] == [False]


@pytest.mark.parametrize("status,err,expect,needs", [
    (401, {"message": "Invalid Credentials", "errors": [{"reason": "authError"}]}, "授權已過期", True),
    (403, {"message": "Access Denied", "errors": [{"reason": "accessDenied"}]}, "沒有權限", False),
    (400, {"message": "Query exceeded limit", "errors": [{"reason": "bytesBilledLimitExceeded"}]}, "資料量超過上限", False),
])
def test_bigquery_errors_are_explained(bq, status, err, expect, needs):
    cid, _, reply, _ = bq
    reply.update(status=status, json={"error": err})
    with bigquery.user_token("tok"):
        text, summary = db_tools.execute(spec(cid, "sql")["meta"], {"sql": SQL}, user_id="u", email=BUILDER.email, agent_id="a")
    assert expect in text and ("需要 BigQuery 授權" in summary) == needs


def test_token_is_scoped_to_the_request():
    assert bigquery.current_token() == ""
    with bigquery.user_token("Bearer abc"):
        assert bigquery.current_token() == "abc"
    assert bigquery.current_token() == ""


def test_chat_endpoint_forwards_the_header(fs, as_user, monkeypatch):
    seen = {}
    monkeypatch.setattr("app.routers.chat._prepare", lambda body, user: {})
    def fake_run(**k):
        seen["tok"] = bigquery.current_token()
        return {"session_id": "s", "reply": "", "trace": []}
    monkeypatch.setattr("app.routers.chat.execute_run", fake_run)
    as_user(BUILDER).post("/api/chat", json={"message": "hi"}, headers={"X-BigQuery-Auth": "Bearer t0k"})
    assert seen["tok"] == "t0k" and bigquery.current_token() == ""


# ------------------------------------------------------------------ the long-lived path: the user's gateway grant
@pytest.fixture
def linked_gateway(monkeypatch):
    """The user has connected Google BigQuery in 我的連線: the gateway holds (and refreshes) the grant."""
    from app.engine import open_connector as oc

    calls = []
    monkeypatch.setattr(oc, "configured", lambda: True)
    monkeypatch.setattr(oc, "connection", lambda service, uid: {"service": service, "status": "active"} if uid == BUILDER.uid else None)

    def execute(action, input_, uid=None, *, connection=None):
        calls.append((action, input_, uid))
        if action.endswith("start_query_job"):
            return {"job": {"jobReference": {"projectId": "proj-1", "jobId": "job-9", "location": "asia-east1"}}}
        return {"jobComplete": True, "rows": [{"values": ["王小明 內科", "12"]}, {"values": ["外科", "3"]}, {"values": ["眼科", "1"]}],
                "schema": {"fields": ROWS["schema"]["fields"]}, "raw": ROWS}
    monkeypatch.setattr(oc, "execute", execute)
    bigquery.reset_link_cache()
    yield calls
    bigquery.reset_link_cache()


def test_a_connected_user_queries_through_the_gateway_without_any_browser_token(bq, linked_gateway):
    cid, sent, _, audit = bq
    text, summary = db_tools.execute(spec(cid, "sql")["meta"], {"sql": SQL}, user_id=BUILDER.uid, email=BUILDER.email, agent_id="a")
    assert "[PERSON_NAME]" in text and summary == "門診統計 · 2 筆" and not sent  # no direct REST call: the gateway did it
    start, results = linked_gateway
    assert start[0] == "google_bigquery.start_query_job" and start[2] == BUILDER.uid
    assert start[1]["projectId"] == "proj-1" and start[1]["query"].startswith(SQL) and start[1]["maximumBytesBilled"] == str(10 * 1024**3)
    assert start[1]["defaultDataset"] == {"projectId": "proj-1", "datasetId": "clinic"} and start[1]["useLegacySql"] is False
    assert results[0] == "google_bigquery.get_query_results" and results[1] == {"projectId": "proj-1", "jobId": "job-9", "location": "asia-east1", "maxResults": 2, "timeoutMs": 30000}


def test_someone_without_a_grant_still_uses_the_hourly_token_or_is_told_both_ways(bq, linked_gateway):
    cid, sent, _, _ = bq
    with bigquery.user_token("ya29.short"):  # ADMIN has no gateway grant: the browser token is used
        text, _ = db_tools.execute(spec(cid, "sql")["meta"], {"sql": SQL}, user_id=ADMIN.uid, email=ADMIN.email, agent_id="a")
    assert "[PERSON_NAME]" in text and sent and sent[0]["auth"] == "Bearer ya29.short"
    text, summary = db_tools.execute(spec(cid, "sql")["meta"], {"sql": SQL}, user_id=ADMIN.uid, email=ADMIN.email, agent_id="a")
    assert "需要 BigQuery 授權" in summary and "我的連線" in text and "授權 BigQuery" in text


def test_a_revoked_grant_asks_for_reauthorization_and_drops_the_cache(bq, linked_gateway, monkeypatch):
    from app.engine import open_connector as oc

    cid = bq[0]
    monkeypatch.setattr(oc, "execute", lambda *a, **k: (_ for _ in ()).throw(oc.OpenConnectorError("gone", "reauth_required", 403)))
    text, summary = db_tools.execute(spec(cid, "sql")["meta"], {"sql": SQL}, user_id=BUILDER.uid, email=BUILDER.email, agent_id="a")
    assert "重新授權" in text and "需要 BigQuery 授權" in summary and not bigquery._linked_cache


def test_bigquery_is_not_offered_as_a_plain_chat_tool(fs):
    from app.routers.chat import my_connector_caps

    fs.put("connectors/bq", {"type": "gateway", "label": "Google BigQuery", "owner_uid": "admin", "share": {"access": "account", "role": "use", "members": []},
                             "config": {"service": "google_bigquery", "auth_mode": "oauth2", "allowed_actions": ["google_bigquery.query", "google_bigquery.start_query_job"]}})
    assert my_connector_caps(BUILDER) == []
