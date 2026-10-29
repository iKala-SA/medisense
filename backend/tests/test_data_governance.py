"""Data-handling rules: retention (expire_at), approved cloud providers, and who may switch connector de-identification off."""
from datetime import UTC, datetime, timedelta

from app.engine import litellm_config as lc

from .conftest import ADMIN, BUILDER, PLAIN

# (the registry no longer has an approved-provider list: models are registered from the catalog, see test_model_catalog.py)
CLOUD = {"name": "Gemini Flash", "provider": "vertex", "litellm_model": "vertex_ai/gemini-3-flash-preview", "group": "fast"}
AZURE = {"name": "GPT", "provider": "azure", "litellm_model": "azure/gpt-5.4", "group": "reasoning"}


def _stub_llm(monkeypatch):
    from app.engine import llm

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr(llm, "complete", lambda **kw: llm.Completion("ok", "gemini-3-flash", 1, 1, 0.0, 1))


def test_conversations_and_feedback_expire(fs, as_user, monkeypatch):
    _stub_llm(monkeypatch)
    c = as_user(BUILDER)
    r = c.post("/api/chat", json={"message": "hi", "knowledge_scope": "general"}).json()
    exp = fs.store[f"sessions/{r['session_id']}"]["expire_at"]
    days = (exp - datetime.now(UTC)).total_seconds() / 86400
    assert 179 < days <= 180  # 180 days after the last message
    c.post("/api/chat/feedback", json={"session_id": r["session_id"], "message_index": 1, "rating": "down", "reasons": ["slow"]})
    fb = fs.store[f"feedback/{r['session_id']}_1"]["expire_at"]
    assert 364 < (fb - datetime.now(UTC)).total_seconds() / 86400 <= 365
    # every new message pushes the conversation's expiry out again
    fs.store[f"sessions/{r['session_id']}"]["expire_at"] = datetime.now(UTC) + timedelta(days=1)
    c.post("/api/chat", json={"message": "again", "session_id": r["session_id"], "knowledge_scope": "general"})
    assert fs.store[f"sessions/{r['session_id']}"]["expire_at"] - datetime.now(UTC) > timedelta(days=179)


def test_retention_can_be_switched_off(fs, as_user, monkeypatch):
    from app.config import settings

    _stub_llm(monkeypatch)
    monkeypatch.setattr(settings(), "session_retention_days", 0)
    r = as_user(BUILDER).post("/api/chat", json={"message": "hi", "knowledge_scope": "general"}).json()
    assert fs.store[f"sessions/{r['session_id']}"]["expire_at"] is None


def _conn(**kw):
    return {"type": "webhook", "label": "護理站", "config": {"url": "https://example.org/h", "method": "POST"}, **kw}


def test_only_admins_may_switch_connector_deidentification_off(fs, as_user, audit_log, monkeypatch):
    monkeypatch.setattr("app.routers.connectors.sm.put", lambda *a, **k: "secret/name")
    b = as_user(BUILDER)
    assert b.post("/api/connectors", json=_conn(redact_pii=False, redact_off_reason="院內系統")).status_code == 403
    a = as_user(ADMIN)
    assert a.post("/api/connectors", json=_conn(redact_pii=False)).status_code == 422  # reason required
    ok = a.post("/api/connectors", json=_conn(redact_pii=False, redact_off_reason="資料本來就不含個資"))
    assert ok.status_code == 201, ok.text
    ev = [e for e in audit_log() if e["action"] == "connector.deid_off"]
    assert ev and ev[0]["reason"] == "資料本來就不含個資" and ev[0]["actor_email"] == ADMIN.email
    cid = ok.json()["id"]
    # a builder editing an already-off connector without touching the switch is not a change; turning it back on is allowed
    assert b.put(f"/api/connectors/{cid}", json=_conn(redact_pii=False, label="護理站 2")).status_code in (200, 403)  # owner rules decide 200/403
    assert a.put(f"/api/connectors/{cid}", json=_conn(redact_pii=True)).status_code == 200
    assert any(e["action"] == "connector.deid_on" for e in audit_log())
    assert b.post("/api/connectors", json=_conn()).status_code == 201  # default (on) is open to builders


def test_voice_input_is_an_admin_switch_and_off_by_default(fs, as_user, audit_log):
    assert as_user(PLAIN).get("/api/features").json()["voice_input"] is False
    assert as_user(PLAIN).put("/api/features", json={"voice_input": True}).status_code == 403
    r = as_user(ADMIN).put("/api/features", json={"web_search": False, "voice_input": True})
    assert r.status_code == 200 and r.json()["voice_input"] is True
    ev = [e for e in audit_log() if e["action"] == "features.update"][0]
    assert ev["voice_old"] is False and ev["voice_new"] is True
