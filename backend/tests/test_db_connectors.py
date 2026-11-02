import json

import pytest

from app.engine import db_sql

from .conftest import ADMIN, BUILDER, BUILDER2, PLAIN


@pytest.fixture
def secrets(monkeypatch):
    store = {}

    def put(cid, field, value):
        name = f"projects/p/secrets/{cid}-{field}"
        store[name] = value
        return name

    monkeypatch.setattr("app.routers.db_connectors.sm.put", put)
    monkeypatch.setattr("app.routers.db_connectors.sm.delete", lambda n: store.pop(n, None))
    return store


def body(**kw):
    b = {"name": "藥局資料庫", "kind": "postgres", "connection": {"host": "10.0.0.5", "port": "5432", "database": "pharm"},
         "sources": [{"id": "ro_pharm", "label": "藥劑部唯讀", "user": "ro_pharm", "password": "s3cret"},
                     {"id": "ro_nurse", "label": "護理部唯讀", "user": "ro_nurse", "password": "s3cret2"}],
         "queries": [{"id": "stock", "name": "藥品庫存", "statement": "SELECT name, qty FROM v_stock WHERE code = $1",
                      "parameters": [{"name": "code", "type": "string", "description": "藥品代碼"}]}],
         "views": [{"id": "v1", "name": "public.v_stock", "columns": [{"name": "name"}, {"name": "qty"}, {"name": "patient_id", "sensitive": True}]}],
         "rules": [], **kw}
    return b


def groups(fs):
    fs.put("groups/g_pharm", {"name": "藥劑部", "member_emails": [BUILDER.email]})
    fs.put("groups/g_nurse", {"name": "護理部", "member_emails": [BUILDER2.email, BUILDER.email]})


def test_only_admins_manage_and_passwords_never_come_back(fs, as_user, secrets, audit_log):
    groups(fs)
    for u in (BUILDER, PLAIN):
        assert as_user(u).post("/api/db-connectors", json=body()).status_code == 403
        assert as_user(u).get("/api/db-connectors").status_code == 403
    c = as_user(ADMIN)
    r = c.post("/api/db-connectors", json=body(rules=[{"group_id": "g_pharm", "source_id": "ro_pharm", "queries": ["stock"], "views": ["v1"]}]))
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["sources"][0] == {"id": "ro_pharm", "label": "藥劑部唯讀", "user": "ro_pharm", "password_set": True}
    assert "s3cret" not in json.dumps(out) and "s3cret" not in json.dumps(fs.store, default=str)  # only the Secret Manager NAME is stored
    assert len(secrets) == 2
    # update without passwords keeps the stored secrets; removing a source deletes its secret
    b = body(sources=[{"id": "ro_pharm", "label": "藥劑部唯讀", "user": "ro_pharm"}])
    assert c.put(f"/api/db-connectors/{out['id']}", json=b).status_code == 200
    assert len(secrets) == 1
    assert c.put(f"/api/db-connectors/{out['id']}", json=body(kind="mysql", connection={"host": "h", "port": "3306", "database": "d"})).status_code == 422
    assert c.delete(f"/api/db-connectors/{out['id']}").status_code == 204 and not secrets
    assert {"db_connector.create", "db_connector.update", "db_connector.delete"} <= {a["action"] for a in audit_log()}


def test_first_matching_group_rule_wins_and_no_match_is_denied(fs, as_user, secrets):
    groups(fs)
    c = as_user(ADMIN)
    rules = [{"group_id": "g_nurse", "source_id": "ro_nurse", "queries": [], "views": ["v1"]},
             {"group_id": "g_pharm", "source_id": "ro_pharm", "queries": ["stock"], "views": ["v1"]}]
    cid = c.post("/api/db-connectors", json=body(rules=rules)).json()["id"]
    # BUILDER is in both groups: the FIRST rule (nurse) applies, so no stock query
    mine = as_user(BUILDER).get("/api/db-connectors/mine").json()
    assert len(mine) == 1 and mine[0]["rule"] == 0 and mine[0]["source_label"] == "護理部唯讀" and mine[0]["queries"] == []
    # BUILDER2 is only a nurse; PLAIN and the ADMIN are in no group: denied (no admin shortcut)
    assert as_user(BUILDER2).get("/api/db-connectors/mine").json()[0]["source_label"] == "護理部唯讀"
    assert as_user(PLAIN).get("/api/db-connectors/mine").json() == []
    assert as_user(ADMIN).get("/api/db-connectors/mine").json() == []
    # the admin test tool shows what an e-mail would get
    r = c.post(f"/api/db-connectors/{cid}/resolve", json={"email": BUILDER.email}).json()
    assert r["matched"] and r["rule"] == 0
    assert c.post(f"/api/db-connectors/{cid}/resolve", json={"email": "nobody@x.org"}).json() == {"email": "nobody@x.org", "matched": False}
    # reordering changes who wins
    rules.reverse()
    c.put(f"/api/db-connectors/{cid}", json=body(rules=rules))
    got = as_user(BUILDER).get("/api/db-connectors/mine").json()[0]
    assert got["source_label"] == "藥劑部唯讀" and [q["id"] for q in got["queries"]] == ["stock"]


def test_users_never_see_sql_or_sensitive_columns(fs, as_user, secrets):
    groups(fs)
    as_user(ADMIN).post("/api/db-connectors", json=body(rules=[{"group_id": "g_pharm", "source_id": "ro_pharm", "queries": ["stock"], "views": ["v1"]}]))
    raw = json.dumps(as_user(BUILDER).get("/api/db-connectors/mine").json(), ensure_ascii=False)
    assert "SELECT" not in raw and "patient_id" not in raw and "qty" in raw and "藥劑部唯讀" in raw and "ro_pharm" not in raw
    assert '"user"' not in raw


@pytest.mark.parametrize("patch,why", [
    ({"connection": {"host": "h"}}, "missing"),
    ({"rules": [{"group_id": "g_pharm", "source_id": "nope"}]}, "unknown source"),
    ({"rules": [{"group_id": "g_pharm", "source_id": "ro_pharm", "queries": ["zz"]}]}, "unknown query"),
    ({"rules": [{"group_id": "g_pharm", "source_id": "ro_pharm", "views": ["zz"]}]}, "unknown view"),
    ({"rules": [{"group_id": "no_such_group", "source_id": "ro_pharm"}]}, "not found"),
    ({"sources": [{"id": "a", "label": "x", "user": "u"}]}, "needs a password"),
    ({"queries": [{"id": "q", "name": "x", "statement": "DELETE FROM t"}]}, "SELECT"),
    ({"queries": [{"id": "q", "name": "x", "statement": "SELECT 1; DROP TABLE t"}]}, "一個陳述式"),
    ({"queries": [{"id": "q", "name": "x", "statement": "SELECT * FROM t WHERE a = {{.x}}"}]}, "template"),
    ({"queries": [{"id": "q", "name": "x", "statement": "SELECT * FROM t WHERE a = $1 AND b = $2", "parameters": [{"name": "a"}]}]}, "佔位"),
    ({"queries": [{"id": "q", "name": "x", "statement": "SELECT * FROM t WHERE a = 1", "parameters": [{"name": "a"}]}]}, "佔位"),
])
def test_invalid_definitions_are_refused(fs, as_user, secrets, patch, why):
    groups(fs)
    r = as_user(ADMIN).post("/api/db-connectors", json=body(**patch))
    assert r.status_code == 422 and why in r.text, r.text
    assert not secrets  # nothing stored on a refused request


def test_bigquery_has_no_logins_and_mysql_placeholders(fs, as_user, secrets):
    groups(fs)
    c = as_user(ADMIN)
    bq = {"name": "BQ", "kind": "bigquery", "connection": {"project": "p1", "location": "asia-east1"}, "sources": [],
          "queries": [], "views": [], "rules": [{"group_id": "g_pharm"}]}
    assert c.post("/api/db-connectors", json=bq).status_code == 201
    assert c.post("/api/db-connectors", json={**bq, "sources": [{"id": "a", "label": "x", "user": "u", "password": "p"}]}).status_code == 422
    assert c.post("/api/db-connectors", json={**bq, "rules": [{"group_id": "g_pharm", "source_id": "x"}]}).status_code == 422
    my = body(kind="mysql", connection={"host": "h", "port": "3306", "database": "d"},
              queries=[{"id": "q", "name": "x", "statement": "SELECT a FROM t WHERE b = ? AND c = ?", "parameters": [{"name": "b"}, {"name": "c"}]}])
    assert c.post("/api/db-connectors", json=my).status_code == 201


def test_sql_check_ignores_keywords_inside_literals_and_comments():
    assert db_sql.check_query("SELECT 'drop table' AS t, 1 -- delete\n FROM x", "mysql", 0) == ""
    assert db_sql.check_query("WITH a AS (SELECT 1) SELECT * FROM a", "postgres", 0) == ""
    assert "INTO" in db_sql.check_query("SELECT * INTO new_t FROM t", "postgres", 0).upper()
    assert db_sql.check_query("SELECT pg_sleep(10)", "postgres", 0)
