"""Generic connectors backed by any Open Connector service: which actions an admin allowed, least-privilege OAuth scopes derived
from them, argument coercion from the action's input schema, and the call itself."""
from __future__ import annotations

import json
from typing import Any

from ..config import settings
from . import open_connector as oc

IDENTITY_SCOPES = {"openid", "email", "profile"}  # needed to label the connected account; never a data permission
AUTH_MODES = {"oauth2": "user_oauth", "api_key": "shared", "custom_credential": "shared", "no_auth": "none"}
GOOGLE_SERVICES = {"gmail", "googlecalendar", "googledrive", "googledocs", "googlesheets", "googleslides", "googleforms", "googlemeet",
                   "googlechat", "googletasks", "google_bigquery"}
# Services the database-connector path uses (SQL guard, row cut, de-identification): their grant is held by the gateway like any
# other per-user OAuth service, but their actions are not offered to the model as plain connector tools.
DB_SERVICES = {"google_bigquery"}


def mode_of(auth_mode: str) -> str | None:
    return AUTH_MODES.get(auth_mode)


def platform_client(service: str) -> dict:
    """The platform-wide OAuth app for this service's vendor (Google only so far), or {} when none is configured."""
    s = settings()
    if service in GOOGLE_SERVICES and s.google_oauth_client_id and s.google_oauth_client_secret:
        return {"clientId": s.google_oauth_client_id, "clientSecret": s.google_oauth_client_secret}
    return {}


def actions_of(service: str) -> list[dict]:
    """Actions of a service: id, name, description, operation (read | write | destructive), required scopes, input schema."""
    return [{"id": a.get("id", ""), "name": a.get("name", ""), "description": a.get("description", ""),
             "operation": a.get("operationType", "read"), "scopes": a.get("requiredScopes") or [], "schema": a.get("inputSchema") or {}}
            for a in oc.provider_detail_cached(service).get("actions") or []]


def scopes_for(service: str, allowed_ids: list[str]) -> list[str]:
    """OAuth scopes to request = scopes the allowed actions need (as declared by the provider) + identity scopes. Nothing else."""
    detail = oc.provider_detail_cached(service)
    declared: set[str] = set()
    for a in detail.get("auth") or []:
        if a.get("type") == "oauth2":
            declared |= set(a.get("scopes") or []) | set(a.get("optionalScopes") or [])
    wanted: list[str] = []
    for a in actions_of(service):
        if a["id"] in allowed_ids:
            for sc in a["scopes"]:
                if sc not in wanted:
                    wanted.append(sc)
    chosen = [sc for sc in wanted if not declared or sc in declared]
    return chosen + [i for i in ("openid", "email") if i in declared and i not in chosen]


_SCHEMA_KEYS = ("type", "description", "enum", "properties", "required", "items")


def clean_schema(spec: Any, depth: int = 0) -> dict:
    """A JSON schema reduced to what every tool-calling model accepts (type, description, enum, properties, required, items).
    `anyOf`/`oneOf` keep their first branch; vendor keywords (format, minItems, additionalProperties, ...) are dropped."""
    if not isinstance(spec, dict) or depth > 6:
        return {"type": "string"}
    if not spec.get("type") and (spec.get("anyOf") or spec.get("oneOf")):
        first = (spec.get("anyOf") or spec.get("oneOf"))[0]
        return clean_schema({**first, **({"description": spec["description"]} if spec.get("description") else {})}, depth)
    out: dict = {k: spec[k] for k in _SCHEMA_KEYS if k in spec}
    if "properties" in spec and isinstance(spec["properties"], dict):
        out["type"] = "object"
        out["properties"] = {k: clean_schema(v, depth + 1) for k, v in spec["properties"].items()}
        out["required"] = [k for k in (spec.get("required") or []) if k in out["properties"]]
    elif out.get("type") == "object":
        out["properties"] = {}
    if out.get("type") == "array":
        out["items"] = clean_schema(spec.get("items") or {}, depth + 1)
    out.setdefault("type", "string")
    return out


def _structured(spec: dict) -> bool:
    return bool(spec) and (spec.get("type") in ("object", "array") or "properties" in spec or "items" in spec or "anyOf" in spec or "oneOf" in spec)


def describe(config: dict) -> list[dict]:
    """Allowed actions in the shape the Studio tool node expects (args derived from the input schema). Structured arguments
    (objects, arrays) are `kind: "textarea"` on the canvas (JSON) and carry their cleaned `schema` for the model."""
    allowed = set(config.get("allowed_actions") or [])
    out = []
    for a in actions_of(config["service"]):
        if a["id"] not in allowed:
            continue
        props = (a["schema"].get("properties") or {})
        req = set(a["schema"].get("required") or [])
        args = []
        for k, v in props.items():
            v = v if isinstance(v, dict) else {}
            arg = {"key": k, "label": v.get("description") or k, "kind": "textarea" if _structured(v) else "text", "required": k in req}
            if _structured(v):
                arg["schema"] = clean_schema(v)
            args.append(arg)
        out.append({"id": a["id"], "label": a["name"], "description": a["description"], "write": a["operation"] != "read", "operation": a["operation"],
                    "args": args})
    return out


def _coerce(value: Any, spec: dict) -> Any:
    """Tool-node arguments arrive as strings from the canvas; make them the type the action declares."""
    if not isinstance(value, str):
        return value
    t = (spec or {}).get("type")
    try:
        if t == "integer":
            return int(value.strip())
        if t == "number":
            return float(value.strip())
        if t == "boolean":
            return value.strip().lower() in ("1", "true", "yes", "y")
        if t in ("array", "object"):
            return json.loads(value)
    except (ValueError, json.JSONDecodeError):
        return value
    return value


def call(service: str, config: dict, connection: str | None, user_id: str | None, action: str, args: dict) -> str:
    full = action if "." in action else f"{service}.{action}"
    if full not in set(config.get("allowed_actions") or []):
        raise RuntimeError(f"此連接器未允許動作 {full}")
    meta = next((a for a in actions_of(service) if a["id"] == full), None)
    if not meta:
        raise RuntimeError(f"服務 {service} 沒有動作 {full}")
    props = meta["schema"].get("properties") or {}
    clean = {k: _coerce(v, props.get(k, {})) for k, v in args.items() if v not in ("", None)}
    try:
        out = oc.execute(full, clean, user_id, connection=connection)
    except oc.OpenConnectorError as exc:
        if exc.not_connected:
            raise RuntimeError("您尚未連線此服務，請先到「連接器」頁按「連線我的帳號」") from exc
        raise RuntimeError(f"連接器閘道錯誤：{exc}") from exc
    return json.dumps(out, ensure_ascii=False)[:8000]
