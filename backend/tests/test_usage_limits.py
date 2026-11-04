"""用量上限: a group or a model stops model calls once its daily / monthly budget is used; usage by person and group."""
import pytest

from app.engine import flow, limits, llm, usage
from app.schemas import AgentIn

from .conftest import ADMIN, BUILDER


@pytest.fixture(autouse=True)
def _fresh():
    limits.reset_cache()
    yield
    limits.reset_cache()


def _setup(fs):
    fs.put("groups/g1", {"name": "心臟內科"})
    fs.put("users/amy@example.com", {"email": "amy@example.com", "uid": "u-amy", "name": "Amy", "groups": ["g1"], "role": "user", "status": "active"})
    fs.put("users/bob@example.com", {"email": "bob@example.com", "uid": "u-bob", "name": "Bob", "groups": [], "role": "user", "status": "active"})
    day = usage.day_key()
    # what usage.record keeps for limits (plain numbers: the fake store does not apply Increment)
    fs.put(f"{usage.USER_DAILY}/{day}_u-amy", {"day": day, "uid": "u-amy", "requests": 3, "tokens": 900, "cost_usd": 0.6})
    fs.put(f"{usage.USER_DAILY}/{day}_u-bob", {"day": day, "uid": "u-bob", "requests": 1, "tokens": 100, "cost_usd": 0.1})
    fs.put(f"{usage.TARGET_DAILY}/{day}_gemini-2.5-pro", {"day": day, "target": "gemini-2.5-pro", "requests": 2, "tokens": 500, "cost_usd": 2.0})
    return day


def test_admin_manages_limits_and_sees_what_is_used(fs, as_user, audit_log):
    _setup(fs)
    c = as_user(ADMIN)
    r = c.post("/api/monitoring/limits", json={"scope": "group", "target": "g1", "period": "day", "metric": "cost_usd", "limit": 0.5})
    assert r.status_code == 201, r.text
    lim = r.json()
    assert lim["target_label"] == "心臟內科" and lim["used"] == 0.6 and lim["exceeded"] and lim["pct"] == 120.0
    assert c.post("/api/monitoring/limits", json={"scope": "group", "target": "nope", "limit": 1}).status_code == 422
    assert c.post("/api/monitoring/limits", json={"scope": "model", "target": "gemini-2.5-pro", "metric": "requests", "limit": 0}).status_code == 422
    m = c.post("/api/monitoring/limits", json={"scope": "model", "target": "gemini-2.5-pro", "metric": "requests", "period": "month", "limit": 10}).json()
    assert m["used"] == 2 and not m["exceeded"]
    listed = c.get("/api/monitoring/limits").json()
    assert [x["id"] for x in listed][0] == lim["id"]  # exceeded first
    upd = c.put(f"/api/monitoring/limits/{lim['id']}", json={"scope": "group", "target": "g1", "period": "day", "metric": "cost_usd", "limit": 5})
    assert upd.json()["exceeded"] is False
    assert c.delete(f"/api/monitoring/limits/{m['id']}").status_code == 204
    assert {"usage_limit.create", "usage_limit.update", "usage_limit.delete"} <= {a["action"] for a in audit_log()}
    assert as_user(BUILDER).get("/api/monitoring/limits").status_code == 403


def test_a_used_up_limit_stops_the_model_call(fs, monkeypatch):
    _setup(fs)
    calls = []
    monkeypatch.setattr(llm, "complete", lambda **kw: calls.append(kw) or llm.Completion("ok", "m", 1, 1, 0.0, 1))
    monkeypatch.setattr(usage, "record", lambda **k: None)
    fs.put("usage_limits/l1", {"scope": "group", "target": "g1", "period": "day", "metric": "cost_usd", "limit": 0.5, "enabled": True, "target_label": "心臟內科"})
    ag = AgentIn(name="A")
    with pytest.raises(limits.LimitExceeded, match="心臟內科"):
        flow._complete(ag, "a", "u-amy", "fast", system="s", messages=[])
    assert not calls  # nothing reached the model
    flow._complete(ag, "a", "u-bob", "fast", system="s", messages=[])  # not in the group
    assert len(calls) == 1
    fs.put("usage_limits/l1", {**fs.store["usage_limits/l1"], "enabled": False})
    limits.reset_cache()
    flow._complete(ag, "a", "u-amy", "fast", system="s", messages=[])  # a switched-off limit does nothing
    fs.put("usage_limits/l2", {"scope": "model", "target": "gemini-2.5-pro", "period": "month", "metric": "requests", "limit": 2, "enabled": True})
    limits.reset_cache()
    with pytest.raises(limits.LimitExceeded, match="gemini-2.5-pro"):
        flow._complete(ag, "a", "u-bob", "gemini-2.5-pro", model="gemini-2.5-pro", system="s", messages=[])
    flow._complete(ag, "a", "u-bob", "fast", system="s", messages=[])  # another model is fine


def test_chat_answers_429_when_the_limit_is_used_up(fs, as_user, monkeypatch):
    _setup(fs)
    fs.put("users/builder@example.com", {"email": BUILDER.email, "uid": BUILDER.uid, "groups": ["g1"], "role": "builder", "status": "active"})
    fs.put("usage_limits/l1", {"scope": "group", "target": "g1", "period": "day", "metric": "cost_usd", "limit": 0.5, "enabled": True, "target_label": "心臟內科"})
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", lambda **kw: llm.Completion("ok", "m", 1, 1, 0.0, 1))
    r = as_user(BUILDER).post("/api/chat", json={"message": "hi"})
    assert r.status_code == 429 and "已達用量上限" in r.json()["detail"]


def test_usage_by_person_and_by_group(fs, as_user):
    day = _setup(fs)
    for i, (uid, cost) in enumerate((("u-amy", 0.3), ("u-amy", 0.2), ("u-bob", 0.1))):
        fs.put(f"usage/r{i}", {"day": day, "env": "production", "uid": uid, "model": "gemini-3-flash", "prompt_tokens": 10, "completion_tokens": 5,
                               "cost_usd": cost, "ok": True})
    c = as_user(ADMIN)
    people = c.get("/api/monitoring/users").json()
    assert [(p["email"], p["requests"], p["cost_usd"]) for p in people] == [("amy@example.com", 2, 0.5), ("bob@example.com", 1, 0.1)]
    assert [p["email"] for p in c.get("/api/monitoring/users", params={"group": "g1"}).json()] == ["amy@example.com"]
    groups = c.get("/api/monitoring/groups").json()
    assert groups == [{"id": "g1", "name": "心臟內科", "email": "", "members": 1, "requests": 2, "tokens": 30, "cost_usd": 0.5, "failed": 0, "main_model": "gemini-3-flash"}]


def test_the_dashboard_filters_by_person_group_or_agent(fs, as_user):
    day = _setup(fs)
    for i, (uid, agent, cost) in enumerate((("u-amy", "a1", 0.3), ("u-amy", "a2", 0.2), ("u-bob", "a1", 0.1))):
        fs.put(f"usage/r{i}", {"day": day, "env": "production", "uid": uid, "agent_id": agent, "agent_name": agent.upper(), "model": "m",
                               "group": "fast", "prompt_tokens": 10, "completion_tokens": 0, "cost_usd": cost, "ok": True})
    c = as_user(ADMIN)
    assert c.get("/api/monitoring/summary", params={"person": "u-bob"}).json()["requests"] == 1
    assert c.get("/api/monitoring/summary", params={"agent": "a1"}).json()["requests"] == 2
    assert c.get("/api/monitoring/summary", params={"group": "g1", "agent": "a1"}).json()["requests"] == 1
    assert [r["agent_id"] for r in c.get("/api/monitoring/agents", params={"person": "u-amy", "sort": "cost_usd"}).json()] == ["a1", "a2"]
    assert [p["email"] for p in c.get("/api/monitoring/users", params={"agent": "a1"}).json()] == ["amy@example.com", "bob@example.com"]
    assert [(g["id"], g["requests"]) for g in c.get("/api/monitoring/groups", params={"agent": "a2"}).json()] == [("g1", 1)]
    assert c.get("/api/monitoring/groups", params={"group": "g1"}).json()[0]["requests"] == 2
