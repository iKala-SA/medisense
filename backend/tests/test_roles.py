from fastapi.testclient import TestClient

from app.main import app


def test_list_roles_returns_mock_data_without_firestore(monkeypatch):
    # The mock endpoint must not touch Firestore or the token; fail loudly if it does.
    monkeypatch.setattr("app.db.client", lambda: (_ for _ in ()).throw(AssertionError("no Firestore in mock mode")))
    body = TestClient(app).get("/api/roles").json()
    assert [r["id"] for r in body["roles"]] == ["admin", "builder", "user", "ai-reviewer", "trainer"]
    assert body["stats"] == {"total_roles": 5, "system_roles": 3, "custom_roles": 2, "assigned_users": 7}
    by_id = {r["id"]: r for r in body["roles"]}
    assert by_id["admin"]["permission_count"] == 4  # label count, as the frontend shows
    assert by_id["builder"]["can"] == ["Agent Studio", "申請發布", "連接器", "知識庫上傳"]
    assert by_id["ai-reviewer"]["can"] == [] and by_id["ai-reviewer"]["suspended"] is True


def test_filter_by_type_and_search():
    c = TestClient(app)
    assert [r["id"] for r in c.get("/api/roles", params={"type": "custom"}).json()["roles"]] == ["ai-reviewer", "trainer"]
    assert [r["id"] for r in c.get("/api/roles", params={"type": "system"}).json()["roles"]] == ["admin", "builder", "user"]
    assert [r["id"] for r in c.get("/api/roles", params={"search": "  審核 "}).json()["roles"]] == ["ai-reviewer"]
    assert c.get("/api/roles", params={"type": "bogus"}).status_code == 422
