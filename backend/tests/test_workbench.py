"""我的工作台: the AI brief over the user's own Gmail + Google Calendar, and the per-user to-do list."""
import json

import pytest

from app import config
from app.engine import llm, open_connector as oc

from .conftest import ADMIN, PLAIN, BUILDER

NOW = "2026-11-04T15:00:00+08:00"


class Gateway:
    def __init__(self):
        self.calls, self.apps, self.fail = [], [], {}

    def __call__(self, method, path, *, json=None, params=None):
        self.calls.append((path, json, params))
        for key, exc in self.fail.items():
            if key in path:
                raise exc
        if path == "/v1/apps":
            return self.apps
        if path.startswith("/v1/actions/googlecalendar.list_events"):
            return {"output": {"items": [
                {"id": "e1", "summary": "晨會", "start": {"dateTime": "2026-11-04T09:00:00+08:00"}, "end": {"dateTime": "2026-11-04T09:30:00+08:00"}},
                {"id": "e2", "summary": "跨科會議", "start": {"dateTime": "2026-11-05T06:00:00Z"}, "end": {"dateTime": "2026-11-05T07:00:00Z"}},
                {"id": "e3", "summary": "Office", "start": {"date": "2026-11-05"}, "end": {"date": "2026-11-06"}}]}}
        if path.startswith("/v1/actions/gmail.fetch_emails"):
            return {"output": {"messages": [
                {"messageId": "m1", "threadId": "t1", "subject": "明天前回覆 IRB 修正", "sender": "irb@example.com",
                 "messageTimestamp": "2026-11-04T05:00:00Z", "snippet": "請於明天中午前回覆", "labelIds": ["INBOX", "UNREAD", "IMPORTANT"]},
                {"messageId": "m2", "threadId": "t2", "subject": "電子報", "sender": "news@example.com", "labelIds": ["INBOX"]}]}}
        return {}


@pytest.fixture
def gw(monkeypatch, fs):
    monkeypatch.setenv("OPEN_CONNECTOR_URL", "http://oc.test")
    monkeypatch.setenv("OPEN_CONNECTOR_TOKEN", "t")
    config.settings.cache_clear()
    g = Gateway()
    monkeypatch.setattr(oc, "_request", g)
    monkeypatch.setattr("app.engine.deid.deidentify_many", lambda rows: [r.replace("irb@example.com", "[EMAIL_ADDRESS]") for r in rows])
    share = {"access": "account", "role": "use", "members": []}
    fs.put("connectors/cal", {"type": "calendar", "label": "Google Calendar", "owner_uid": "u-admin", "share": share, "config": {}})
    fs.put("connectors/mail", {"type": "gateway", "label": "Gmail", "owner_uid": "u-admin", "share": share,
                               "config": {"service": "gmail", "auth_mode": "oauth2", "allowed_actions": ["gmail.fetch_emails"]}})
    yield g
    config.settings.cache_clear()


def _connect(g, uid, *services, status="active"):
    g.apps += [{"service": s, "alias": oc.conn_name(uid), "status": status, "accountLabel": "me@example.com"} for s in services]


@pytest.fixture
def model(monkeypatch):
    seen = {}

    class C:
        text = json.dumps({"headline": "先回 IRB", "urgent": [{"mail": 0, "why": "明天中午截止"}, {"mail": 9, "why": "不存在"}],
                           "today": [], "tomorrow": [{"event": 1, "prep": "帶上週數據"}], "tips": ["記得休息"]})
        model, prompt_tokens, completion_tokens, cost_usd, ms = "gemini-flash", 10, 5, 0.001, 20

    def complete(**kw):
        seen.update(kw)
        return C()
    monkeypatch.setattr(llm, "complete", complete)
    return seen


def test_brief_reads_both_sources_deidentifies_and_keeps_valid_items(gw, model, as_user, fs):
    _connect(gw, PLAIN.uid, "gmail", "googlecalendar")
    r = as_user(PLAIN).post("/api/workbench/brief", json={"now": NOW})
    assert r.status_code == 200, r.text
    d = r.json()
    assert {s["service"]: s["state"] for s in d["sources"]} == {"gmail": "connected", "googlecalendar": "connected"}
    assert [e["title"] for e in d["events"]] == ["晨會", "跨科會議"]  # the Office marker is not an event
    assert [m["subject"] for m in d["mails"]] == ["明天前回覆 IRB 修正", "電子報"] and d["mails"][0]["unread"]
    assert d["summary"]["urgent"] == [{"mail": 0, "why": "明天中午截止"}]  # an out-of-range number is dropped
    assert d["summary"]["tomorrow"] == [{"event": 1, "prep": "帶上週數據"}]
    prompt = model["messages"][0]["content"]
    assert "[EMAIL_ADDRESS]" in prompt and "irb@example.com" not in prompt
    assert "明天 14:00–15:00 跨科會議" in prompt  # UTC times shown in the browser's timezone
    # always as the signed-in user, never anyone else's connection
    assert all(p == {"connectionName": oc.conn_name(PLAIN.uid)} for path, _, p in gw.calls if path.startswith("/v1/actions/"))
    assert any(u.get("agent_id") == "workbench-brief" for u in fs.store.values() if isinstance(u, dict))


def test_expired_grant_is_reported_and_other_source_still_summarised(gw, model, as_user):
    _connect(gw, PLAIN.uid, "googlecalendar")
    _connect(gw, PLAIN.uid, "gmail", status="expired")
    d = as_user(PLAIN).post("/api/workbench/brief", json={"now": NOW}).json()
    states = {s["service"]: s["state"] for s in d["sources"]}
    assert states == {"gmail": "reauth_required", "googlecalendar": "connected"} and d["summary"] and d["mails"] == []


def test_gateway_auth_failure_marks_source_for_reconnect(gw, model, as_user):
    _connect(gw, PLAIN.uid, "gmail", "googlecalendar")
    gw.fail["googlecalendar.list_events"] = oc.OpenConnectorError("token expired", "reauth_required", 401)
    d = as_user(PLAIN).post("/api/workbench/brief", json={"now": NOW}).json()
    assert {s["service"]: s["state"] for s in d["sources"]}["googlecalendar"] == "reauth_required"
    assert d["mails"] and d["events"] == []


def test_nothing_connected_skips_the_model(gw, monkeypatch, as_user):
    monkeypatch.setattr(llm, "complete", lambda **kw: pytest.fail("no model call without data"))
    d = as_user(PLAIN).post("/api/workbench/brief", json={"now": NOW}).json()
    assert d["summary"] is None and {s["state"] for s in d["sources"]} == {"not_connected"}


def test_todos_are_private_to_their_owner(fs, as_user):
    me, other = as_user(PLAIN), as_user(BUILDER)
    a = me.post("/api/workbench/todos", json={"text": " 準備會議資料 ", "due": "2026-11-05"}).json()
    me.post("/api/workbench/todos", json={"text": "回覆名單"})
    assert a["text"] == "準備會議資料" and not a["done"]
    assert other.get("/api/workbench/todos").json() == []
    assert other.patch(f"/api/workbench/todos/{a['id']}", json={"done": True}).status_code == 404
    assert other.delete(f"/api/workbench/todos/{a['id']}").status_code == 404
    assert me.patch(f"/api/workbench/todos/{a['id']}", json={"done": True}).json()["done"]
    assert [t["text"] for t in me.get("/api/workbench/todos").json()] == ["回覆名單", "準備會議資料"]  # done goes last
    assert me.delete(f"/api/workbench/todos/{a['id']}").status_code == 204
    assert me.post("/api/workbench/todos", json={"text": ""}).status_code == 422
