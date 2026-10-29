from .conftest import ADMIN, BUILDER


def test_catalog_lists_models_and_registers_with_one_call(fs, as_user, audit_log):
    c = as_user(ADMIN)
    items = c.get("/api/model-registry/catalog").json()
    flash = next(i for i in items if i["key"] == "gemini-3-flash")
    assert not flash["registered"] and flash["deploy"] == "cloud"
    r = c.post("/api/model-registry/catalog/gemini-3-flash/register", json={})
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["litellm_model"] == "vertex_ai/gemini-3-flash-preview" and row["group"] == "fast" and row["enabled"]
    again = {i["key"]: i for i in c.get("/api/model-registry/catalog").json()}["gemini-3-flash"]
    assert again["registered"] and again["registered_id"] == row["id"]
    assert c.post("/api/model-registry/catalog/gemini-3-flash/register", json={}).status_code == 409  # already registered
    assert "model.register" in {a["action"] for a in audit_log()}
    assert fs.store["config/litellm_render"]["version"] == 1  # LiteLLM config re-rendered, not yet applied


def test_on_prem_catalog_entry_needs_its_server_address(fs, as_user):
    c = as_user(ADMIN)
    assert c.post("/api/model-registry/catalog/gpt-oss-120b/register", json={}).status_code == 422
    r = c.post("/api/model-registry/catalog/gpt-oss-120b/register", json={"api_base": "http://10.0.0.5:8001/v1"})
    assert r.status_code == 201 and r.json()["deploy"] == "onprem" and r.json()["group"] == "sovereign"
    assert c.post("/api/model-registry/catalog/nope/register", json={}).status_code == 404


def test_catalog_is_admin_only_and_any_provider_can_be_applied(fs, as_user):
    assert as_user(BUILDER).get("/api/model-registry/catalog").status_code == 403
    assert as_user(BUILDER).post("/api/model-registry/catalog/gemini-3-flash/register", json={}).status_code == 403
    c = as_user(ADMIN)
    # no provider approval step any more: an Azure model saves enabled, and the old endpoint is gone
    azure = {"name": "GPT", "provider": "azure", "litellm_model": "azure/gpt-5.4", "group": "reasoning"}
    assert c.post("/api/model-registry", json=azure).status_code == 201
    assert c.get("/api/model-registry/providers").status_code in (404, 405, 422)


def test_claude_models_come_through_vertex_and_azure_needs_its_three_fields(fs, as_user):
    c = as_user(ADMIN)
    r = c.post("/api/model-registry/catalog/claude-sonnet-5-5/register", json={})
    assert r.status_code == 201 and r.json()["litellm_model"] == "vertex_ai/claude-sonnet-5-5" and not r.json()["secret_name"]
    az = "/api/model-registry/catalog/azure-openai/register"
    assert c.post(az, json={"api_base": "https://x.openai.azure.com", "secret_name": "azure-key"}).status_code == 422  # no deployment
    assert c.post(az, json={"deployment": "gpt-5", "secret_name": "azure-key"}).status_code == 422  # no endpoint
    assert c.post(az, json={"deployment": "gpt-5", "api_base": "https://x.openai.azure.com"}).status_code == 422  # no secret name
    assert c.post(az, json={"deployment": "gpt-5", "api_base": "https://x.openai.azure.com", "secret_name": "sk-real key!"}).status_code == 422
    ok = c.post(az, json={"deployment": "gpt-5", "api_base": "https://x.openai.azure.com", "secret_name": "azure-key"})
    assert ok.status_code == 201, ok.text
    row = ok.json()
    assert row["litellm_model"] == "azure/gpt-5" and row["secret_name"] == "azure-key" and row["name"].endswith("（gpt-5）")
    assert c.post(az, json={"deployment": "gpt-5", "api_base": "https://x.openai.azure.com", "secret_name": "azure-key"}).status_code == 409
    assert c.post(az, json={"deployment": "gpt-5-mini", "api_base": "https://x.openai.azure.com", "secret_name": "azure-key"}).status_code == 201
    yaml = fs.store["config/litellm_render"]["yaml"]
    assert "azure/gpt-5" in yaml and "AZURE_KEY" in yaml and "vertex_ai/claude-sonnet-5-5" in yaml
