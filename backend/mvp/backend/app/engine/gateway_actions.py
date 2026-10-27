"""Generic connectors backed by any Open Connector service: which actions an admin allowed, least-privilege OAuth scopes derived
from them, argument coercion from the action's input schema, and the call itself."""
from __future__ import annotations

import json
from typing import Any

from . import open_connector as oc

IDENTITY_SCOPES = {"openid", "email", "profile"}  # needed to label the connected account; never a data permission
AUTH_MODES = {"oauth2": "user_oauth", "api_key": "shared", "custom_credential": "shared", "no_auth": "none"}


def mode_of(auth_mode: str) -> str | None:
    return AUTH_MODES.get(auth_mode)


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


def describe(config: dict) -> list[dict]:
    """Allowed actions in the shape the Studio tool node expects (args derived from the input schema)."""
    allowed = set(config.get("allowed_actions") or [])
    out = []
    for a in actions_of(config["service"]):
        if a["id"] not in allowed:
            continue
        props = (a["schema"].get("properties") or {})
        req = set(a["schema"].get("required") or [])
        out.append({"id": a["id"], "label": a["name"], "description": a["description"], "write": a["operation"] != "read", "operation": a["operation"],
                    "args": [{"key": k, "label": (v or {}).get("description") or k, "kind": "text", "required": k in req} for k, v in props.items()]})
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
