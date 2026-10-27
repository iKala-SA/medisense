"""Render a LiteLLM proxy config.yaml from the model registry (Firestore `models/{id}` rows).

Pure functions, no I/O. Structure mirrors mvp/litellm/config.yaml: one individually named entry per enabled
model, one alias entry per group (model_name = fast|reasoning|budget|sovereign) pointing at the group's primary,
and router_settings.fallbacks. Group primary = first enabled model of the group by name; the other members of the
group become that group's fallbacks; reasoning and budget additionally fall back to `fast` when it has members.
`sovereign` never gets a cloud fallback. Secrets are referenced by NAME only: secret_name -> the env var
os.environ/<UPPER_SNAKE(secret_name)>, which the LiteLLM Cloud Run service must mount from Secret Manager
(required_secrets() lists the pairs).
"""
import re

import yaml

GROUP_ORDER = ("fast", "reasoning", "budget", "sovereign")
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


def render(models: list[dict]) -> str:
    enabled = [m for m in models if m.get("enabled", True) and m.get("litellm_model")]
    by_group: dict[str, list[dict]] = {g: [] for g in GROUP_ORDER}
    for m in sorted(enabled, key=lambda m: (str(m.get("name", "")).lower(), str(m.get("id", "")))):
        if m.get("group") in by_group:
            by_group[m["group"]].append(m)

    model_list: list[dict] = []
    slugs: dict[int, str] = {}
    used: set[str] = set(GROUP_ORDER)
    for g in GROUP_ORDER:
        for m in by_group[g]:
            base, n = _slug(str(m.get("name", ""))), 2
            slug = base
            while slug in used:
                slug, n = f"{base}-{n}", n + 1
            used.add(slug)
            slugs[id(m)] = slug
            model_list.append({"model_name": slug, "litellm_params": _params(m),
                               "model_info": {"deploy": m.get("deploy", "cloud"), "group": g,
                                              "provider": m.get("provider", "")}})
    for g in GROUP_ORDER:
        if by_group[g]:
            model_list.append({"model_name": g, "litellm_params": _params(by_group[g][0])})

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
        "general_settings": {"master_key": "os.environ/LITELLM_MASTER_KEY"},
    }
    return HEADER + yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=120)
