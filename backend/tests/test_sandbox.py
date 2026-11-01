"""The logical sandbox: a draft run is `sandbox` (reads real, writes simulated, counted and filed separately); a published run is production."""
import json

import pytest

from app.engine import agent as rt
from app.engine import llm, runenv
from app.schemas import AgentIn

from .conftest import ADMIN, BUILDER
from .test_agent import Script, call


def test_environment_follows_the_snapshot_being_run():
    assert runenv.of(True) == "production" and runenv.of(False) == "sandbox" and runenv.get() == "production"
    with runenv.use("sandbox"):
        assert runenv.is_sandbox()
    assert not runenv.is_sandbox()  # restored


@pytest.fixture
def rig(fs, monkeypatch):
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr("app.engine.deid.deidentify_many", lambda ts: list(ts))
    fs.put("connectors/k1", {"type": "slack", "name": "護理站 Slack", "config": {}, "secrets": {}})
    real = []
    monkeypatch.setattr("app.engine.connectors.invoke", lambda *a, **k: real.append(a[3]) or "REAL-RESULT")
    ag = AgentIn.model_validate({"name": "A", "flow": {"nodes": [{"id": "t1", "type": "tool", "data": {"connector_id": "k1", "action": "send_message"}},
                                                                 {"id": "ap", "type": "approval", "data": {"message": "要送出嗎？"}}], "edges": []}})
    tool = next(iter(rt.build_tools(ag, [], "x").values()))

    def go(env):
        s = Script([call(tool.name, {"reason": "r", "text": "請查房"})], "完成")
        monkeypatch.setattr(llm, "complete", s)
        with runenv.use(env):
            return rt.run_agent(ag, agent_id="a", user_id="u", user_message="x", history=[]), s
    return go, real


def test_a_write_action_is_simulated_in_the_sandbox_and_needs_no_approval(fs, rig):
    go, real = rig
    r, s = go("sandbox")
    assert real == [] and not r.pending and r.reply == "完成"
    tool_msg = next(m for m in s.sent[1]["messages"] if m["role"] == "tool")["content"]
    assert "沙盒模擬" in tool_msg and "請查房" in tool_msg
    assert "沙盒模擬" in r.trace[1].summary


def test_the_same_action_in_production_still_waits_for_a_human(fs, rig):
    go, real = rig
    r, _ = go("production")
    assert r.pending and real == []  # paused before anything is sent


def test_usage_rows_are_tagged_and_the_sandbox_gets_its_own_daily_document(fs, monkeypatch):
    from app.engine import usage
    monkeypatch.setattr("app.engine.usage.firestore.Increment", lambda n: n)  # the fake store cannot add; the ids and tags are what matters here
    ag = AgentIn(name="A")
    for env in ("production", "sandbox"):
        with runenv.use(env):
            usage.record(agent=ag, agent_id="a1", user_id="u", group="fast", model="m", prompt_tokens=10, completion_tokens=5, cost_usd=0.01, ms=100, ok=True, fallback=False)
    rows = [v for k, v in fs.store.items() if k.startswith("usage/")]
    assert sorted(r["env"] for r in rows) == ["production", "sandbox"]
    days = {k: v for k, v in fs.store.items() if k.startswith("usage_daily/")}
    assert len(days) == 2 and sum(k.endswith("__sandbox") for k in days) == 1 and {v["env"] for v in days.values()} == {"production", "sandbox"}


def test_the_dashboard_shows_production_by_default_and_the_sandbox_on_request(fs, as_user):
    day = __import__("app.engine.usage", fromlist=["day_key"]).day_key()
    base = {"day": day, "agent_id": "a1", "agent_name": "A", "department": "", "failed": 0, "fallbacks": 0, "prompt_tokens": 10, "completion_tokens": 5,
            "cost_usd": 0.01, "ms_total": 100, "by_model": {}, "by_group": {}}
    fs.put(f"usage_daily/{day}_a1", {**base, "requests": 2, "env": "production"})
    fs.put(f"usage_daily/{day}_a1__sandbox", {**base, "requests": 3, "env": "sandbox"})
    fs.put(f"usage_daily/{day}_old", {**base, "agent_id": "old", "requests": 4})  # written before the split: production
    c = as_user(ADMIN)
    assert c.get("/api/monitoring/summary").json()["requests"] == 6
    assert c.get("/api/monitoring/summary?env=sandbox").json()["requests"] == 3
    assert [r["requests"] for r in c.get("/api/monitoring/agents?env=sandbox").json()] == [3]
    assert c.get("/api/monitoring/summary?env=nope").status_code == 422
    assert "sandbox" in c.get("/api/monitoring/export.csv?env=sandbox").headers["content-disposition"]


def test_draft_chat_sessions_stay_out_of_recents_and_are_tagged(fs, as_user, monkeypatch):
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr(llm, "complete", lambda **kw: llm.Completion("好", "gemini-3-flash", 1, 1, 0.0, 1))
    c = as_user(BUILDER)
    aid = c.post("/api/agents", json={"name": "A"}).json()["id"]
    r = c.post(f"/api/agents/{aid}/run", json={"message": "試跑", "use_published": False})
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    assert fs.store[f"sessions/{sid}"]["env"] == "sandbox"
    assert c.get("/api/sessions").json()["items"] == []
    audit = [v for k, v in fs.store.items() if k.startswith("audit/") and v["action"] == "agent.run"]
    assert audit and audit[-1].get("env") == "sandbox"
