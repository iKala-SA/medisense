import pytest

from app.engine import tts

from .conftest import ADMIN, BUILDER


@pytest.fixture
def voice_on(fs):
    fs.put("config/features", {"voice_input": True})


def test_voices_are_listed_for_everyone_and_say_whether_voice_is_enabled(fs, as_user):
    r = as_user(BUILDER).get("/api/tts/voices").json()
    assert r["enabled"] is False and r["default"] == tts.DEFAULT_VOICE
    assert {v["group"] for v in r["voices"]} == {"chirp", "wavenet"} and len(r["voices"]) >= 10
    fs.put("config/features", {"voice_input": True})
    assert as_user(BUILDER).get("/api/tts/voices").json()["enabled"] is True


def test_speaking_needs_the_admin_switch_a_known_voice_and_is_audited_without_the_text(fs, as_user, audit_log, monkeypatch):
    calls = []
    monkeypatch.setattr("app.routers.tts.tts.synthesize", lambda text, voice, rate=1.0: calls.append((text, voice, rate)) or b"MP3DATA")
    body = {"text": "高血壓要定期量血壓", "voice": tts.DEFAULT_VOICE}
    assert as_user(BUILDER).post("/api/tts", json=body).status_code == 403  # switch off
    fs.put("config/features", {"voice_input": True})
    r = as_user(BUILDER).post("/api/tts", json=body)
    assert r.status_code == 200 and r.content == b"MP3DATA" and r.headers["content-type"] == "audio/mpeg" and r.headers["cache-control"] == "no-store"
    assert as_user(BUILDER).post("/api/tts", json={**body, "voice": "not-a-voice"}).status_code == 422
    assert as_user(BUILDER).post("/api/tts", json={"text": ""}).status_code == 422
    a = [x for x in audit_log() if x["action"] == "tts.speak"][-1]
    assert a["chars"] == len(body["text"]) and "高血壓" not in str(a) and calls == [(body["text"], tts.DEFAULT_VOICE, 1.0)]


def test_google_failure_becomes_502_so_the_browser_can_fall_back(fs, as_user, voice_on, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("quota")
    monkeypatch.setattr("app.routers.tts.tts.synthesize", boom)
    assert as_user(BUILDER).post("/api/tts", json={"text": "hi"}).status_code == 502


def test_voice_chat_asks_for_short_spoken_answers_on_the_fast_group(fs, as_user, monkeypatch):
    seen = []
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr("app.routers.runs.agent_runtime.run_agent", lambda agent, **kw: seen.append((agent.model_group, kw["extra_context"])) or (_ for _ in ()).throw(RuntimeError("stop")))
    for body in ({"message": "hi", "model_group": "reasoning"}, {"message": "hi", "model_group": "reasoning", "voice": True}):
        try:
            as_user(BUILDER).post("/api/chat", json={**body, "knowledge_scope": "general"})
        except RuntimeError:
            pass
    assert seen[0][0] == "reasoning" and "語音對話" not in seen[0][1]
    assert seen[1][0] == "fast" and "語音對話" in seen[1][1] and "Markdown" in seen[1][1]
