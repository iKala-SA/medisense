from datetime import UTC, datetime, timedelta

from .conftest import ADMIN, BUILDER, BUILDER2


def seed(fs, sid, uid, n, mins, **extra):
    fs.put(f"sessions/{sid}", {"uid": uid, "agent_id": "a1", "messages": [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"msg {i} " + "x" * 40} for i in range(n)],
        "updated_at": datetime(2026, 11, 1, tzinfo=UTC) + timedelta(minutes=mins), **extra})


def test_list_own_only_newest_first_with_paging(fs, as_user):
    seed(fs, "s1", BUILDER.uid, 2, 1, title="first")
    seed(fs, "s2", BUILDER.uid, 4, 2)
    seed(fs, "s3", BUILDER.uid, 2, 3, title="third")
    seed(fs, "other", BUILDER2.uid, 2, 9, title="secret")
    c = as_user(BUILDER)
    page = c.get("/api/sessions", params={"limit": 2}).json()
    assert [i["id"] for i in page["items"]] == ["s3", "s2"] and page["next_cursor"]
    assert page["items"][1]["title"].startswith("msg 0") and len(page["items"][1]["title"]) <= 30  # legacy fallback
    assert page["items"][1]["message_count"] == 4 and page["items"][0]["agent_id"] == "a1"
    nxt = c.get("/api/sessions", params={"limit": 2, "cursor": page["next_cursor"]}).json()
    assert [i["id"] for i in nxt["items"]] == ["s1"] and nxt["next_cursor"] is None


def test_get_rename_delete_are_own_only(fs, as_user, audit_log):
    seed(fs, "mine", BUILDER.uid, 2, 1, title="t")
    seed(fs, "theirs", BUILDER2.uid, 2, 2, title="t")
    c = as_user(BUILDER)
    d = c.get("/api/sessions/mine").json()
    assert [m["role"] for m in d["messages"]] == ["user", "assistant"]
    for sid in ("theirs", "nope"):
        assert c.get(f"/api/sessions/{sid}").status_code == 404
        assert c.patch(f"/api/sessions/{sid}", json={"title": "x"}).status_code == 404
        assert c.delete(f"/api/sessions/{sid}").status_code == 404
    assert as_user(ADMIN).get("/api/sessions/mine").status_code == 404  # not even admins
    assert c.patch("/api/sessions/mine", json={"title": "  New   name "}).json()["title"] == "New name"
    assert c.patch("/api/sessions/mine", json={"title": ""}).status_code == 422
    assert c.delete("/api/sessions/mine").status_code == 204
    assert "sessions/mine" not in fs.store and "sessions/theirs" in fs.store
    assert {"session.update", "session.delete"} <= {a["action"] for a in audit_log()}


def test_run_sets_title_from_deidentified_message(fs, as_user, monkeypatch):
    from app.engine import llm

    fs.put("agents/a1", {"name": "A", "owner_uid": BUILDER.uid, "status": "published", "version": 1})
    fs.put("agents/a1/versions/1", {"name": "A"})
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("王小明", "[PERSON]"))
    monkeypatch.setattr(llm, "complete", lambda **kw: llm.Completion("答", "gemini-3-flash", 1, 1, 0.0, 1))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    c = as_user(BUILDER)
    r = c.post("/api/agents/a1/run", json={"message": "王小明 的血壓偏高，請問建議的追蹤頻率與用藥調整方式是什麼"}).json()
    title = fs.store[f"sessions/{r['session_id']}"]["title"]
    assert "王小明" not in title and title.startswith("[PERSON]") and len(title) == 30
    c.post("/api/agents/a1/run", json={"message": "second", "session_id": r["session_id"]})
    assert fs.store[f"sessions/{r['session_id']}"]["title"] == title  # only the first run titles


def test_chat_default_agent_audit_and_attachment_limit(fs, as_user, monkeypatch, audit_log):
    from app.engine import llm

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return llm.Completion("hello", "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    c = as_user(BUILDER)
    r = c.post("/api/chat", json={"message": "hi there"}).json()
    assert r["reply"] == "hello" and fs.store[f"sessions/{r['session_id']}"]["title"] == "hi there"
    assert seen["group"] == "fast"  # auto -> default routing (simple) -> fast
    assert any(a["action"] == "chat.run" for a in audit_log())
    assert as_user(BUILDER2).post("/api/chat", json={"message": "x", "session_id": r["session_id"]}).status_code == 403
    # attachment text is added to the system prompt, never to the stored messages
    fs.store[f"sessions/{r['session_id']}"]["attachments"] = [{"id": "a", "name": "lab.txt", "text": "ALT 40", "chars": 6}]
    c.post("/api/chat", json={"message": "summarise", "session_id": r["session_id"]})
    assert "ALT 40" in seen["system"]
    assert all("ALT 40" not in m["content"] for m in fs.store[f"sessions/{r['session_id']}"]["messages"])


def test_chat_attachment_upload(fs, as_user, monkeypatch):
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("A123456789", "[ID]"))
    c = as_user(BUILDER)
    r = c.post("/api/chat/attachments", files={"file": ("note.txt", "病人 A123456789 肝功能 ALT 40".encode())})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "[ID]" in j["snippet"] and "A123456789" not in j["snippet"]
    assert fs.store[f"sessions/{j['session_id']}"]["attachments"][0]["name"] == "note.txt"
    assert c.post("/api/chat/attachments", files={"file": ("x.exe", b"MZ")}).status_code == 415
    assert as_user(BUILDER2).post("/api/chat/attachments", data={"session_id": j["session_id"]},
                                  files={"file": ("n.txt", b"hello")}).status_code == 403


def test_calendar_status(fs, as_user):
    # No calendar connector exists yet: an honest "not connected" with the reason (full flow: tests/test_open_connector.py).
    r = as_user(BUILDER).get("/api/calendar/status").json()
    assert r["connected"] is False and r["connector_id"] is None and r["reason"]
