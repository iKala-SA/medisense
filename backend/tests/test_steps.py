from app.engine import steps as se
from app.schemas import AgentIn, Step

from .conftest import ADMIN, BUILDER, PLAIN


def S(id, type="llm_generate", title=None, **config):
    return Step(id=id, type=type, title=title or id, config=config)


def msgs(problems, level="error"):
    return [p["message"] for p in problems if p["level"] == level]


def test_references_must_point_at_earlier_steps():
    ok = [S("s1", "text_input", "客戶"), S("s2", prompt="寫給 {{s1}} 的信")]
    assert se.validate_steps(ok) == []
    bad = [S("s1", prompt="用 {{s2}}"), S("s2", "text_input", "B")]
    assert any("後面" in m for m in msgs(se.validate_steps(bad)))
    assert any("不存在" in m for m in msgs(se.validate_steps([S("s1", prompt="{{zzz}}")])))
    assert any("後面或自己" in m for m in msgs(se.validate_steps([S("s1", prompt="{{s1}}")])))
    off = [Step(id="s1", type="text_input", title="A", enabled=False), S("s2", prompt="{{s1}}")]
    assert msgs(se.validate_steps(off), "warning") and not msgs(se.validate_steps(off))
    assert se.validate_steps([S("s1", "text_input", "A"), S("s2", prompt="{{s1.email}}")]) == []  # a sub-field reference


def test_required_fields_titles_unsupported_types_and_size():
    p = se.validate_steps([S("a", "llm_generate"), S("b", "action", connector_id="c1")])
    assert any("提示詞" in m for m in msgs(p)) and any("動作" in m for m in msgs(p))
    assert any("重複" in m for m in msgs(se.validate_steps([S("a", "text_input", "X"), S("b", "text_input", "x")])))
    assert any("尚未開放" in m for m in msgs(se.validate_steps([S("a", "research", config="") if False else Step(id="a", type="research", title="R")])))
    assert any("超過 30" in m for m in msgs(se.validate_steps([S(f"s{i}", "text_input", f"T{i}") for i in range(31)]), "warning"))


def test_steps_roundtrip_and_old_clients_do_not_wipe_them(fs, as_user):
    c = as_user(BUILDER)
    body = {"name": "A", "steps": [{"id": "s1", "type": "text_input", "title": "客戶名稱"}],
            "capabilities": {"web_search": True, "connectors": [{"connector_id": "c1", "action": "send"}]},
            "icon": "🩺", "opening_questions": ["  你好  ", "", "第二題"]}
    a = c.post("/api/agents", json=body).json()
    assert a["steps"][0]["title"] == "客戶名稱" and a["capabilities"]["web_search"] and a["capabilities"]["connectors"][0]["require_approval"]
    assert a["icon"] == "🩺" and a["opening_questions"] == ["你好", "第二題"]
    old = c.put(f"/api/agents/{a['id']}", json={"name": "A2"}).json()  # an older client sends none of the new fields
    assert old["name"] == "A2" and len(old["steps"]) == 1 and old["capabilities"]["web_search"]
    new = c.put(f"/api/agents/{a['id']}", json={"name": "A2", "steps": []}).json()
    assert new["steps"] == []
    assert c.post("/api/agents/validate-steps", json={"steps": [{"id": "s1", "type": "llm_generate", "title": "x"}]}).json()["problems"]


def test_publish_is_blocked_by_step_errors(fs, as_user):
    c = as_user(ADMIN)
    a = c.post("/api/agents", json={"name": "B", "steps": [{"id": "s1", "type": "llm_generate", "title": "寫信", "config": {}}]}).json()
    r = c.post(f"/api/agents/{a['id']}/publish")
    assert r.status_code == 422 and "提示詞" in r.text
    c.put(f"/api/agents/{a['id']}", json={"name": "B", "steps": [{"id": "s1", "type": "llm_generate", "title": "寫信", "config": {"prompt": "寫信"}}]})
    assert c.post(f"/api/agents/{a['id']}/publish").status_code == 200


def test_draft_by_conversation_keeps_only_what_the_platform_understands(fs, as_user, monkeypatch):
    import json

    from app.engine import llm

    fs.put("connectors/c1", {"name": "Slack 通報", "type": "slack", "enabled": True, "config": {}})
    seen = {}
    reply = {"reply": "好了", "agent": {"name": "客訴彙整", "description": "d", "instructions": "你是客服助理", "icon": "📬",
             "opening_questions": ["a", "b", "c", "d", "e"],
             "capabilities": {"web_search": True, "spaces": ["bogus"], "connectors": [{"connector_id": "c1", "action": "send_message"}, {"connector_id": "zzz", "action": "x"}],
                              "model_pref": "quality"},
             "steps": [{"id": "s 1", "type": "text_input", "title": "信箱"},
                       {"id": "s2", "type": "llm_generate", "title": "分類", "config": {"prompt": "分類 {{s1}}"}},
                       {"id": "s3", "type": "research", "title": "深度"},
                       {"id": "s4", "type": "action", "title": "發送", "config": {"connector_id": "zzz", "action": "x", "prompt": "p"}},
                       {"id": "s5", "type": "action", "title": "通報", "config": {"connector_id": "c1", "action": "send_message", "prompt": "通報 {{s2}}"}}]}}

    def fake(**kw):
        seen.update(kw)
        return llm.Completion("```json\n" + json.dumps(reply, ensure_ascii=False) + "\n```", "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("王小明", "[PERSON]"))
    out = as_user(BUILDER).post("/api/agents/draft", json={"message": "王小明 要每天彙整客訴"}).json()
    a = out["agent"]
    assert a["name"] == "客訴彙整" and len(a["opening_questions"]) == 4 and a["capabilities"]["spaces"] == []
    assert [c["connector_id"] for c in a["capabilities"]["connectors"]] == ["c1"]  # the invented connector is dropped
    assert [s["id"] for s in a["steps"]] == ["s1", "s2", "s5"]  # unsupported type and the step on an invented connector are dropped
    assert out["problems"] == [] and "[PERSON]" in seen["messages"][-1]["content"] and "Slack 通報" in seen["messages"][-1]["content"]
    assert as_user(PLAIN).post("/api/agents/draft", json={"message": "x"}).status_code == 403


def test_agent_kind_drafts_have_no_steps_and_instructions_can_be_improved(fs, as_user, monkeypatch):
    import json

    from app.engine import llm

    seen = []

    def fake(**kw):
        seen.append(kw)
        if kw["agent_id"] == "agent-builder" and "提示詞編輯" in kw["system"]:
            return llm.Completion("```\n更清楚的指令\n```", "gemini-3-flash", 1, 1, 0.0, 1)
        return llm.Completion(json.dumps({"reply": "好", "agent": {"name": "培訓", "instructions": "你是培訓助理", "steps": [{"id": "s1", "type": "text_input", "title": "x"}]}}), "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    c = as_user(BUILDER)
    out = c.post("/api/agents/draft", json={"message": "培訓助理", "kind": "agent"}).json()
    assert "聊天代理程式" in seen[0]["system"] and out["agent"]["name"] == "培訓"
    assert c.post("/api/agents", json={"name": "A", "kind": "agent"}).json()["kind"] == "agent"
    assert c.post("/api/agents", json={"name": "F", "kind": "flow"}).json()["kind"] == "flow"
    r = c.post("/api/agents/improve", json={"instructions": "你是助理"}).json()
    assert r["instructions"] == "更清楚的指令"
    assert as_user(PLAIN).post("/api/agents/improve", json={"instructions": "x"}).status_code == 403
