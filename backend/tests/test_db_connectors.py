"""Database connectors (MVP): admin CRUD, one login per connection, write-only password, BigQuery without an account."""
import pytest

from .conftest import ADMIN, BUILDER, PLAIN


@pytest.fixture
def secrets(monkeypatch):
    store = {}

    def put(cid, field, value):
        name = f"projects/p/secrets/{cid}-{field}"
        store[name] = value
        return name

    monkeypatch.setattr("app.routers.db_connectors.sm.put", put)
    monkeypatch.setattr("app.routers.db_connectors.sm.delete", lambda n: store.pop(n, None))
    monkeypatch.setattr("app.engine.secrets.get", lambda n: store[n])
    return store


def body(**kw):
    return {"name": "藥局資料庫", "kind": "postgres", "description": "藥品庫存與領藥紀錄",
            "connection": {"host": "10.0.0.5", "port": "5432", "database": "pharm"}, "user": "ro_pharm", "password": "s3cret", **kw}


BQ = {"name": "門診統計", "kind": "bigquery", "connection": {"project": "medisense-ai-portal-project", "location": "asia-east1", "datasets": "esther_dataset"}}


def test_only_admins_manage_and_the_password_never_comes_back(fs, as_user, secrets, audit_log):
    assert as_user(BUILDER).post("/api/db-connectors", json=body()).status_code == 403
    r = as_user(ADMIN).post("/api/db-connectors", json=body())
    assert r.status_code == 201
    c = r.json()
    assert c["user"] == "ro_pharm" and c["password_set"] and "s3cret" not in r.text and "password" not in c
    assert list(secrets.values()) == ["s3cret"]
    # update without a password keeps the stored one; with one replaces it
    r = as_user(ADMIN).put(f"/api/db-connectors/{c['id']}", json={**body(), "password": None, "name": "藥局"})
    assert r.status_code == 200 and r.json()["password_set"] and list(secrets.values()) == ["s3cret"]
    as_user(ADMIN).put(f"/api/db-connectors/{c['id']}", json=body(password="n3w"))
    assert list(secrets.values()) == ["n3w"]
    assert as_user(ADMIN).put(f"/api/db-connectors/{c['id']}", json=body(kind="mysql")).status_code == 422  # kind is fixed
    assert as_user(ADMIN).get("/api/db-connectors").json()[0]["name"] == "藥局資料庫"
    assert as_user(ADMIN).delete(f"/api/db-connectors/{c['id']}").status_code == 204
    assert secrets == {}
    assert [a["action"] for a in audit_log() if a["action"].startswith("db_connector.")] == \
        ["db_connector.create", "db_connector.update", "db_connector.update", "db_connector.delete"]


@pytest.mark.parametrize("patch", [
    {"password": None},  # a new connection needs a password
    {"user": ""},
    {"connection": {"host": "h", "port": "x", "database": "d"}},
    {"connection": {"host": "h", "port": "5432"}},
    {"kind": "oracle"},
])
def test_invalid_connections_are_refused(fs, as_user, secrets, patch):
    assert as_user(ADMIN).post("/api/db-connectors", json=body(**patch)).status_code == 422


def test_bigquery_takes_project_region_dataset_and_no_account(fs, as_user, secrets):
    c = as_user(ADMIN)
    r = c.post("/api/db-connectors", json=BQ)
    assert r.status_code == 201 and r.json()["connection"]["datasets"] == "esther_dataset" and not r.json()["password_set"]
    assert secrets == {}
    assert c.post("/api/db-connectors", json={**BQ, "user": "x", "password": "y"}).status_code == 422
    assert c.post("/api/db-connectors", json={**BQ, "connection": {**BQ["connection"], "datasets": ""}}).status_code == 422
    assert c.post("/api/db-connectors", json={**BQ, "connection": {**BQ["connection"], "datasets": "a`; drop"}}).status_code == 422


def test_catalog_and_mine(fs, as_user, secrets):
    cid = as_user(ADMIN).post("/api/db-connectors", json=body()).json()["id"]
    assert as_user(BUILDER).get("/api/db-connectors/catalog").json() == [{"id": cid, "name": "藥局資料庫", "kind": "postgres"}]
    assert as_user(PLAIN).get("/api/db-connectors/catalog").status_code == 403
    mine = as_user(PLAIN).get("/api/db-connectors/mine").json()
    assert mine == [{"id": cid, "name": "藥局資料庫", "kind": "postgres", "description": "藥品庫存與領藥紀錄"}]
    assert as_user(PLAIN).get(f"/api/db-connectors/{cid}").status_code == 403


def test_test_connection(fs, as_user, secrets, monkeypatch):
    seen = []
    monkeypatch.setattr("app.engine.db_login.check", lambda kind, conn, user, pw: (seen.append((kind, user, pw)), (True, "登入成功"))[1])
    c = as_user(ADMIN)
    r = c.post("/api/db-connectors/test-connection", json={"kind": "postgres", "connection": body()["connection"], "user": "u", "password": "p"})
    assert r.json() == {"ok": True, "message": "登入成功"}
    cid = c.post("/api/db-connectors", json=body()).json()["id"]
    assert c.post(f"/api/db-connectors/{cid}/test").json()["ok"] and seen[-1] == ("postgres", "ro_pharm", "s3cret")  # the stored password
    bq = c.post("/api/db-connectors", json=BQ).json()["id"]
    assert c.post(f"/api/db-connectors/{bq}/test").json()["ok"] is None  # needs the admin's own BigQuery authorisation
    monkeypatch.setattr("app.engine.bigquery.schema", lambda conn, match="", **k: "- esther_dataset.t：a(string)\n- esther_dataset.u：b(int64)")
    r = c.post(f"/api/db-connectors/{bq}/test", headers={"X-BigQuery-Auth": "Bearer t"})
    assert r.json() == {"ok": True, "message": "連線成功：你的帳號可以看到 2 個資料表"}
