from app.engine import steps as se
from app.schemas import AgentIn, Step

from .conftest import ADMIN, BUILDER


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
