import yaml
import pytest

from app.engine import toolbox_config as tc

from .test_db_connectors import ADMIN, BUILDER, body, groups, secrets  # noqa: F401  (fixtures)


def conn(kind="postgres", **kw):
    c = {"id": "c1", "name": "藥局", "kind": kind, "connection": {"host": "10.0.0.5", "port": "5432", "database": "pharm"}, "max_rows": 100,
         "sources": [{"id": "ro", "label": "唯讀", "user": "ro_user", "password_secret": "projects/p/secrets/c1-src-ro-password"},
                     {"id": "rn", "label": "護理", "user": "rn_user", "password_secret": "projects/p/secrets/c1-src-rn-password"}],
         "queries": [{"id": "stock", "name": "庫存", "description": "查庫存", "statement": "SELECT name FROM v WHERE code = $1",
                      "parameters": [{"name": "code", "type": "string", "description": "代碼"}]}],
         "views": [{"id": "v1", "name": "public.v", "columns": [{"name": "name"}]}],
         "rules": [{"group_id": "g", "source_id": "ro", "queries": ["stock"], "views": ["v1"]}, {"group_id": "h", "source_id": "rn", "queries": [], "views": ["v1"]}]}
    c.update(kw)
    return c


def docs(cs):
    return list(yaml.safe_load_all(tc.render(cs)))


def test_sources_tools_and_secrets_for_postgres():
    d = docs([conn()])
    by = {(x["kind"], x["name"]): x for x in d}
    s = by[("source", "c1__ro")]
    # logins are numbered in id order (rn, ro), so the numbering is stable between renders
    assert s["type"] == "postgres" and s["user"] == "ro_user" and s["password"] == "${DBPW_2}" and s["port"] == "5432"
    assert by[("source", "c1__rn")]["password"] == "${DBPW_1}"
    t = by[("tool", "c1__ro__stock")]
    assert t["type"] == "postgres-sql" and t["source"] == "c1__ro" and t["parameters"][0] == {"name": "code", "type": "string", "description": "代碼", "required": True}
    assert by[("tool", "c1__ro__sql")]["type"] == "postgres-execute-sql" and by[("tool", "c1__rn__sql")]["type"] == "postgres-execute-sql"
    assert ("tool", "c1__rn__stock") not in by  # the nurse rule grants no predefined query
    assert tc.required_secrets([conn()]) == [{"env": "DBPW_1", "secret": "c1-src-rn-password"}, {"env": "DBPW_2", "secret": "c1-src-ro-password"}]


def test_no_secret_value_and_only_granted_things_are_rendered():
    c = conn(rules=[{"group_id": "g", "source_id": "ro", "queries": ["stock"], "views": []}])
    d = docs([c])
    assert [x["name"] for x in d] == ["c1__ro", "c1__ro__stock"]  # no rn source, no execute-sql tool
    assert tc.render([conn(rules=[])]) == "" and tc.problems([conn(rules=[])])


def test_engine_specific_types():
    mysql = docs([conn("mysql")])
    ty = lambda ds: {(x["kind"], x["name"]): x for x in ds}  # noqa: E731
    m = ty(mysql)
    assert m[("source", "c1__ro")]["type"] == "mysql" and m[("source", "c1__ro")]["queryTimeout"] == "30s" and m[("tool", "c1__ro__stock")]["type"] == "mysql-sql"
    ms = ty(docs([conn("mssql")]))
    assert ms[("source", "c1__ro")]["type"] == "mssql" and "queryTimeout" not in ms[("source", "c1__ro")] and ms[("tool", "c1__ro__sql")]["type"] == "mssql-execute-sql"
    cs = ty(docs([conn("cloud_sql_mssql", connection={"project": "p", "region": "asia-east1", "instance": "i", "database": "d", "ip_type": "private"})]))
    s = cs[("source", "c1__ro")]
    assert s["type"] == "cloud-sql-mssql" and s["instance"] == "i" and s["ipType"] == "private" and cs[("tool", "c1__ro__stock")]["type"] == "mssql-sql"


def test_bigquery_runs_as_the_user_and_is_read_only():
    bq = conn("bigquery", connection={"project": "p1", "location": "asia-east1", "datasets": "a, b"}, sources=[], max_rows=50,
              queries=[], rules=[{"group_id": "g", "source_id": "", "queries": [], "views": ["v1"]}])
    s, t = docs([bq])
    assert s["type"] == "bigquery" and s["writeMode"] == "blocked" and s["useClientOAuth"] == "X-BigQuery-Auth"
    assert s["allowedDatasets"] == ["a", "b"] and s["maxQueryResultRows"] == 50 and "password" not in s and "user" not in s
    assert t["name"] == "c1__bq__sql" and t["type"] == "bigquery-execute-sql"
    assert tc.required_secrets([bq]) == [] and tc.problems([bq]) == []


def test_missing_password_is_reported():
    c = conn(sources=[{"id": "ro", "label": "x", "user": "u"}, {"id": "rn", "label": "y", "user": "u", "password_secret": "p/s/x"}])
    assert any("ro" in p for p in tc.problems([c]))


def test_apply_flow(fs, as_user, secrets, monkeypatch):  # noqa: F811
    groups(fs)
    sent = []
    monkeypatch.setattr("app.routers.db_connectors.github_actions.dispatch", lambda v, who, workflow=None: sent.append((v, who, workflow)))
    monkeypatch.setattr("app.routers.db_connectors.github_actions.find_run", lambda *a, **k: None)
    monkeypatch.setattr("app.routers.db_connectors.sm.get", lambda name: "pw")
    monkeypatch.setattr("app.routers.db_connectors.db_login.check", lambda *a: (True, "ok"))
    c = as_user(ADMIN)
    assert c.post("/api/db-connectors/apply").status_code == 409  # nothing to apply yet
    cid = c.post("/api/db-connectors", json=body(rules=[{"group_id": "g_pharm", "source_id": "ro_pharm", "queries": ["stock"], "views": ["v1"]}])).json()["id"]
    st = c.get("/api/db-connectors/apply/state").json()
    assert st["pending"] and st["render"]["version"] >= 1 and "${DBPW_1}" in st["render"]["yaml"] and "s3cret" not in st["render"]["yaml"]
    assert as_user(BUILDER).get("/api/db-connectors/apply/state").status_code == 403
    assert as_user(BUILDER).post("/api/db-connectors/apply").status_code == 403
    r = c.post("/api/db-connectors/apply")
    assert r.status_code == 200 and sent == [(st["render"]["version"], ADMIN.email, "toolbox-apply.yml")]
    assert c.post("/api/db-connectors/apply").status_code == 409  # one deploy at a time
    # the workflow finished: connectors saved before the snapshot become applied
    monkeypatch.setattr("app.routers.db_connectors.github_actions.find_run", lambda *a, **k: {"status": "completed", "conclusion": "success", "html_url": "u"})
    s2 = c.get("/api/db-connectors/apply/state").json()
    assert s2["deploy"]["status"] == "deployed" and not s2["pending"]
    assert c.get(f"/api/db-connectors/{cid}").json()["status"] == "applied"
    # editing makes a new version and a draft again
    c.put(f"/api/db-connectors/{cid}", json=body(name="藥局2", rules=[{"group_id": "g_pharm", "source_id": "ro_pharm", "queries": [], "views": ["v1"]}]))
    assert c.get("/api/db-connectors/apply/state").json()["pending"] and c.get(f"/api/db-connectors/{cid}").json()["status"] == "draft"


@pytest.mark.parametrize("kind,conn_,sql,params,ok", [
    ("mssql", {"host": "h", "port": "1433", "database": "d"}, "SELECT a FROM t WHERE b = @b", ["b"], True),
    ("mssql", {"host": "h", "port": "1433", "database": "d"}, "SELECT a FROM t WHERE b = ?", ["b"], False),
    ("mssql", {"host": "h", "port": "1433", "database": "d"}, "SELECT a FROM t WHERE b = @x", ["b"], False),
    ("bigquery", {"project": "p"}, "SELECT a FROM `p.d.t` WHERE b = @b AND c = @c", ["b", "c"], True),
    ("bigquery", {"project": "p"}, "SELECT a FROM `p.d.t` WHERE b = @b", ["b", "c"], False),
    ("postgres", {"host": "h", "port": "5432", "database": "d"}, "SELECT a FROM t WHERE b = '${X}'", [], False),
])
def test_named_placeholders_for_mssql_and_bigquery(fs, as_user, secrets, kind, conn_, sql, params, ok):  # noqa: F811
    groups(fs)
    b = body(kind=kind, connection=conn_, sources=[] if kind == "bigquery" else body()["sources"], rules=[],
             queries=[{"id": "q", "name": "x", "statement": sql, "parameters": [{"name": p} for p in params]}])
    assert (as_user(ADMIN).post("/api/db-connectors", json=b).status_code == 201) is ok


def test_template_syntax_in_text_fields_is_refused(fs, as_user, secrets):  # noqa: F811
    groups(fs)
    assert as_user(ADMIN).post("/api/db-connectors", json=body(description="x ${SECRET} y")).status_code == 422
    assert as_user(ADMIN).post("/api/db-connectors", json=body(name="a {{b}}")).status_code == 422


def test_ssl_option_per_engine():
    on = {"host": "h", "port": "1", "database": "d", "ssl": "true"}
    src = lambda k: docs([conn(k, connection=on)])[0] if False else next(x for x in docs([conn(k, connection=on)]) if x["kind"] == "source")  # noqa: E731
    assert src("postgres")["queryParams"] == {"sslmode": "require"}
    assert src("mysql")["queryParams"] == {"tls": "skip-verify"}
    assert src("mssql")["encrypt"] == "true"
    off = next(x for x in docs([conn(connection={"host": "h", "port": "1", "database": "d"})]) if x["kind"] == "source")
    assert "queryParams" not in off


# ---- real login checks (db_login) -------------------------------------------------------------------------------
def test_apply_is_refused_when_a_login_fails_and_names_it(fs, as_user, secrets, monkeypatch):  # noqa: F811
    groups(fs)
    sent = []
    monkeypatch.setattr("app.routers.db_connectors.github_actions.dispatch", lambda v, who, workflow=None: sent.append(v))
    monkeypatch.setattr("app.routers.db_connectors.github_actions.find_run", lambda *a, **k: None)
    monkeypatch.setattr("app.routers.db_connectors.sm.get", lambda name: "pw")
    c = as_user(ADMIN)
    c.post("/api/db-connectors", json=body(rules=[{"group_id": "g_pharm", "source_id": "ro_pharm", "queries": ["stock"], "views": ["v1"]}]))
    seen = []
    monkeypatch.setattr("app.routers.db_connectors.db_login.check", lambda kind, conn, user, pw: seen.append((kind, user, pw)) or (False, "帳號或密碼錯誤"))
    r = c.post("/api/db-connectors/apply")
    assert r.status_code == 409 and "藥局資料庫" in r.text and "藥劑部唯讀" in r.text and "帳號或密碼錯誤" in r.text
    assert '"pw"' not in r.text and "密碼 pw" not in r.text
    assert seen == [("postgres", "ro_pharm", "pw")] and sent == []  # only the login a rule uses is tried; nothing dispatched
    monkeypatch.setattr("app.routers.db_connectors.db_login.check", lambda *a: (True, "ok"))
    assert c.post("/api/db-connectors/apply").status_code == 200 and len(sent) == 1


def test_verify_button_does_a_real_login_when_given_credentials(fs, as_user, monkeypatch):
    calls = []
    monkeypatch.setattr("app.routers.db_connectors.db_login.check", lambda k, c, u, p: calls.append((k, u)) or (True, "登入成功"))
    c = as_user(ADMIN)
    conn = {"host": "h", "port": "5432", "database": "d"}
    assert c.post("/api/db-connectors/test-connection", json={"kind": "postgres", "connection": conn, "user": "u", "password": "p"}).json() == {"ok": True, "message": "登入成功"}
    assert calls == [("postgres", "u")]
    assert c.post("/api/db-connectors/test-connection", json={"kind": "cloud_sql_postgres", "connection": conn, "user": "u", "password": "p"}).json()["ok"] is None
    assert as_user(BUILDER).post("/api/db-connectors/test-connection", json={}).status_code == 403


def test_login_failure_messages_never_contain_the_password():
    from app.engine import db_login
    ok, msg = db_login.check("postgres", {"host": "127.0.0.1", "port": "1", "database": "d"}, "u", "TOPSECRET")
    assert not ok and "TOPSECRET" not in msg
