"""Thin client to the LiteLLM proxy (column D).

Two auth layers when LiteLLM runs on Cloud Run with internal ingress + IAM:
  * Cloud Run IAM: a Google ID token for the LiteLLM URL audience, sent in
    `X-Serverless-Authorization` so it does not collide with LiteLLM's own `Authorization` key.
  * LiteLLM: the master/virtual key in `Authorization: Bearer`.
Locally (http://localhost:4000) the ID token step is skipped.
"""
import time
from dataclasses import dataclass
from functools import lru_cache

import google.auth.transport.requests
import google.oauth2.id_token
from openai import OpenAI

from ..config import settings
from . import routing

_SKIP_IAM_PREFIXES = ("http://localhost", "http://127.0.0.1")

# Our own price table, USD per 1M tokens (input, output), keyed by a substring of the served model id.
# LiteLLM's response-cost header is not used (MVP decision 2026-10-25); first match wins, so keep
# the more specific ids first. TODO: verify against the Vertex AI pricing page before billing anyone.
PRICES: tuple[tuple[str, float, float], ...] = (
    ("gemini-3.1-pro", 2.00, 12.00),
    ("gemini-3-flash", 0.50, 3.00),
    ("gemini-2.5-pro", 1.25, 10.00),
    ("gemini-2.5-flash", 0.30, 2.50),
    ("claude-sonnet", 3.00, 15.00),
    ("claude-haiku", 1.00, 5.00),
    ("gpt-5", 1.25, 10.00),
    ("nova-2-lite", 0.06, 0.24),
    ("gpt-oss", 0.0, 0.0),  # on-prem vLLM: no per-token charge
    ("gemma", 0.0, 0.0),
)
# Primary model per group, mirrors litellm/config.yaml. A served model outside this is a fallback.
PRIMARY: dict[str, str] = {"fast": "gemini-3-flash", "reasoning": "gemini-3.1-pro", "budget": "gemini-3-flash", "sovereign": "gemma-4-12b"}


def normalize_model(model: str) -> str:
    """'vertex_ai/gemini-3-flash-preview' -> 'gemini-3-flash-preview'."""
    return model.rsplit("/", 1)[-1]


_REGISTRY_TTL = 300.0
_registry_cache: tuple[float, list[dict]] | None = None


def _registry() -> list[dict]:
    """Enabled `models/{id}` registry rows (routers/model_registry.py), cached 5 min. Never raises: any
    Firestore problem yields [] (cached, so a broken read is not retried on every call)."""
    global _registry_cache
    if _registry_cache and time.monotonic() - _registry_cache[0] < _REGISTRY_TTL:
        return _registry_cache[1]
    rows: list[dict] = []
    try:
        from .. import db

        rows = [d.to_dict() or {} for d in db.client().collection("models").stream()]
        rows = sorted((r for r in rows if r.get("enabled", True) and r.get("litellm_model")),
                      key=lambda r: (str(r.get("name", "")).lower()))
    except Exception:  # noqa: BLE001 - pricing must never break a run
        rows = []
    _registry_cache = (time.monotonic(), rows)
    return rows


def reset_registry_cache() -> None:
    global _registry_cache, _catalog_cache
    _registry_cache = _catalog_cache = None


def _registry_match(m: str) -> dict | None:
    for r in _registry():
        if normalize_model(str(r["litellm_model"])) in m or m in normalize_model(str(r["litellm_model"])):
            return r
    return None


ONPREM_PROVIDERS = ("ollama", "ollama_chat", "hosted_vllm", "vllm")  # LiteLLM prefixes that only ever point inside the hospital


def is_onprem(model: str) -> bool:
    """True when a pinned model_name is served on-prem: the gateway catalog shows an on-prem provider prefix for it
    (covers hand-written config entries too), or an admin registry row with deploy=onprem renders to that name
    (the renderer slugs the row's name) or to the same LiteLLM model."""
    from .litellm_config import _slug  # pure module, no I/O

    target = next((str(c["model"]) for c in model_catalog() if c["id"] == model), "")
    if target.split("/", 1)[0] in ONPREM_PROVIDERS:
        return True
    return any(r.get("deploy") == "onprem" and (_slug(str(r.get("name", ""))) == model or (target and str(r.get("litellm_model")) == target))
               for r in _registry())


def cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    m = normalize_model(model)
    for needle, p_in, p_out in PRICES:
        if needle in m:
            return round((prompt_tokens * p_in + completion_tokens * p_out) / 1e6, 6)
    r = _registry_match(m) if m else None  # model unknown to PRICES: use the admin registry's prices
    if r:
        try:
            return round((prompt_tokens * float(r.get("input_price_per_m") or 0)
                          + completion_tokens * float(r.get("output_price_per_m") or 0)) / 1e6, 6)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _primary(group: str) -> list[str]:
    """Primary model ids for a group: the static table plus the registry's first enabled model of the group."""
    out = [PRIMARY[group]] if PRIMARY.get(group) else []
    first = next((r for r in _registry() if r.get("group") == group), None)
    if first:
        out.append(normalize_model(str(first["litellm_model"])))
    return out


def is_fallback(group: str, model: str) -> bool:
    primaries = _primary(group)
    m = normalize_model(model)
    return bool(primaries) and not any(p in m for p in primaries)


@dataclass(frozen=True)
class Completion:
    text: str
    model: str  # served model (normalized), may differ from the group's primary on fallback
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    ms: int
    reasoning: str = ""  # the model's own thought summary when it returns one (empty otherwise)
    tool_calls: tuple = ()  # ({id, name, arguments: JSON string}, ...) when the model chose to call tools
    sources: tuple = ()  # ({title, url}, ...) web pages a grounded (search=True) answer relied on
    search_queries: tuple = ()  # what Google was actually asked


def _id_token(audience: str) -> str | None:
    if audience.startswith(_SKIP_IAM_PREFIXES):
        return None
    req = google.auth.transport.requests.Request()
    return google.oauth2.id_token.fetch_id_token(req, audience)


@lru_cache
def _client() -> OpenAI:
    s = settings()
    headers = {}
    tok = _id_token(s.litellm_base_url)
    if tok:
        headers["X-Serverless-Authorization"] = f"Bearer {tok}"
    return OpenAI(base_url=f"{s.litellm_base_url.rstrip('/')}/v1", api_key=s.litellm_api_key,
                  default_headers=headers, timeout=120)


MAX_THINKING_CHARS = 8000


def complete(*, group: str, system: str, messages: list[dict], agent_id: str, user_id: str,
             temperature: float = 0.3, top_p: float | None = None, json_mode: bool = False,
             think: str | None = None, model: str | None = None, on_delta=None, tools: list[dict] | None = None,
             search: bool = False) -> Completion:
    """One chat completion through the proxy. `group` is a LiteLLM model group alias, `smart-router`, or "auto";
    `model` pins one exact LiteLLM model_name instead (the user picked it in the chat box). `on_delta(kind, text)`
    turns on streaming: kind is "text" (answer tokens) or "thought" (thought-summary tokens).
    While the 路由 page's Model Armor switch is on, the gateway screens the request first; a blocked prompt raises
    openai.BadRequestError ("Content blocked by Model Armor")."""
    if group == "auto" and not model:  # flow.pick_group resolves it already; direct callers get the same answer
        group = routing.resolve_auto().group
    if group not in GROUPS and group != routing.SMART_ROUTER and not model:
        group = "fast"
    if routing.sovereign_only():  # 僅本地模型 backstop: callers already pick sovereign, but no path may reach a cloud group
        group, model = "sovereign", None
    client = _client()
    t0 = time.perf_counter()
    kwargs: dict = {}
    if top_p is not None:
        kwargs["top_p"] = top_p
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if search:  # Gemini's built-in Google Search grounding (a Gemini-only tool; used by the agent's web_search tool)
        kwargs["tools"] = [{"googleSearch": {}}]
    elif tools:  # the model decides which of these to call (engine/agent.py runs the loop)
        kwargs["tools"], kwargs["tool_choice"] = tools, "auto"
    if think:  # low | medium | high: ask thinking-capable models to return their thought summary (others ignore it: drop_params)
        kwargs["reasoning_effort"] = think
    extra: dict = {"metadata": {"agent_id": agent_id, "model_group": group, "tags": [f"agent:{agent_id}"]}}
    if routing.model_armor():  # the guardrail is opt-in per request (default_on: false in litellm/config.yaml)
        extra["guardrails"] = [routing.MODEL_ARMOR_GUARDRAIL]
    target = model or group
    request = dict(
        model=target,
        messages=[{"role": "system", "content": system}, *messages],
        temperature=temperature,
        user=user_id,
        # LiteLLM reads metadata for spend attribution and tag-based routing.
        extra_body=extra,
        **kwargs,
    )
    if on_delta:
        text, reasoning, served, usage, calls = _stream(client, request, on_delta)
        sources, queries = (), ()
    else:
        raw = client.chat.completions.with_raw_response.create(**request)
        resp = raw.parse()
        msg = resp.choices[0].message
        text = msg.content or ""
        reasoning = _reasoning_of(msg)
        # smart-router answers with model="smart-router"; the header names the deployment that really served it.
        served, usage = raw.headers.get("x-litellm-model-name") or getattr(resp, "model", None), getattr(resp, "usage", None)
        calls = tuple({"id": t.id, "name": t.function.name, "arguments": t.function.arguments or "{}"} for t in (getattr(msg, "tool_calls", None) or []))
        sources, queries = _grounding(resp, msg) if search else ((), ())
    model = normalize_model(served or target)
    p_tok = int(getattr(usage, "prompt_tokens", 0) or 0)
    c_tok = int(getattr(usage, "completion_tokens", 0) or 0)
    return Completion(text=text, model=model, prompt_tokens=p_tok, completion_tokens=c_tok,
                      cost_usd=cost_usd(model, p_tok, c_tok), ms=int((time.perf_counter() - t0) * 1000),
                      reasoning=reasoning[:MAX_THINKING_CHARS], tool_calls=calls, sources=sources, search_queries=queries)


def _grounding(resp, msg) -> tuple[tuple, tuple]:
    """(sources, search queries) of a Google-Search-grounded reply: the page titles/URLs and what Google was asked."""
    out: dict[str, str] = {}
    for a in getattr(msg, "annotations", None) or []:
        c = getattr(a, "url_citation", None) or (a.get("url_citation") if isinstance(a, dict) else None)
        url = getattr(c, "url", None) or (c.get("url") if isinstance(c, dict) else None)
        title = getattr(c, "title", None) or (c.get("title") if isinstance(c, dict) else None)
        if url:
            out.setdefault(str(url), str(title or url))
    meta = (getattr(resp, "model_extra", None) or {}).get("vertex_ai_grounding_metadata") or []
    queries = tuple(dict.fromkeys(q for m in meta if isinstance(m, dict) for q in m.get("webSearchQueries", [])))
    return tuple({"title": t, "url": u} for u, t in out.items()), queries


def _reasoning_of(obj) -> str:
    return str(getattr(obj, "reasoning_content", None) or (getattr(obj, "model_extra", None) or {}).get("reasoning_content") or "")


def _stream(client: OpenAI, request: dict, on_delta) -> tuple[str, str, str | None, object, tuple]:
    """Same call with stream=True: forwards tokens to on_delta, returns (text, thought, served model, usage, tool calls)."""
    parts: list[str] = []
    thoughts: list[str] = []
    calls: dict[int, dict] = {}
    raw = client.chat.completions.with_raw_response.create(**request, stream=True, stream_options={"include_usage": True})
    header = raw.headers.get("x-litellm-model-name")  # the real deployment behind smart-router (chunks say "smart-router")
    served, usage = None, None
    for chunk in raw.parse():
        served = header or getattr(chunk, "model", None) or served
        usage = getattr(chunk, "usage", None) or usage
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        for tc in delta.tool_calls or []:  # arguments may arrive in pieces; the id/name arrive once
            slot = calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
            slot["id"] = tc.id or slot["id"]
            slot["name"] = (tc.function.name if tc.function and tc.function.name else slot["name"])
            slot["arguments"] += (tc.function.arguments or "") if tc.function else ""
        if t := _reasoning_of(delta):
            thoughts.append(t)
            on_delta("thought", t)
        if delta.content:
            parts.append(delta.content)
            on_delta("text", delta.content)
    return "".join(parts), "".join(thoughts), served, usage, tuple(calls[i] for i in sorted(calls))


def reset_client_cache() -> None:
    """ID tokens expire after 1h; call when a 401 comes back from Cloud Run."""
    _client.cache_clear()


GROUPS = ("fast", "reasoning", "budget", "sovereign")  # real LiteLLM model_name aliases
SELECTABLE_GROUPS = (*GROUPS, "auto")  # what agents and nodes can select; "auto" = smart-router or fast (engine/routing.py)
_ROUTING_TTL = 300.0
_routing_cache: tuple[float, list[dict]] | None = None


def _proxy_get(path: str):
    import httpx

    s = settings()
    headers = {"Authorization": f"Bearer {s.litellm_api_key}"}
    tok = _id_token(s.litellm_base_url)
    if tok:
        headers["X-Serverless-Authorization"] = f"Bearer {tok}"
    with httpx.Client(timeout=10, headers=headers) as h:
        return h.get(f"{s.litellm_base_url.rstrip('/')}{path}").raise_for_status().json()


_catalog_cache: tuple[float, list[dict]] | None = None


def model_catalog() -> list[dict]:
    """Individual models the proxy can serve right now (every LiteLLM model_name that is not a group alias):
    [{id, model}]. The chat box lists these so a pick is the exact model that answers. Cached 5 min; [] on any
    proxy problem (the box then offers Auto and the groups only)."""
    global _catalog_cache
    if _catalog_cache and time.monotonic() - _catalog_cache[0] < _ROUTING_TTL:
        return _catalog_cache[1]
    try:
        info = _proxy_get("/model/info").get("data", [])
    except Exception:  # noqa: BLE001 - listing must never break the chat page
        info = []
    seen: dict[str, str] = {}
    for m in info:
        name = str(m.get("model_name") or "")
        if name and name not in SELECTABLE_GROUPS and name != routing.SMART_ROUTER:
            seen.setdefault(name, str((m.get("litellm_params") or {}).get("model") or name))
    out = [{"id": k, "model": v, **_registry_card(k, v)} for k, v in sorted(seen.items())]
    _catalog_cache = (time.monotonic(), out)
    return out


def _registry_card(model_name: str, litellm_model: str) -> dict:
    """What the admin 模型 page shows for this served model (name, provider, deploy, group), so the chat box can
    list it with the same words. Matched the way the renderer names entries (slug of the row's name) or by the
    LiteLLM model id; {} for a hand-written config entry that is not in the registry."""
    from .litellm_config import _slug  # pure module, no I/O

    rows = _registry()
    # Two rows may share one LiteLLM model (e.g. "Gemini 3 Flash" in fast and "Gemini 3 Flash (budget)"), so the slug
    # of the row's name, which is what the renderer uses as model_name, wins over a model-id match.
    hit = (next((r for r in rows if _slug(str(r.get("name", ""))) == model_name), None)
           or next((r for r in rows if str(r.get("litellm_model")) == litellm_model), None))
    if hit is None:
        return {}
    return {"name": str(hit.get("name") or model_name), "provider": str(hit.get("provider") or ""),
            "deploy": str(hit.get("deploy") or "cloud"), "group": str(hit.get("group") or "")}


def _gateway() -> tuple[list[dict], list[dict]]:
    """Live LiteLLM /model/info entries and /router/settings fields."""
    import httpx

    s = settings()
    headers = {"Authorization": f"Bearer {s.litellm_api_key}"}
    tok = _id_token(s.litellm_base_url)
    if tok:
        headers["X-Serverless-Authorization"] = f"Bearer {tok}"
    base = s.litellm_base_url.rstrip("/")
    with httpx.Client(timeout=10, headers=headers) as h:
        info = h.get(f"{base}/model/info").raise_for_status().json().get("data", [])
        fields = h.get(f"{base}/router/settings").raise_for_status().json().get("fields", [])
    return info, fields


_models_cache: tuple[float, frozenset[str]] | None = None


def gateway_models() -> frozenset[str]:
    """model_names the live gateway serves, cached 5 min. Never raises: an unreachable gateway yields an empty set
    (retried after 30 s), so "auto" degrades to `fast` instead of failing the run here."""
    global _models_cache
    if _models_cache and time.monotonic() - _models_cache[0] < _ROUTING_TTL:
        return _models_cache[1]
    now = time.monotonic()
    try:
        names = frozenset(str(m.get("model_name", "")) for m in _gateway()[0])
    except Exception:  # noqa: BLE001 - see docstring
        names, now = frozenset(), now - _ROUTING_TTL + 30  # retry after 30 s
    _models_cache = (now, names)
    return names


def routing_table() -> list[dict]:
    """What each selectable group really runs, read from the live LiteLLM proxy (/model/info +
    /router/settings) so the Studio labels cannot drift from litellm/config.yaml. Cached 5 min.
    [{id, models: [provider model ids], fallbacks: [{name, models}], configured}]"""
    global _routing_cache
    if _routing_cache and time.monotonic() - _routing_cache[0] < _ROUTING_TTL:
        return _routing_cache[1]
    info, fields = _gateway()
    members: dict[str, list[str]] = {}
    for m in info:
        model = str((m.get("litellm_params") or {}).get("model") or "")
        members.setdefault(m.get("model_name", ""), []).append(model.split("/", 1)[-1])
    chains: dict[str, list[str]] = {}
    for f in fields:
        if f.get("field_name") == "fallbacks":
            for entry in f.get("field_value") or []:
                chains.update({k: list(v) for k, v in entry.items()})
    table = [{"id": g, "models": members.get(g, []), "configured": bool(members.get(g)),
              "fallbacks": [{"name": n, "models": members.get(n, [])} for n in chains.get(g, [])]} for g in GROUPS]
    _routing_cache = (time.monotonic(), table)
    return table
