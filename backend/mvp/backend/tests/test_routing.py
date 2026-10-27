from app.engine import routing

from .conftest import ADMIN, BUILDER


def test_resolve_defaults_and_rules():
    cfg = routing.DEFAULT_CONFIG
    assert routing.resolve_group(cfg, "請分析這份報告").group == "reasoning"
    r = routing.resolve_group(cfg, "你好")
    assert r.group == "fast" and r.matched_rule == "simple-to-fast"
    assert routing.resolve_group(None, "why").group == "reasoning"  # missing config -> defaults
    assert routing.resolve_group({}, "hello").group == "fast"


def test_resolve_order_disabled_and_bad_groups():
    cfg = {"default_group": "budget", "fallback_group": "fast", "rules": [
        {"id": "off", "condition": "all", "group": "sovereign", "enabled": False},
        {"id": "bad", "condition": "complex", "group": "nonsense", "enabled": True},
        {"id": "any", "condition": "all", "group": "reasoning", "enabled": True}]}
    r = routing.resolve_group(cfg, "plan the day")
    assert r.group == "fast" and r.matched_rule == "bad"  # invalid group -> fallback_group
    assert routing.resolve_group(cfg, "hi").group == "reasoning"
    assert routing.resolve_group({"default_group": "budget", "rules": []}, "x").group == "budget"
    assert routing.resolve_group({"default_group": "zzz", "rules": []}, "x").group == "fast"


def test_pick_group_auto_uses_config(fs):
    from app.engine.flow import pick_group
    from app.schemas import AgentIn, FlowNode

    fs.put("config/routing", {"version": 3, "default_group": "fast", "fallback_group": "fast", "rules": [
        {"id": "r", "name": "all budget", "condition": "simple", "group": "budget", "enabled": True},
        {"id": "c", "name": "cx", "condition": "complex", "group": "sovereign", "enabled": True}]})
    agent = AgentIn(name="a", model_group="auto")
    node = FlowNode(id="n", type="llm")
    g, note = pick_group(agent, node, "hello")
    assert g == "budget" and "auto" in note
    assert pick_group(agent, node, "analyze: 比較")[0] == "sovereign"
    # cost cap still applies, sovereign_only still wins, plain groups unchanged
    assert pick_group(AgentIn(name="a", model_group="auto", routing={"max_cost_tier": "budget"}), node, "hello")[0] == "budget"
    assert pick_group(AgentIn(name="a", model_group="auto", routing={"sovereign_only": True}), node, "x")[0] == "sovereign"
    assert pick_group(AgentIn(name="a", model_group="fast"), node, "please 分析")[0] == "reasoning"
    # empty Firestore -> defaults
    fs.store.clear()
    routing.reset_cache()
    assert pick_group(agent, node, "hello")[0] == "fast"


def test_auto_is_a_valid_model_group_and_never_sent_to_litellm(monkeypatch):
    from app.engine import llm
    from app.schemas import AgentIn

    assert AgentIn(name="a", model_group="auto").model_group == "auto"
    assert "auto" in llm.SELECTABLE_GROUPS and "auto" not in llm.GROUPS
    sent = {}

    class R:
        choices = [type("C", (), {"message": type("M", (), {"content": "x"})()})()]
        model = "gemini-3-flash"
        usage = None

    class Client:
        class chat:  # noqa: N801
            class completions:  # noqa: N801
                @staticmethod
                def create(**kw):
                    sent.update(kw)
                    return R()

    monkeypatch.setattr(llm, "_client", lambda: Client)
    llm.complete(group="auto", system="s", messages=[], agent_id="a", user_id="u")
    assert sent["model"] == "fast"


def test_routing_endpoints(fs, as_user, audit_log):
    body = {"default_group": "fast", "fallback_group": "budget", "rules": [
        {"id": "r1", "name": "hard", "condition": "complex", "group": "reasoning"}]}
    assert as_user(BUILDER).get("/api/routing").status_code == 403
    c = as_user(ADMIN)
    assert c.get("/api/routing").json()["version"] == 0  # defaults when nothing stored
    r = c.put("/api/routing", json=body)
    assert r.status_code == 200 and r.json()["version"] == 1
    assert c.put("/api/routing", json=body).json()["version"] == 2
    assert c.put("/api/routing", json={**body, "default_group": "auto"}).status_code == 422
    assert c.put("/api/routing", json={**body, "rules": [body["rules"][0], body["rules"][0]]}).status_code == 422
    t = c.post("/api/routing/test", json={"text": "why is this so"}).json()
    assert t == {"group": "reasoning", "reason": t["reason"], "matched_rule": "r1"}
    t = c.post("/api/routing/test", json={"text": "hello"}).json()
    assert t["group"] == "fast" and t["matched_rule"] is None
    assert sum(1 for a in audit_log() if a["action"] == "routing.update") == 2
