"""Client for the Open Connector gateway (https://github.com/oomol-lab/open-connector, pinned release).

The gateway owns every user's OAuth tokens and executes provider actions; this backend only decides *whose* connection a
call uses. One gateway "connection name" per signed-in user (`conn_name(uid)`), so a user can only ever reach their own
account. Tokens never reach this service, the browser or Firestore.

Gateway notes (verified against v1.9.4):
  POST /api/oauth/authorizations   {service, connectionName} -> {authorizationUrl, state}   (scopes: service-level config)
  GET  /v1/apps                    connected accounts: {id, service, alias, status, accountLabel, scopes}
  POST /v1/actions/{svc}.{action}?connectionName=...   body {"input": {...}}
  DELETE /api/connections/{svc}    {connectionName, revoke}
"""
from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from ..config import settings

TIMEOUT = 30.0


class OpenConnectorError(RuntimeError):
    def __init__(self, message: str, code: str = "", status: int = 0):
        super().__init__(message)
        self.code, self.status = code, status

    @property
    def not_connected(self) -> bool:
        return self.code in {"connection_not_found", "authorization_failed", "reauth_required"} or self.status in (403, 404)


def configured() -> bool:
    s = settings()
    return bool(s.open_connector_url and s.open_connector_token)


def conn_name(uid: str) -> str:
    """Stable gateway connection name for a user (letters, digits, - and _ only)."""
    return "u-" + re.sub(r"[^A-Za-z0-9_-]", "-", uid)[:60]


def _headers() -> dict[str, str]:
    s = settings()
    h = {"Authorization": f"Bearer {s.open_connector_token}", "Content-Type": "application/json"}
    if s.open_connector_iam_audience:  # Cloud Run IAM in front of the gateway; its own Authorization stays untouched
        import google.auth.transport.requests
        import google.oauth2.id_token
        tok = google.oauth2.id_token.fetch_id_token(google.auth.transport.requests.Request(), s.open_connector_iam_audience)
        h["X-Serverless-Authorization"] = f"Bearer {tok}"
    return h


def _request(method: str, path: str, *, json: Any = None, params: dict | None = None) -> Any:
    """One gateway call. Returns the unwrapped payload; raises OpenConnectorError with the gateway's error code."""
    if not configured():
        raise OpenConnectorError("Open Connector is not configured", "not_configured")
    try:
        r = httpx.request(method, settings().open_connector_url.rstrip("/") + path, headers=_headers(), json=json,
                          params=params, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise OpenConnectorError(f"gateway unreachable: {exc.__class__.__name__}", "unreachable") from exc
    try:
        body = r.json() if r.content else {}
    except ValueError:
        body = {}
    if r.status_code >= 400 or (isinstance(body, dict) and body.get("success") is False):
        err = body.get("error") if isinstance(body, dict) and isinstance(body.get("error"), dict) else {}
        msg = (err.get("message") or (body.get("message") if isinstance(body, dict) else "") or r.text[:200]) if body or r.text else "gateway error"
        code = err.get("code") or (body.get("errorCode") if isinstance(body, dict) else "") or ""
        # Input validation failures carry the exact problems (missing / unexpected fields) in `data`: pass them on.
        issues = [i.get("error", "") for i in (body.get("data") if isinstance(body, dict) else None) or [] if isinstance(i, dict) and i.get("error")]
        if issues:
            msg = f"{msg} {'; '.join(issues[:3])}"
        raise OpenConnectorError(str(msg)[:500], str(code), r.status_code)
    return body.get("data", body) if isinstance(body, dict) else body


def health() -> bool:
    try:
        r = httpx.get(settings().open_connector_url.rstrip("/") + "/health", timeout=5.0)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


def oauth_client_ready(service: str) -> bool:
    """True when an admin has stored the OAuth client (client id/secret) for this service in the gateway."""
    d = _request("GET", f"/v1/providers/{service}/setup")
    return bool((d.get("oauthClient") or {}).get("configured"))


def start_authorization(service: str, uid: str) -> dict:
    d = _request("POST", "/api/oauth/authorizations", json={"service": service, "connectionName": conn_name(uid)})
    url = d.get("authorizationUrl") or d.get("url")
    if not url:
        raise OpenConnectorError("gateway returned no authorization URL", "no_url")
    return {"url": url, "state": d.get("state", "")}


def connected_apps(service: str | None = None) -> list[dict]:
    apps = _request("GET", "/v1/apps")
    return [a for a in (apps or []) if not service or a.get("service") == service]


def connection(service: str, uid: str) -> dict | None:
    """The user's connected account for `service`, or None."""
    name = conn_name(uid)
    for a in connected_apps(service):
        if a.get("alias") == name:
            return a
    return None


def disconnect(service: str, uid: str, *, revoke: bool = True) -> None:
    _request("DELETE", f"/api/connections/{service}", json={"connectionName": conn_name(uid), "revoke": revoke})


def shared_name(connector_id: str) -> str:
    """Gateway connection holding the one credential every user of a shared-credential connector goes through."""
    return "s-" + re.sub(r"[^A-Za-z0-9_-]", "-", connector_id)[:60]


def execute(action_id: str, input_: dict, uid: str | None = None, *, connection: str | None = None) -> Any:
    """Run `<service>.<action>`. The connection is the user's own (`uid`), an explicit one (shared credential), or none (no_auth)."""
    name = connection or (conn_name(uid) if uid else None)
    d = _request("POST", f"/v1/actions/{action_id}", params={"connectionName": name} if name else None, json={"input": input_})
    return d.get("output", d) if isinstance(d, dict) else d


def _callback_target(path: str) -> str:
    """Map the public callback path to the gateway URL. In the cloud the gateway's origin is `<site>/api/oc`, so it expects every
    route under that prefix and OPEN_CONNECTOR_URL carries it; the browser's path already starts with the same prefix."""
    base = settings().open_connector_url.rstrip("/")
    prefix = urlparse(base).path.rstrip("/")
    return base + (path[len(prefix):] if prefix and path.startswith(prefix) else path)


def forward_callback(path: str, query: str) -> tuple[int, str, bytes]:
    """OAuth redirect from Google, relayed unchanged to the gateway (which holds the pending state)."""
    r = httpx.get(_callback_target(path) + (f"?{query}" if query else ""), headers=_headers(),
                  timeout=TIMEOUT, follow_redirects=False)
    return r.status_code, r.headers.get("content-type", "text/html; charset=utf-8"), r.content


# ------------------------------------------------------------------ Google Calendar helpers (read-only)
def _event_time(t: dict | None) -> tuple[str, bool]:
    t = t or {}
    return (t.get("dateTime") or t.get("date") or ""), "date" in t and "dateTime" not in t


def calendar_events(uid: str, time_min: str, time_max: str, *, calendar_id: str = "primary", max_results: int = 50) -> list[dict]:
    out = execute("googlecalendar.list_events", {"calendarId": calendar_id, "timeMin": time_min, "timeMax": time_max,
                                                 "maxResults": max_results, "orderBy": "startTime", "singleEvents": True}, uid)
    events = []
    for e in (out or {}).get("items", []):
        start, all_day = _event_time(e.get("start"))
        end, _ = _event_time(e.get("end"))
        events.append({"id": e.get("id", ""), "title": e.get("summary") or "（無標題）", "start": start, "end": end, "all_day": all_day,
                       "location": e.get("location", ""), "status": e.get("status", ""), "link": e.get("htmlLink", "")})
    return events


def calendar_busy(uid: str, time_min: str, time_max: str, *, calendar_id: str = "primary") -> list[dict]:
    out = execute("googlecalendar.free_busy_query", {"items": [{"id": calendar_id}], "timeMin": time_min, "timeMax": time_max}, uid)
    return ((out or {}).get("calendars", {}).get(calendar_id) or {}).get("busy", [])


# ------------------------------------------------------------------ provider catalog (everything the gateway supports)
_CATALOG_TTL = 300.0
_catalog: dict[str, Any] = {"at": 0.0, "items": []}


def providers(*, refresh: bool = False) -> list[dict]:
    """Every provider the gateway supports (~1,700): service, displayName, categories, authTypes, homepageUrl, iconUrl.
    Cached for five minutes; the list only changes when the gateway image is upgraded."""
    if refresh or time.monotonic() - _catalog["at"] > _CATALOG_TTL or not _catalog["items"]:
        data = _request("GET", "/v1/providers")
        _catalog.update(at=time.monotonic(), items=list(data or []))
    return _catalog["items"]


def reset_catalog_cache() -> None:
    _catalog.update(at=0.0, items=[])


def provider_detail(service: str) -> dict:
    """One provider with its actions (id, name, description, operationType, requiredScopes) and auth options."""
    return _request("GET", f"/api/providers/{service}")


# ------------------------------------------------------------------ enabling a service (admin)
def setup(service: str) -> dict:
    """Credential fields the gateway wants per auth option (oauth2 client fields, api_key / custom_credential fields)."""
    return _request("GET", f"/v1/providers/{service}/setup")


def save_oauth_client(service: str, values: dict, scopes: list[str], secret_keys: set[str]) -> dict:
    """Store the OAuth client for the service (service-wide) and the scopes every user's grant will request."""
    body: dict[str, Any] = {"requestedScopes": scopes}
    extra, secret_extra = {}, {}
    for k, v in values.items():
        if v in (None, ""):
            continue
        if k in ("clientId", "clientSecret"):
            body[k] = v
        elif k in secret_keys:
            secret_extra[k] = v
        else:
            extra[k] = v
    if extra:
        body["extra"] = extra
    if secret_extra:
        body["secretExtra"] = secret_extra
    if "clientId" not in body:
        cur = _request("GET", "/api/oauth/configs")
        body["clientId"] = next((c.get("clientId") for c in (cur or []) if c.get("service") == service and c.get("clientId")), None) or ""
        if not body["clientId"]:
            raise OpenConnectorError("clientId is required", "invalid_input", 422)
    return _request("PUT", f"/api/oauth/configs/{service}", json=body)


def save_shared_connection(service: str, auth_type: str, values: dict, name: str) -> dict:
    """Create or replace the shared credential connection. The gateway verifies the credential with the provider first."""
    return _request("PUT", f"/api/connections/{service}", json={"authType": auth_type, "connectionName": name,
                                                                "values": {k: v for k, v in values.items() if v not in (None, "")}})


def delete_shared_connection(service: str, name: str) -> None:
    _request("DELETE", f"/api/connections/{service}", json={"connectionName": name, "revoke": False})


_detail_cache: dict[str, tuple[float, dict]] = {}


def provider_detail_cached(service: str) -> dict:
    """Provider detail (actions with input schemas), cached ten minutes: it only changes with a gateway upgrade."""
    hit = _detail_cache.get(service)
    if hit and time.monotonic() - hit[0] < 600:
        return hit[1]
    d = provider_detail(service)
    _detail_cache[service] = (time.monotonic(), d)
    return d


def reset_detail_cache() -> None:
    _detail_cache.clear()
