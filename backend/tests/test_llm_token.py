"""The LiteLLM client's Cloud Run ID token: rebuilt before it expires, and one retry with a fresh token on a 401."""
import httpx
import openai
import pytest

from app.engine import llm


@pytest.fixture
def tokens(monkeypatch):
    issued = []

    def fake_id_token(audience):
        issued.append(f"tok-{len(issued) + 1}")
        return issued[-1]
    monkeypatch.setattr(llm, "_id_token", fake_id_token)
    monkeypatch.setattr(llm, "routing", type("R", (), {"sovereign_only": staticmethod(lambda: False), "model_armor": staticmethod(lambda: False),
                                                       "SMART_ROUTER": "smart-router"})())
    llm.reset_client_cache()
    yield issued
    llm.reset_client_cache()


def test_client_is_reused_then_rebuilt_after_the_ttl(tokens, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(llm.time, "monotonic", lambda: clock[0])
    a = llm._client()
    assert llm._client() is a and tokens == ["tok-1"]
    assert a.default_headers["X-Serverless-Authorization"] == "Bearer tok-1"
    clock[0] += llm.CLIENT_TTL + 1
    b = llm._client()
    assert b is not a and b.default_headers["X-Serverless-Authorization"] == "Bearer tok-2"


def _status_error(code):
    req = httpx.Request("POST", "http://litellm/v1/chat/completions")
    return openai.APIStatusError("Unauthorized", response=httpx.Response(code, request=req), body=None)


def test_a_401_fetches_a_fresh_token_and_retries_once(tokens, monkeypatch):
    calls = []

    def fake_send(client, request, on_delta, search, target, t0):
        calls.append(client.default_headers["X-Serverless-Authorization"])
        if len(calls) == 1:
            raise _status_error(401)
        return llm.Completion(text="ok", model="fast", prompt_tokens=1, completion_tokens=1, cost_usd=0.0, ms=1)
    monkeypatch.setattr(llm, "_send", fake_send)
    c = llm.complete(group="fast", system="s", messages=[{"role": "user", "content": "hi"}], agent_id="a", user_id="u")
    assert c.text == "ok" and calls == ["Bearer tok-1", "Bearer tok-2"]


def test_other_errors_are_not_retried(tokens, monkeypatch):
    calls = []

    def fake_send(*a):
        calls.append(1)
        raise _status_error(500)
    monkeypatch.setattr(llm, "_send", fake_send)
    with pytest.raises(openai.APIStatusError):
        llm.complete(group="fast", system="s", messages=[], agent_id="a", user_id="u")
    assert len(calls) == 1
