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
