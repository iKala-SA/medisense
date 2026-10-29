"""Render a LiteLLM proxy config.yaml from the model registry (Firestore `models/{id}` rows).

Pure functions, no I/O. Structure mirrors litellm/config.yaml: one individually named entry per enabled
model, one alias entry per group (model_name = fast|reasoning|budget|sovereign) pointing at the group's primary,
and router_settings.fallbacks. Group primary = first enabled model of the group by name; the other members of the
group become that group's fallbacks; reasoning and budget additionally fall back to `fast` when it has members.
`sovereign` never gets a cloud fallback. Secrets are referenced by NAME only: secret_name -> the env var
os.environ/<UPPER_SNAKE(secret_name)>, which the LiteLLM Cloud Run service must mount from Secret Manager
(required_secrets() lists the pairs). When the admin enables the smart router (config/smart_router) a `smart-router`
entry is added: LiteLLM's rule-based complexity router, one registry model per difficulty tier. The Model Armor
guardrail is always included (opt-in per request).
"""
import re

import yaml

GROUP_ORDER = ("fast", "reasoning", "budget", "sovereign")
SMART_ROUTER = "smart-router"
SMART_TIERS = ("simple", "medium", "complex", "reasoning")  # config keys; LiteLLM wants them upper-cased
# Always rendered, mirrors litellm/config.yaml: Model Armor screens a request before routing when the request opts in
# (llm.complete does while the 路由 page switch is on). The template is env-driven (MODEL_ARMOR_* set by
# infra/03-deploy-litellm.sh), so it is not a registry setting.
MODEL_ARMOR = {"guardrail_name": "model-armor", "litellm_params": {
    "guardrail": "model_armor", "mode": "pre_call", "default_on": False,
    "template_id": "os.environ/MODEL_ARMOR_TEMPLATE_ID", "project_id": "os.environ/MODEL_ARMOR_PROJECT",
    "location": "os.environ/MODEL_ARMOR_LOCATION", "mask_request_content": False, "fail_on_error": True}}
HEADER = ("# Rendered from the model registry by the Agent Platform admin UI. Do not hand-edit: apply a new\n"
          "# registry version instead. Secrets are env references; mount them from Secret Manager (see platform docs).\n")


def env_name(secret_name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "_", secret_name).upper()


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "-", name.lower()).strip("-") or "model"


def _params(m: dict) -> dict:
    p: dict = {"model": m["litellm_model"]}
    if str(m["litellm_model"]).startswith("vertex_ai/"):
        p["vertex_project"] = "os.environ/VERTEX_PROJECT"
        p["vertex_location"] = "os.environ/VERTEX_LOCATION"
    elif str(m["litellm_model"]).startswith("bedrock/"):
        # Keyless Bedrock: LiteLLM swaps the service account's Google ID token for AWS credentials via the role in
        # BEDROCK_ROLE_ARN (infra/env.sh + 03-deploy-litellm.sh). Unset locally -> LiteLLM uses AWS_PROFILE_NAME.
        p["aws_region_name"] = "os.environ/BEDROCK_REGION"
        p["aws_role_name"] = "os.environ/BEDROCK_ROLE_ARN"
        p["aws_web_identity_token"] = "os.environ/BEDROCK_WEB_IDENTITY_TOKEN"
        p["aws_session_name"] = "tcvgh-litellm"
    if m.get("api_base"):
        p["api_base"] = m["api_base"]
    if m.get("secret_name"):
        p["api_key"] = f"os.environ/{env_name(m['secret_name'])}"
    return p


def required_secrets(models: list[dict]) -> list[dict[str, str]]:
    seen: dict[str, str] = {}
    for m in models:
        if m.get("enabled", True) and m.get("secret_name"):
            seen.setdefault(m["secret_name"], env_name(m["secret_name"]))
    return [{"secret": k, "env": v} for k, v in sorted(seen.items())]


def missing_groups(models: list[dict]) -> list[str]:
    """Groups agents rely on that have no enabled member. Deploying with any of these missing would leave
    agents that pick the group without a model, so apply refuses (sovereign is optional: it fails closed)."""
    have = {m.get("group") for m in models if m.get("enabled", True) and m.get("litellm_model")}
    return [g for g in ("fast", "reasoning", "budget") if g not in have]


def smart_router_problems(models: list[dict], smart: dict | None) -> list[str]:
    """Why an enabled smart router cannot be rendered: tiers that are unset or point at a missing/disabled model."""
    if not smart or not smart.get("enabled"):
        return []
    live = {m.get("id") for m in models if m.get("enabled", True) and m.get("litellm_model")}
    return [t for t in SMART_TIERS if smart.get(t) not in live]


def render(models: list[dict], smart: dict | None = None) -> str:
    enabled = [m for m in models if m.get("enabled", True) and m.get("litellm_model")]
    by_group: dict[str, list[dict]] = {g: [] for g in GROUP_ORDER}
    for m in sorted(enabled, key=lambda m: (str(m.get("name", "")).lower(), str(m.get("id", "")))):
        if m.get("group") in by_group:
            by_group[m["group"]].append(m)

    model_list: list[dict] = []
    slugs: dict[int, str] = {}
    slug_by_id: dict[str, str] = {}
    used: set[str] = {*GROUP_ORDER, SMART_ROUTER}
    for g in GROUP_ORDER:
        for m in by_group[g]:
            base, n = _slug(str(m.get("name", ""))), 2
            slug = base
            while slug in used:
                slug, n = f"{base}-{n}", n + 1
            used.add(slug)
            slugs[id(m)] = slug
            slug_by_id[str(m.get("id", ""))] = slug
            model_list.append({"model_name": slug, "litellm_params": _params(m),
                               "model_info": {"deploy": m.get("deploy", "cloud"), "group": g,
                                              "provider": m.get("provider", "")}})
    for g in GROUP_ORDER:
        if by_group[g]:
            model_list.append({"model_name": g, "litellm_params": _params(by_group[g][0])})

    if smart and smart.get("enabled") and not smart_router_problems(models, smart):
        tiers = {t.upper(): slug_by_id[smart[t]] for t in SMART_TIERS}
        model_list.append({"model_name": SMART_ROUTER, "litellm_params": {
            "model": "auto_router/complexity_router",
            "complexity_router_config": {"tiers": tiers, "classifier_type": "heuristic"},
            "complexity_router_default_model": tiers["MEDIUM"]}})

    fallbacks: list[dict] = []
    for g in GROUP_ORDER:
        if not by_group[g]:
            continue
        chain = [slugs[id(m)] for m in by_group[g][1:]]
        if g in ("reasoning", "budget") and by_group["fast"]:
            chain.append("fast")
        if chain:
            fallbacks.append({g: chain})
    router_settings: dict = {"routing_strategy": "simple-shuffle", "num_retries": 2, "timeout": 120,
                             "allowed_fails": 3, "cooldown_time": 60, "fallbacks": fallbacks}
    if by_group["fast"] and by_group["reasoning"]:
        router_settings["context_window_fallbacks"] = [{"fast": ["reasoning"]}]
    doc = {
        "model_list": model_list,
        "router_settings": router_settings,
        "litellm_settings": {"drop_params": True, "set_verbose": False, "request_timeout": 120},
        "guardrails": [MODEL_ARMOR],
        "general_settings": {"master_key": "os.environ/LITELLM_MASTER_KEY"},
    }
    return HEADER + yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=120)
