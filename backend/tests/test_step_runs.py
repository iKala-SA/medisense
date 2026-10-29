import json

from app.engine import llm

from .conftest import ADMIN, BUILDER, BUILDER2


def fake_llm(monkeypatch, reply=lambda kw: "答"):
    calls = []

    def fake(**kw):
        calls.append(kw)
        return llm.Completion(reply(kw), "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    return calls


def make(c, steps, **extra):
    a = c.post("/api/agents", json={"name": "流程", "instructions": "你是流程助理。", "steps": steps, **extra}).json()
    return a["id"]


def S(id, type, title, **config):
    return {"id": id, "type": type, "title": title, "config": config}


def test_a_run_follows_the_steps_and_resolves_references(fs, as_user, monkeypatch):
    calls = fake_llm(monkeypatch, lambda kw: "給 " + kw["messages"][-1]["content"].split("寫給")[-1])
    c = as_user(BUILDER)
    aid = make(c, [S("s1", "text_input", "客戶", placeholder="x"), S("s2", "llm_generate", "信", prompt="寫給{{s1}}的信")])
    r = c.post(f"/api/agents/{aid}/step-runs", json={"inputs": {"s1": "東元"}, "use_published": False})
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["status"] == "succeeded" and [s["status"] for s in run["steps"]] == ["succeeded", "succeeded"]
    assert run["steps"][1]["input"] == "寫給東元的信" and "東元" in run["result"]
    assert "你是流程助理" in calls[0]["system"]  # the agent's instructions reach every AI step
    assert "~~~document" not in calls[0]["system"]  # step outputs are plain text
    assert c.get(f"/api/step-runs/{run['id']}").json()["status"] == "succeeded"
    assert as_user(BUILDER2).get(f"/api/step-runs/{run['id']}").status_code == 404 and as_user(ADMIN).get(f"/api/step-runs/{run['id']}").status_code == 404
    assert [x["id"] for x in c.get(f"/api/agents/{aid}/step-runs").json()] == [run["id"]]


def test_missing_input_failure_retry_and_skip(fs, as_user, monkeypatch):
    fake_llm(monkeypatch)
    c = as_user(BUILDER)
    aid = make(c, [S("s1", "text_input", "客戶"), S("s2", "llm_generate", "信", prompt="{{s1}}")])
    run = c.post(f"/api/agents/{aid}/step-runs", json={"use_published": False}).json()
    assert run["status"] == "failed" and "請填寫" in run["error"] and run["steps"][0]["status"] == "failed"

    n = {"i": 0}

    def flaky(kw):
        n["i"] += 1
        if n["i"] < 3:
            raise RuntimeError("boom")
        return "ok"

    fake_llm(monkeypatch, flaky)
    monkeypatch.setattr("time.sleep", lambda s: None)
    aid2 = make(c, [{**S("s1", "llm_generate", "A", prompt="x"), "on_error": "retry"}])
    assert c.post(f"/api/agents/{aid2}/step-runs", json={"use_published": False}).json()["status"] == "succeeded" and n["i"] == 3

    fake_llm(monkeypatch, lambda kw: (_ for _ in ()).throw(RuntimeError("down")))
    aid3 = make(c, [{**S("s1", "llm_generate", "A", prompt="x"), "on_error": "skip"}, S("s2", "text_input", "B", default="d")])
    run3 = c.post(f"/api/agents/{aid3}/step-runs", json={"use_published": False}).json()
    assert run3["status"] == "succeeded" and run3["steps"][0]["status"] == "skipped"


def test_disabled_steps_are_skipped_and_invalid_flows_are_refused(fs, as_user, monkeypatch):
    fake_llm(monkeypatch)
    c = as_user(BUILDER)
    aid = make(c, [S("s1", "text_input", "A", default="x"), {**S("s2", "llm_generate", "B", prompt="y"), "enabled": False}])
    run = c.post(f"/api/agents/{aid}/step-runs", json={"use_published": False}).json()
    assert [s["status"] for s in run["steps"]] == ["succeeded", "skipped"]
    bad = make(c, [S("s1", "llm_generate", "A")])
    assert c.post(f"/api/agents/{bad}/step-runs", json={"use_published": False}).status_code == 422
    plain = c.post("/api/agents", json={"name": "對話"}).json()["id"]
    assert c.post(f"/api/agents/{plain}/step-runs", json={"use_published": False}).status_code == 409


def test_actions_ask_before_writing_and_can_be_rejected(fs, as_user, monkeypatch, audit_log):
    fake_llm(monkeypatch, lambda kw: json.dumps({"text": "已通報", "channel": ""}))
    fs.put("connectors/c1", {"name": "Slack", "type": "slack", "config": {}})
    sent = []
    monkeypatch.setattr("app.engine.flow.invoke_connector", lambda cid, action, args, **k: (sent.append((cid, action, args)) or ("送出", "Slack · 成功")))
    c = as_user(BUILDER)
    aid = make(c, [S("s1", "action", "通報", connector_id="c1", action="send_message", prompt="通報藥局")])
    run = c.post(f"/api/agents/{aid}/step-runs", json={"use_published": False}).json()
    assert run["status"] == "waiting_approval" and not sent and run["pending"]["args"]["text"] == "已通報"
    assert as_user(BUILDER2).post(f"/api/step-runs/{run['id']}/approve", json={"approve": True}).status_code == 404
    done = c.post(f"/api/step-runs/{run['id']}/approve", json={"approve": True}).json()
    assert done["status"] == "succeeded" and sent == [("c1", "send_message", {"text": "已通報", "channel": ""})] and done["pending"] is None
    assert c.post(f"/api/step-runs/{run['id']}/approve", json={"approve": True}).status_code == 409
    # reject
    run2 = c.post(f"/api/agents/{aid}/step-runs", json={"use_published": False}).json()
    rej = c.post(f"/api/step-runs/{run2['id']}/approve", json={"approve": False}).json()
    assert rej["status"] == "cancelled" and len(sent) == 1
    assert {"step_run.approve", "step_run.reject"} <= {a["action"] for a in audit_log()}


def test_inputs_are_deidentified_before_storage_and_a_run_can_continue_in_chat(fs, as_user, monkeypatch):
    fake_llm(monkeypatch, lambda kw: "報告內容")
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("王小明", "[PERSON_NAME]"))
    c = as_user(BUILDER)
    aid = make(c, [S("s1", "text_input", "病人"), S("s2", "llm_generate", "摘要", prompt="摘要 {{s1}}")])
    run = c.post(f"/api/agents/{aid}/step-runs", json={"inputs": {"s1": "王小明 血壓高"}, "use_published": False}).json()
    stored = fs.store[f"step_runs/{run['id']}"]
    assert "王小明" not in json.dumps(stored, ensure_ascii=False, default=str) and run["status"] == "succeeded"
    out = c.post(f"/api/step-runs/{run['id']}/to-chat", json={}).json()
    sess = fs.store[f"sessions/{out['session_id']}"]
    assert [m["role"] for m in sess["messages"]] == ["user", "assistant"] and sess["messages"][1]["content"] == "報告內容" and "王小明" not in sess["messages"][0]["content"]
    assert as_user(BUILDER2).post(f"/api/step-runs/{run['id']}/to-chat", json={}).status_code == 404
    waiting = c.post(f"/api/agents/{make(c, [S('s1', 'action', 'x', connector_id='c', action='a', prompt='p')])}/step-runs", json={"use_published": False})
    assert waiting.status_code in (200, 422)
