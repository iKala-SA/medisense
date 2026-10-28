from .conftest import BUILDER, BUILDER2
from .test_sessions import seed


def test_project_crud_is_own_only_and_delete_keeps_chats(fs, as_user, audit_log):
    c = as_user(BUILDER)
    p = c.post("/api/projects", json={"name": "  心臟科   病例 "}).json()
    assert p["name"] == "心臟科 病例"
    other = as_user(BUILDER2).post("/api/projects", json={"name": "別人的"}).json()
    assert [x["id"] for x in c.get("/api/projects").json()] == [p["id"]]
    assert c.patch(f"/api/projects/{other['id']}", json={"name": "x"}).status_code == 404
    assert c.delete(f"/api/projects/{other['id']}").status_code == 404
    assert c.post("/api/projects", json={"name": "   "}).status_code == 422
    assert c.patch(f"/api/projects/{p['id']}", json={"name": "新名稱"}).json()["name"] == "新名稱"

    seed(fs, "s1", BUILDER.uid, 2, 1, title="in", project_id=p["id"])
    assert c.delete(f"/api/projects/{p['id']}").status_code == 204
    assert f"projects/{p['id']}" not in fs.store and fs.store["sessions/s1"]["project_id"] == ""  # chat survives
    assert {"project.create", "project.update", "project.delete"} <= {a["action"] for a in audit_log()}


def test_move_session_to_project(fs, as_user):
    seed(fs, "s1", BUILDER.uid, 2, 1, title="t")
    c = as_user(BUILDER)
    p = c.post("/api/projects", json={"name": "P"}).json()
    other = as_user(BUILDER2).post("/api/projects", json={"name": "Q"}).json()
    assert c.patch("/api/sessions/s1", json={"project_id": p["id"]}).json()["project_id"] == p["id"]
    assert c.patch("/api/sessions/s1", json={"project_id": other["id"]}).status_code == 404  # not yours
    assert c.get("/api/sessions").json()["items"][0]["project_id"] == p["id"]
    assert c.patch("/api/sessions/s1", json={"project_id": ""}).json()["project_id"] == ""
    assert c.patch("/api/sessions/s1", json={}).status_code == 422
    assert c.patch("/api/sessions/s1", json={"title": "新"}).json()["title"] == "新"


def test_chat_can_start_inside_a_project(fs, as_user, monkeypatch):
    from app.engine import llm

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", lambda **kw: llm.Completion("ok", "gemini-3-flash", 1, 1, 0.0, 1))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    c = as_user(BUILDER)
    p = c.post("/api/projects", json={"name": "P"}).json()
    other = as_user(BUILDER2).post("/api/projects", json={"name": "Q"}).json()
    assert c.post("/api/chat", json={"message": "hi", "project_id": other["id"]}).status_code == 404  # not your project
    r = c.post("/api/chat", json={"message": "hi", "project_id": p["id"]}).json()
    assert fs.store[f"sessions/{r['session_id']}"]["project_id"] == p["id"]
    c.post("/api/chat", json={"message": "again", "session_id": r["session_id"], "project_id": ""})
    assert fs.store[f"sessions/{r['session_id']}"]["project_id"] == p["id"]  # later turns do not move it


def test_pin_lock_archive(fs, as_user):
    from app.engine import llm

    seed(fs, "s1", BUILDER.uid, 2, 1, title="t")
    c = as_user(BUILDER)
    r = c.patch("/api/sessions/s1", json={"pinned": True, "archived": True}).json()
    assert r["pinned"] and r["archived"] and not r["locked"]
    assert c.patch("/api/sessions/s1", json={"archived": False}).json()["archived"] is False
    assert c.patch("/api/sessions/s1", json={"locked": True}).json()["locked"]
    # locked: no rename / move / archive / delete / new messages; pinning and unlocking still work
    assert c.patch("/api/sessions/s1", json={"title": "x"}).status_code == 409
    assert c.patch("/api/sessions/s1", json={"archived": True}).status_code == 409
    assert c.delete("/api/sessions/s1").status_code == 409 and "sessions/s1" in fs.store
    assert c.post("/api/chat", json={"message": "hi", "session_id": "s1"}).status_code == 409
    assert c.patch("/api/sessions/s1", json={"pinned": False}).status_code == 200
    assert c.patch("/api/sessions/s1", json={"locked": False}).json()["locked"] is False
    assert c.delete("/api/sessions/s1").status_code == 204
