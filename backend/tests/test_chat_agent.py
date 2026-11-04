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
    assert "一定要先呼叫 search_knowledge" in seen["system"]  # an agent built on its spaces searches them first, not only "when needed"


def test_the_person_chatting_confirms_a_connector_write_in_place(fs, as_user, monkeypatch, audit_log):
    """A published agent with a 需核准 calendar write: the first turn pauses, the user confirms through /api/chat/approve,
    the action runs as that user and the conversation continues. Someone else's session, or a pause meant for the
    owner, is refused."""
    from app.engine import agent as rt

    fs.put("agents/a3", {"name": "行事曆助理", "owner_uid": BUILDER2.uid, "status": "published", "version": 1})
    fs.put("agents/a3/versions/1", {"name": "行事曆助理", "instructions": "x", "knowledge_doc_ids": [], "flow": {"nodes": [], "edges": []},
                                    "capabilities": {"connectors": [{"connector_id": "cal1", "action": "quick_add_event", "require_approval": True}]}})
    fs.put("connectors/cal1", {"type": "calendar", "label": "Google Calendar", "config": {"write_actions": ["quick_add_event"]}})
    turns = [[{"id": "c1", "name": "calendar_cap0", "arguments": '{"reason": "排會議", "text": "明天 15:00 心臟科討論"}'}], "已幫您建立"]

    def fake(**kw):
        t = turns.pop(0)
        return llm.Completion("" if isinstance(t, list) else t, "gemini-3-flash", 1, 1, 0.0, 1, tool_calls=tuple(t) if isinstance(t, list) else ())

    ran = []
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr(rt, "invoke_connector", lambda cid, action, args, **k: ran.append((cid, action, args, k["user_id"])) or ("已建立 e1", "Google Calendar · quick_add_event · 成功"))
    me = as_user(BUILDER)
    r = me.post("/api/chat", json={"message": "幫我排明天三點的會", "agent_id": "a3"}).json()
    sid, pending = r["session_id"], r["pending_approval"]
    assert pending["approver"] == "user" and "快速建立事件" in pending["preview"] and not ran
    assert me.get(f"/api/sessions/{sid}").json()["pending_approval"]["approver"] == "user"  # a reopened chat can still decide
    assert as_user(BUILDER2).post("/api/chat/approve", json={"session_id": sid, "approve": True}).status_code == 404  # not their conversation
    r2 = me.post("/api/chat/approve", json={"session_id": sid, "approve": True})
    assert r2.status_code == 200, r2.text
    assert r2.json()["reply"] == "已幫您建立" and r2.json()["pending_approval"] is None and r2.json()["message_index"] == 2  # user, paused reply, outcome
    assert ran == [("cal1", "quick_add_event", {"text": "明天 15:00 心臟科討論"}, BUILDER.uid)]
    assert [t["type"] for t in r2.json()["trace"]] == ["approval", "tool", "llm"]
    assert me.post("/api/chat/approve", json={"session_id": sid, "approve": True}).status_code == 409  # nothing left to decide
    assert any(a["action"] == "agent.approve" and a.get("by_user") for a in audit_log())
    # a pause raised by a canvas approval node is the owner's call, not the user's
    sess = fs.store[f"sessions/{sid}"]
    sess["pending"] = {**(sess.get("pending") or {}), "node_id": "ap", "message": "核准？", "preview": "p", "approver": "owner", "agent_id": "a3", "call": {"id": "c9", "name": "x", "args": {}}, "messages": [], "input": "x"}
    assert me.post("/api/chat/approve", json={"session_id": sid, "approve": False}).status_code == 403
    owner = as_user(BUILDER2).post("/api/agents/a3/approve", json={"session_id": sid, "approve": False})  # the owner decides owner-level pauses
    assert owner.status_code == 200 and owner.json()["reply"] == "已拒絕此步驟，流程停止。"


def test_chat_runs_in_production_so_connector_writes_are_real_not_simulated(fs, as_user, monkeypatch, audit_log):
    """Regression: chat never passed use_published, so every turn ran in the sandbox: writes were only simulated and the
    session was filed as a sandbox run (hidden from 最近項目)."""
    from app.engine import runenv

    fs.put("agents/a4", {"name": "Hook", "owner_uid": BUILDER2.uid, "status": "published", "version": 1})
    fs.put("agents/a4/versions/1", {"name": "Hook", "instructions": "x", "knowledge_doc_ids": [], "flow": {"nodes": [], "edges": []},
                                    "capabilities": {"connectors": [{"connector_id": "c1", "action": "request", "require_approval": False}]}})
    fs.put("connectors/c1", {"name": "Hook", "type": "webhook", "config": {}, "secrets": {}})
    envs, turns = [], [[{"id": "c1", "name": "webhook_cap0", "arguments": '{"reason": "r", "payload": "{}"}'}], "sent"]

    def fake(**kw):
        t = turns.pop(0)
        return llm.Completion("" if isinstance(t, list) else t, "gemini-3-flash", 1, 1, 0.0, 1, tool_calls=tuple(t) if isinstance(t, list) else ())

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr("app.engine.connectors.invoke", lambda *a, **k: envs.append(runenv.get()) or "200 OK")
    r = as_user(BUILDER).post("/api/chat", json={"message": "送出", "agent_id": "a4"})
    assert r.status_code == 200, r.text
    assert envs == ["production"] and r.json()["trace"][1]["summary"].endswith("request · 成功")
    assert "env" not in fs.store[f"sessions/{r.json()['session_id']}"]
    assert not [a for a in audit_log() if a["action"] == "connector.simulated"]


def test_general_chat_offers_the_users_own_connectors_as_tools(fs, as_user, monkeypatch):
    """No agent picked: every gateway-backed connector shared with the user becomes a tool (reads run, writes pause for the
    user), so "幫我建一份 Google 文件" can be acted on. A picked agent keeps exactly its own connectors."""
    from app.routers.chat import my_connector_caps

    fs.put("connectors/cal", {"type": "calendar", "label": "Google Calendar", "owner_uid": "admin", "config": {"allowed_actions": ["list_events"], "write_actions": ["create_event"]},
                              "share": {"access": "account", "role": "use", "members": []}})
    fs.put("connectors/docs", {"type": "gateway", "label": "Google Docs", "owner_uid": "admin", "share": {"access": "account", "role": "use", "members": []},
                               "config": {"service": "googledocs", "auth_mode": "oauth2", "allowed_actions": ["googledocs.create_document"]}})
    fs.put("connectors/hook", {"type": "webhook", "label": "Hook", "owner_uid": "admin", "config": {}})  # admin-built, not a per-user connector
    fs.put("connectors/private", {"type": "calendar", "label": "Private", "owner_uid": "someone", "config": {}})  # not shared with me
    caps = my_connector_caps(BUILDER)
    assert [(c.connector_id, c.action, c.require_approval) for c in caps] == [  # interleaved: no connector crowds out another
        ("cal", "list_events", True), ("docs", "googledocs.create_document", True), ("cal", "create_event", True)]
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return llm.Completion("ok", "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr("app.engine.gateway_actions.describe", lambda cfg: [{"id": "googledocs.create_document", "label": "create_document", "description": "Create a doc", "write": True, "operation": "write",
                                                                             "args": [{"key": "title", "label": "Title", "kind": "text", "required": True}, {"key": "text", "label": "Text", "kind": "text", "required": False}]}])
    r = as_user(BUILDER).post("/api/chat", json={"message": "幫我建一份文件"})
    assert r.status_code == 200, r.text
    tools = {t["function"]["name"]: t for t in seen["tools"]}
    assert {n.split("_cap")[0] for n in tools} == {"calendar", "gateway"} and len(tools) == 3
    doc = next(t for n, t in tools.items() if n.startswith("gateway"))
    assert doc["function"]["parameters"]["required"] == ["reason", "title"] and "Create a doc" in doc["function"]["description"]
    assert "連接器工具" in seen["system"]
    # a picked agent is not widened
    fs.put("agents/a5", {"name": "純問答", "owner_uid": BUILDER2.uid, "status": "published", "version": 1})
    fs.put("agents/a5/versions/1", {"name": "純問答", "instructions": "x", "knowledge_doc_ids": [], "flow": {"nodes": [], "edges": []}})
    seen.clear()
    assert as_user(BUILDER).post("/api/chat", json={"message": "hi", "agent_id": "a5"}).status_code == 200
    assert not seen.get("tools")


def test_every_allowed_action_of_every_connector_is_offered_in_chat(fs, as_user):
    """No cap: Gmail's dozens of actions and the Calendar / Docs ones all reach the model."""
    from app.routers import chat as chat_router

    share = {"access": "account", "role": "use", "members": []}
    fs.put("connectors/gmail", {"type": "gateway", "label": "Gmail", "owner_uid": "admin", "share": share,
                                "config": {"service": "gmail", "auth_mode": "oauth2", "allowed_actions": [f"gmail.a{i}" for i in range(90)]}})
    fs.put("connectors/docs", {"type": "gateway", "label": "Google Docs", "owner_uid": "admin", "share": share,
                               "config": {"service": "googledocs", "auth_mode": "oauth2", "allowed_actions": ["googledocs.create_document", "googledocs.search_documents"]}})
    fs.put("connectors/cal", {"type": "calendar", "label": "Google Calendar", "owner_uid": "admin", "share": share, "config": {"write_actions": ["create_event"]}})
    caps = chat_router.my_connector_caps(BUILDER)
    assert len(caps) == 90 + 2 + 6 and caps[0].connector_id == "gmail" and caps[1].connector_id == "cal" and caps[2].connector_id == "docs"


def test_general_chat_approval_works_without_a_stored_agent(fs, as_user, monkeypatch):
    """Regression: with no published Medisense agent the general chat runs the built-in assistant (agent_id "general-chat",
    no Firestore document). Confirming its paused write used to 404; now the agent is rebuilt the same way the turn built it."""
    from app.engine import agent as rt

    share = {"access": "account", "role": "use", "members": []}
    fs.put("connectors/docs", {"type": "gateway", "label": "Google Docs", "owner_uid": "admin", "share": share,
                               "config": {"service": "googledocs", "auth_mode": "oauth2", "allowed_actions": ["googledocs.create_document"]}})
    monkeypatch.setattr("app.engine.gateway_actions.describe", lambda cfg: [{"id": "googledocs.create_document", "label": "create_document", "description": "", "write": True, "operation": "write",
                                                                             "args": [{"key": "title", "label": "Title", "kind": "text", "required": True}, {"key": "text", "label": "Text", "kind": "text", "required": False}]}])
    turns = [[{"id": "c1", "name": "gateway_cap0", "arguments": '{"reason": "建立文件", "title": "test", "text": "test"}'}], "已建立"]

    def fake(**kw):
        t = turns.pop(0)
        return llm.Completion("" if isinstance(t, list) else t, "gemini-3-flash", 1, 1, 0.0, 1, tool_calls=tuple(t) if isinstance(t, list) else ())

    ran = []
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr(rt, "invoke_connector", lambda cid, action, args, **k: ran.append((cid, action, args)) or ("documentId d1", "Google Docs · create_document · 成功"))
    me = as_user(BUILDER)
    r = me.post("/api/chat", json={"message": "create a google doc, title: test, content: test"}).json()
    assert r["pending_approval"]["approver"] == "user" and not ran
    assert fs.store[f"sessions/{r['session_id']}"]["agent_id"] == "general-chat"
    r2 = me.post("/api/chat/approve", json={"session_id": r["session_id"], "approve": True})
    assert r2.status_code == 200, r2.text
    assert r2.json()["reply"] == "已建立" and ran == [("docs", "googledocs.create_document", {"title": "test", "text": "test"})]
