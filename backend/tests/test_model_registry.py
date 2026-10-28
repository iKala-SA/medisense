from datetime import timedelta

import pytest
import yaml

from app import db
from app.engine import github_actions, llm
from app.engine import litellm_config as lc

from .conftest import ADMIN, BUILDER

CLOUD = {"name": "Gemini Flash", "provider": "vertex", "litellm_model": "vertex_ai/gemini-3-flash-preview", "group": "fast"}


def test_validation_rules(fs, as_user):
    c = as_user(ADMIN)
    assert c.post("/api/model-registry", json=CLOUD).status_code == 201
    assert c.post("/api/model-registry", json={**CLOUD, "deploy": "onprem"}).status_code == 422  # onprem not in fast
    assert c.post("/api/model-registry", json={**CLOUD, "group": "sovereign"}).status_code == 422  # cloud never sovereign
    ok = {**CLOUD, "name": "gpt-oss", "litellm_model": "openai/gpt-oss-120b", "group": "sovereign", "deploy": "onprem",
          "api_base": "http://10.0.0.5:8001/v1", "secret_name": "onprem-vllm-api-key"}
    assert c.post("/api/model-registry", json=ok).status_code == 201
    assert c.post("/api/model-registry", json={**CLOUD, "secret_name": "sk-real value!"}).status_code == 422
    assert c.post("/api/model-registry", json={**CLOUD, "input_price_per_m": -1}).status_code == 422
    assert as_user(BUILDER).get("/api/model-registry").status_code == 403
    mid = c.get("/api/model-registry").json()[0]["id"]
    assert c.put(f"/api/model-registry/{mid}", json={**CLOUD, "deploy": "onprem"}).status_code == 422
    assert c.delete(f"/api/model-registry/{mid}").status_code == 204


def test_render_structure():
    models = [
        {"id": "1", "name": "Gemini Flash", "litellm_model": "vertex_ai/gemini-3-flash-preview", "group": "fast", "deploy": "cloud"},
        {"id": "2", "name": "Gemini 2.5 Flash", "litellm_model": "vertex_ai/gemini-2.5-flash", "group": "fast", "deploy": "cloud"},
        {"id": "3", "name": "Gemini Pro", "litellm_model": "vertex_ai/gemini-3.1-pro-preview", "group": "reasoning", "deploy": "cloud"},
        {"id": "4", "name": "GPT-5.4", "litellm_model": "azure/gpt-5.4", "group": "budget", "deploy": "cloud", "secret_name": "azure-openai-api-key"},
        {"id": "5", "name": "gpt-oss", "litellm_model": "openai/gpt-oss-120b", "group": "sovereign", "deploy": "onprem",
         "api_base": "http://10.0.0.5:8001/v1", "secret_name": "onprem-vllm-api-key"},
        {"id": "6", "name": "Disabled", "litellm_model": "x/y", "group": "fast", "enabled": False},
    ]
    text = lc.render(models)
    cfg = yaml.safe_load(text)
    names = [m["model_name"] for m in cfg["model_list"]]
    assert {"fast", "reasoning", "budget", "sovereign"} <= set(names)
    assert "disabled" not in names
    alias = {m["model_name"]: m for m in cfg["model_list"]}
    assert alias["fast"]["litellm_params"]["model"] == "vertex_ai/gemini-2.5-flash"  # first by name
    assert alias["fast"]["litellm_params"]["vertex_project"] == "os.environ/VERTEX_PROJECT"
    assert alias["sovereign"]["litellm_params"]["api_base"] == "http://10.0.0.5:8001/v1"
    assert alias["sovereign"]["litellm_params"]["api_key"] == "os.environ/ONPREM_VLLM_API_KEY"
    fb = {k: v for d in cfg["router_settings"]["fallbacks"] for k, v in d.items()}
    assert fb["fast"] == ["gemini-flash"] and fb["reasoning"] == ["fast"] and fb["budget"] == ["fast"]
    assert "sovereign" not in fb  # never falls back to cloud
    assert cfg["general_settings"]["master_key"] == "os.environ/LITELLM_MASTER_KEY"
    assert cfg["router_settings"]["context_window_fallbacks"] == [{"fast": ["reasoning"]}]
    assert "REPLACE" not in text and "sk-" not in text
    assert lc.required_secrets(models) == [{"secret": "azure-openai-api-key", "env": "AZURE_OPENAI_API_KEY"},
                                           {"secret": "onprem-vllm-api-key", "env": "ONPREM_VLLM_API_KEY"}]


def test_render_empty_registry_is_valid():
    cfg = yaml.safe_load(lc.render([]))
    assert cfg["model_list"] == [] and cfg["router_settings"]["fallbacks"] == []


GROUPS3 = [{**CLOUD, "name": f"M {g}", "group": g} for g in ("fast", "reasoning", "budget")]


def test_save_rerenders(fs, as_user):
    c = as_user(ADMIN)
    mid = c.post("/api/model-registry", json=CLOUD).json()["id"]
    assert fs.store["config/litellm_render"]["version"] == 1
    assert "gemini-flash" in c.get("/api/model-registry/rendered").json()["yaml"]
    c.put(f"/api/model-registry/{mid}", json={**CLOUD, "name": "Renamed"})
    assert "renamed" in fs.store["config/litellm_render"]["yaml"]
    c.delete(f"/api/model-registry/{mid}")
    r = fs.store["config/litellm_render"]
    assert r["version"] == 3 and yaml.safe_load(r["yaml"])["model_list"] == []


@pytest.fixture
def gh(monkeypatch):
    """Stub GitHub: records dispatches; find_run returns whatever state.run holds."""
    state = type("S", (), {"dispatched": [], "run": None})()
    monkeypatch.setattr(github_actions, "dispatch", lambda v, who: state.dispatched.append((v, who)))
    monkeypatch.setattr(github_actions, "find_run", lambda v: state.run)
    return state


def test_apply_refuses_incomplete_registry(fs, as_user, gh):
    c = as_user(ADMIN)
    c.post("/api/model-registry", json=CLOUD)
    r = c.post("/api/model-registry/apply")
    assert r.status_code == 409 and "reasoning" in r.json()["detail"] and "budget" in r.json()["detail"]
    assert gh.dispatched == [] and "config/litellm_deploy" not in fs.store


def test_apply_dispatches_and_tracks_run(fs, as_user, audit_log, gh):
    c = as_user(ADMIN)
    for m in GROUPS3:
        c.post("/api/model-registry", json=m)
    r = c.post("/api/model-registry/apply").json()
    assert r["version"] == 4 and r["status"] == "dispatched"  # 3 saves + the apply render
    assert gh.dispatched == [(4, "admin@example.com")]
    assert fs.store["config/litellm_deploy"]["yaml"] == fs.store["config/litellm_render"]["yaml"]
    assert any(a["action"] == "model.apply" for a in audit_log())

    assert c.get("/api/model-registry/deploy").json()["status"] == "dispatched"  # run not visible yet
    gh.run = {"status": "in_progress", "conclusion": None, "html_url": "https://github.com/x/runs/1"}
    d = c.get("/api/model-registry/deploy").json()
    assert d["status"] == "deploying" and d["run_url"] == "https://github.com/x/runs/1"
    assert c.post("/api/model-registry/apply").status_code == 409  # one deploy at a time
    c.post("/api/model-registry", json={**CLOUD, "name": "Later"})  # saving mid-deploy leaves the snapshot alone
    assert fs.store["config/litellm_deploy"]["version"] == 4
    gh.run = {"status": "completed", "conclusion": "success", "html_url": "https://github.com/x/runs/1"}
    assert c.get("/api/model-registry/deploy").json()["status"] == "deployed"
    assert c.post("/api/model-registry/apply").status_code == 200 and gh.dispatched[-1][0] == 6


def test_apply_failed_run_and_never_started(fs, as_user, gh):
    c = as_user(ADMIN)
    for m in GROUPS3:
        c.post("/api/model-registry", json=m)
    c.post("/api/model-registry/apply")
    gh.run = {"status": "completed", "conclusion": "failure", "html_url": "u"}
    assert c.get("/api/model-registry/deploy").json()["status"] == "failed"
    gh.run = None
    c.post("/api/model-registry/apply")
    fs.store["config/litellm_deploy"]["requested_at"] = db.now() - timedelta(minutes=11)
    assert c.get("/api/model-registry/deploy").json()["status"] == "failed"


def test_apply_without_github_config_is_503(fs, as_user):
    c = as_user(ADMIN)
    for m in GROUPS3:
        c.post("/api/model-registry", json=m)
    r = c.post("/api/model-registry/apply")
    assert r.status_code == 503 and fs.store["config/litellm_deploy"]["status"] == "failed"
    assert as_user(BUILDER).post("/api/model-registry/apply").status_code == 403


def test_llm_prices_fall_back_to_registry(fs):
    assert llm.cost_usd("vertex_ai/gemini-3-flash-preview", 1_000_000, 0) == 0.5  # static table untouched
    assert llm.cost_usd("acme-super-1", 1_000_000, 1_000_000) == 0.0
    fs.put("models/m1", {"name": "Acme", "litellm_model": "openai/acme-super-1", "group": "budget", "enabled": True,
                         "input_price_per_m": 2.0, "output_price_per_m": 4.0})
    llm.reset_registry_cache()
    assert llm.cost_usd("acme-super-1", 1_000_000, 1_000_000) == 6.0
    assert llm.is_fallback("budget", "acme-super-1") is False  # registry primary of the group
    assert llm.is_fallback("budget", "something-else") is True


def test_registry_read_never_raises(monkeypatch):
    from app import db

    def boom():
        raise RuntimeError("no firestore")

    monkeypatch.setattr(db, "client", boom)
    llm.reset_registry_cache()
    assert llm.cost_usd("unknown-model", 10, 10) == 0.0
    assert llm.is_fallback("fast", "gemini-3-flash") is False
    llm.reset_registry_cache()
