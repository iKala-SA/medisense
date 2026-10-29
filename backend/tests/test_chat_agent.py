from app.engine import llm

from .conftest import BUILDER, BUILDER2


def _agent(fs, **extra):
    fs.put("agents/a1", {"name": "藥劑部助理", "description": "查詢院內藥品資訊", "owner_uid": BUILDER2.uid, "status": "published", "version": 1, **extra})
    fs.put("agents/a1/versions/1", {"name": "藥劑部助理", "description": "查詢院內藥品資訊", "instructions": "你是藥劑部助理。",
                                    "knowledge_doc_ids": [], "flow": {"nodes": [
                                        {"id": "t1", "type": "tool", "data": {"connector_id": "c1", "action": "send"}},
                                        {"id": "t2", "type": "tool", "data": {"connector_id": "gone", "action": "send"}}], "edges": []}})
    fs.put("connectors/c1", {"name": "護理站 Webhook", "type": "webhook"})


def test_profile_lists_only_the_agents_own_connectors(fs, as_user):
    _agent(fs)
    r = as_user(BUILDER).get("/api/chat/agents/a1").json()
    assert r["name"] == "藥劑部助理" and r["description"] == "查詢院內藥品資訊"
    assert [c["id"] for c in r["connectors"]] == ["c1"]  # the connector that no longer exists is not offered
    assert as_user(BUILDER).get("/api/chat/agents/nope").status_code == 404


def test_a_picked_agent_ignores_wider_scope_and_web_search(fs, as_user, monkeypatch):
    _agent(fs)
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return llm.Completion("ok", "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr("app.engine.features.web_search_enabled", lambda: True)
    called = {}
    monkeypatch.setattr("app.routers.chat._all_visible_doc_ids", lambda *a, **k: called.setdefault("all", ["x"]))
    c = as_user(BUILDER)
    r = c.post("/api/chat", json={"message": "hi", "agent_id": "a1", "knowledge_scope": "all", "web_search": True})
    assert r.status_code == 200, r.text
    assert "all" not in called  # "所有資料" does not widen a picked agent
    names = [t["function"]["name"] for t in (seen.get("tools") or [])]
    assert "web_search" not in names and "search_knowledge" not in names and any(n.startswith("webhook_") for n in names)
    assert "你是藥劑部助理" in seen["system"]


def test_capabilities_drive_web_search_connectors_and_spaces(fs, as_user, monkeypatch):
    fs.put("agents/a2", {"name": "能力", "owner_uid": BUILDER2.uid, "status": "published", "version": 1})
    fs.put("agents/a2/versions/1", {"name": "能力", "instructions": "x", "knowledge_doc_ids": [], "flow": {"nodes": [], "edges": []},
                                    "capabilities": {"web_search": True, "spaces": ["sp1", "nope"], "connectors": [{"connector_id": "c1", "action": "send", "require_approval": False}]}})
    fs.put("connectors/c1", {"name": "Hook", "type": "webhook"})
    fs.put("spaces/sp1", {"name": "S", "type": "org", "document_ids": ["d1", "d2"]})
    fs.put("documents/d1", {"status": "indexed", "rag_file": "projects/p/ragFiles/F1"})
    fs.put("documents/d2", {"status": "indexed", "rag_file": "projects/p/ragFiles/F2", "share": {"visibility": "private"}, "uploaded_uid": "someone-else"})
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return llm.Completion("ok", "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr("app.engine.features.web_search_enabled", lambda: True)
    r = as_user(BUILDER).post("/api/chat", json={"message": "hi", "agent_id": "a2", "web_search": False})
    assert r.status_code == 200, r.text
    names = [t["function"]["name"] for t in seen["tools"]]
    assert "web_search" in names and "search_knowledge" in names and any(n.startswith("webhook_") for n in names)
