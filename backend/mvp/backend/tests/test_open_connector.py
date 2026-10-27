"""Per-user Google Calendar through the Open Connector gateway. The gateway is faked at its HTTP boundary
(`open_connector._request`), so these tests check *our* rules: who can see/connect/use what, and that a call is always made as
the signed-in user."""
import json

import pytest

from app import config
from app.engine import connectors, open_connector as oc

from .conftest import ADMIN, BUILDER, PLAIN

CAL_CFG = {"allowed_actions": ["list_calendars", "list_events", "free_busy_query"]}


class FakeGateway:
    """Records calls; `apps` is what GET /v1/apps returns."""

    def __init__(self):
        self.calls, self.apps, self.client_ready, self.fail = [], [], True, None

    def __call__(self, method, path, *, json=None, params=None):
        self.calls.append((method, path, json, params))
        if self.fail:
            raise self.fail
        if path == "/v1/apps":
            return self.apps
        if path.endswith("/setup"):
            return {"oauthClient": {"configured": self.client_ready}}
        if path == "/api/oauth/authorizations":
            return {"authorizationUrl": f"https://accounts.google.com/auth?name={json['connectionName']}", "state": "st-1"}
        if path.startswith("/v1/actions/googlecalendar.list_events"):
            return {"items": [{"id": "e1", "summary": "Medisense Sync", "start": {"dateTime": "2026-10-28T10:00:00+08:00"},
                               "end": {"dateTime": "2026-10-28T10:30:00+08:00"}}, {"id": "e2", "summary": "Office", "start": {"date": "2026-10-28"}, "end": {"date": "2026-10-29"}}]}
        if path.startswith("/v1/actions/googlecalendar.free_busy_query"):
            return {"calendars": {"primary": {"busy": [{"start": "2026-10-28T02:00:00Z", "end": "2026-10-28T02:30:00Z"}]}}}
        if path.startswith("/v1/actions/"):
            return {"items": []}
        return {}


@pytest.fixture
def gw(monkeypatch):
    monkeypatch.setenv("OPEN_CONNECTOR_URL", "http://oc.test")
    monkeypatch.setenv("OPEN_CONNECTOR_TOKEN", "t")
    config.settings.cache_clear()
    g = FakeGateway()
    monkeypatch.setattr(oc, "_request", g)
    yield g
    config.settings.cache_clear()


@pytest.fixture
def calendar_connector(fs, as_user):
    """An admin-created, account-wide Google Calendar connector."""
    c = as_user(ADMIN)
    made = c.post("/api/connectors", json={"type": "calendar", "label": "Google Calendar", "config": CAL_CFG}).json()
    c.put(f"/api/connectors/{made['id']}/share", json={"access": "account", "role": "use", "members": []})
    return made["id"]


def test_catalog_marks_calendar_available_and_per_user():
    spec = connectors.TYPES["calendar"]
    assert spec["available"] and connectors.is_user_oauth("calendar") and connectors.user_oauth_types() == ["calendar"]
    assert all(not a["write"] for a in spec["actions"])  # first version is read-only


def test_conn_name_is_stable_and_safe():
    assert oc.conn_name("abc123") == "u-abc123" and oc.conn_name("a b/c@d") == "u-a-b-c-d"


def test_only_admins_manage_user_oauth_connectors(fs, as_user):
    assert as_user(BUILDER).post("/api/connectors", json={"type": "calendar", "label": "x"}).status_code == 403
    assert as_user(ADMIN).post("/api/connectors", json={"type": "calendar", "label": "x"}).status_code == 201


def test_my_connectors_respects_sharing(fs, as_user, gw):
    c = as_user(ADMIN)
    cid = c.post("/api/connectors", json={"type": "calendar", "label": "Cal", "config": CAL_CFG}).json()["id"]
    assert as_user(PLAIN).get("/api/my-connectors").json() == []  # private until shared
    c.put(f"/api/connectors/{cid}/share", json={"members": [{"type": "user", "id": PLAIN.email, "role": "use"}]})
    items = as_user(PLAIN).get("/api/my-connectors").json()
    assert [i["id"] for i in items] == [cid] and items[0]["state"] == "not_connected"
    assert as_user(BUILDER).get("/api/my-connectors").json() == []  # not shared with this one
    assert as_user(BUILDER).post(f"/api/my-connectors/{cid}/connect").status_code == 404


def test_connect_starts_this_users_own_authorization(calendar_connector, as_user, gw, audit_log):
    r = as_user(PLAIN).post(f"/api/my-connectors/{calendar_connector}/connect")
    assert r.status_code == 200 and r.json()["authorization_url"].endswith("name=u-u-u1") and r.json()["state"] == "st-1"
    assert ("POST", "/api/oauth/authorizations", {"service": "googlecalendar", "connectionName": "u-u-u1"}, None) in gw.calls
    gw.client_ready = False
    assert as_user(PLAIN).post(f"/api/my-connectors/{calendar_connector}/connect").status_code == 503
    assert "connector.link_start" in {a["action"] for a in audit_log()}


def test_state_reflects_only_my_connection(calendar_connector, as_user, gw):
    gw.apps = [{"service": "googlecalendar", "alias": oc.conn_name(BUILDER.uid), "status": "active", "accountLabel": "b@example.com", "scopes": ["x"]}]
    assert as_user(PLAIN).get("/api/my-connectors").json()[0]["state"] == "not_connected"
    mine = as_user(BUILDER).get("/api/my-connectors").json()[0]
    assert mine["state"] == "connected" and mine["account_label"] == "b@example.com"
    gw.apps[0]["status"] = "reauth_required"
    assert as_user(BUILDER).get("/api/my-connectors").json()[0]["state"] == "reauth_required"


def test_gateway_down_reports_unavailable_not_500(calendar_connector, as_user, gw):
    gw.fail = oc.OpenConnectorError("down", "unreachable")
    assert as_user(PLAIN).get("/api/my-connectors").json()[0]["state"] == "unavailable"


def test_disconnect_only_touches_my_connection(calendar_connector, as_user, gw, audit_log):
    gw.apps = [{"service": "googlecalendar", "alias": oc.conn_name(PLAIN.uid), "status": "active", "accountLabel": "u@example.com"}]
    assert as_user(PLAIN).delete(f"/api/my-connectors/{calendar_connector}/connection").status_code == 204
    assert ("DELETE", "/api/connections/googlecalendar", {"connectionName": "u-u-u1", "revoke": True}, None) in gw.calls
    assert "connector.unlink" in {a["action"] for a in audit_log()}


def test_calendar_endpoints_use_the_callers_connection(calendar_connector, as_user, gw, audit_log):
    gw.apps = [{"service": "googlecalendar", "alias": oc.conn_name(PLAIN.uid), "status": "active", "accountLabel": "u@example.com"}]
    c = as_user(PLAIN)
    st = c.get("/api/calendar/status").json()
    assert st["connected"] and st["account_label"] == "u@example.com" and st["connector_id"] == calendar_connector
    ev = c.get("/api/calendar/events?from=2026-10-27T00:00:00Z&to=2026-11-03T00:00:00Z").json()
    assert [e["title"] for e in ev["events"]] == ["Medisense Sync", "Office"] and ev["events"][1]["all_day"] is True
    action = next(x for x in gw.calls if x[1] == "/v1/actions/googlecalendar.list_events")
    assert action[3] == {"connectionName": "u-u-u1"}
    assert c.get("/api/calendar/freebusy").json()["busy"][0]["start"] == "2026-10-28T02:00:00Z"
    assert "calendar.read" in {a["action"] for a in audit_log()}
    # someone who has not connected gets a clear 409 and no gateway call is made as them
    gw.calls.clear()
    other = as_user(BUILDER)
    assert other.get("/api/calendar/status").json()["connected"] is False
    assert other.get("/api/calendar/events").status_code == 409
    assert not [x for x in gw.calls if x[1].startswith("/v1/actions/")]


def test_status_without_any_calendar_connector(fs, as_user, gw):
    st = as_user(PLAIN).get("/api/calendar/status").json()
    assert st["connected"] is False and "管理員" in st["reason"]


def test_tool_node_calls_run_as_the_running_user(monkeypatch, gw):
    """invoke(): read actions only, only the allowed ones, always as the flow's user; output is de-identified."""
    monkeypatch.setattr(connectors.deid, "deidentify", lambda t: t.replace("Medisense", "[ORG]"))
    out = connectors.invoke("calendar", CAL_CFG, {}, "list_events", {"maxResults": "3", "timeMin": "2026-10-27T00:00:00Z"},
                            redact_pii=True, user_id="u-u1")
    assert "[ORG] Sync" in out and "Medisense" not in out
    call = next(x for x in gw.calls if x[1] == "/v1/actions/googlecalendar.list_events")
    assert call[3] == {"connectionName": "u-u-u1"} and call[2]["input"]["maxResults"] == 3 and call[2]["input"]["calendarId"] == "primary"
    raw = connectors.invoke("calendar", CAL_CFG, {}, "list_events", {}, redact_pii=False, user_id="u-u1")
    assert "Medisense" in raw
    with pytest.raises(RuntimeError, match="未允許"):
        connectors.invoke("calendar", CAL_CFG, {}, "create_event", {}, redact_pii=True, user_id="u-u1")
    with pytest.raises(RuntimeError, match="未允許"):
        connectors.invoke("calendar", {"allowed_actions": ["list_calendars"]}, {}, "list_events", {}, redact_pii=True, user_id="u-u1")
    with pytest.raises(RuntimeError, match="使用者身分"):
        connectors.invoke("calendar", CAL_CFG, {}, "list_events", {}, redact_pii=True, user_id=None)


def test_tool_node_explains_when_the_user_has_not_connected(gw):
    gw.fail = oc.OpenConnectorError("googlecalendar connection not found: u-x.", "connection_not_found", 404)
    with pytest.raises(RuntimeError, match="尚未連線"):
        connectors.invoke("calendar", CAL_CFG, {}, "list_calendars", {}, redact_pii=False, user_id="u-x")


def test_connector_test_button_checks_the_gateway(monkeypatch, gw):
    monkeypatch.setattr(oc, "health", lambda: True)
    gw.apps = [{"service": "googlecalendar", "alias": "u-a"}]
    res = connectors.test("calendar", {}, {})
    assert res["ok"] and "1 位使用者" in res["message"]
    gw.client_ready = False
    assert not connectors.test("calendar", {}, {})["ok"]


def test_oauth_callback_is_relayed_only_for_the_one_path(fs, gw, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    seen = {}
    monkeypatch.setattr(oc, "forward_callback", lambda path, q: (seen.update(path=path, q=q) or (200, "text/html; charset=utf-8", b"<p>done</p>")))
    c = TestClient(app)
    r = c.get("/api/oc/oauth/callback?code=abc&state=st-1")
    assert r.status_code == 200 and r.text == "<p>done</p>" and seen == {"path": "/api/oc/oauth/callback", "q": "code=abc&state=st-1"}
    assert c.get("/api/oc/api/runtime-tokens").status_code in (404, 405)  # nothing else of the gateway is exposed


def test_unconfigured_gateway_is_a_clear_error(fs, as_user, monkeypatch):
    monkeypatch.setenv("OPEN_CONNECTOR_URL", "")
    config.settings.cache_clear()
    cid = as_user(ADMIN).post("/api/connectors", json={"type": "calendar", "label": "Cal"}).json()["id"]
    assert as_user(ADMIN).post(f"/api/my-connectors/{cid}/connect").status_code == 503
    config.settings.cache_clear()


# ------------------------------------------------------------------ gateway catalog (everything the gateway supports)
PROVIDERS = [
    {"service": "googlecalendar", "displayName": "Google Calendar", "iconUrl": None, "homepageUrl": "https://workspace.google.com",
     "categories": [{"id": "Productivity", "displayName": "Productivity"}], "authTypes": ["oauth2", "custom_credential"]},
    {"service": "slack", "displayName": "Slack", "iconUrl": None, "homepageUrl": "", "categories": [{"id": "Communication", "displayName": "Communication"}],
     "authTypes": ["oauth2", "api_key"]},
    {"service": "arxiv", "displayName": "arXiv", "iconUrl": None, "homepageUrl": "", "categories": [{"id": "Data", "displayName": "Data"}], "authTypes": ["no_auth"]},
    {"service": "zendesk", "displayName": "Zendesk", "iconUrl": None, "homepageUrl": "", "categories": [{"id": "Communication", "displayName": "Communication"}],
     "authTypes": ["api_key"]},
]


@pytest.fixture(autouse=False)
def catalog_gw(gw, monkeypatch):
    oc.reset_catalog_cache()
    orig = gw.__call__

    def with_providers(method, path, *, json=None, params=None):
        if gw.fail:
            raise gw.fail
        if path == "/v1/providers":
            return PROVIDERS
        if path == "/api/providers/slack":
            return {"service": "slack", "displayName": "Slack", "categories": ["Communication", "Productivity"], "authTypes": ["oauth2"], "homepageUrl": "",
                    "actions": [{"id": "slack.send_message", "name": "send_message", "description": "Send", "operationType": "write"},
                                {"id": "slack.list_channels", "name": "list_channels", "description": "List", "operationType": "read"}],
                    "triggers": [{"id": "t"}], "execution": {"actionCount": 2, "locallyExecutableActionCount": 2}}
        return orig(method, path, json=json, params=params)

    monkeypatch.setattr(oc, "_request", with_providers)
    yield gw
    oc.reset_catalog_cache()


def test_gateway_catalog_lists_everything_with_facets(fs, as_user, catalog_gw):
    r = as_user(BUILDER).get("/api/gateway-catalog").json()
    assert r["gateway_total"] == 4 and r["total"] == 4
    assert r["items"][0]["service"] == "googlecalendar" and r["items"][0]["enabled_type"] == "calendar"  # enabled services first
    assert [i["name"] for i in r["items"][1:]] == ["arXiv", "Slack", "Zendesk"]  # then A-Z, case-insensitive
    assert {"id": "Communication", "count": 2} in r["facets"]["categories"]
    assert {"id": "oauth2", "count": 2} in r["facets"]["auth"] and r["enabled"] == ["googlecalendar"]


def test_gateway_catalog_filters_and_pages(fs, as_user, catalog_gw):
    c = as_user(BUILDER)
    assert [i["service"] for i in c.get("/api/gateway-catalog?q=SLACK").json()["items"]] == ["slack"]
    assert [i["service"] for i in c.get("/api/gateway-catalog?category=Communication").json()["items"]] == ["slack", "zendesk"]
    assert [i["service"] for i in c.get("/api/gateway-catalog?auth=no_auth").json()["items"]] == ["arxiv"]
    assert [i["service"] for i in c.get("/api/gateway-catalog?enabled_only=true").json()["items"]] == ["googlecalendar"]
    page = c.get("/api/gateway-catalog?limit=2&offset=2").json()
    assert page["total"] == 4 and [i["service"] for i in page["items"]] == ["slack", "zendesk"]


def test_gateway_catalog_detail_lists_actions(fs, as_user, catalog_gw):
    d = as_user(BUILDER).get("/api/gateway-catalog/slack").json()
    assert d["categories"] == ["Communication", "Productivity"]
    assert d["action_count"] == 2 and d["trigger_count"] == 1 and {a["operation"] for a in d["actions"]} == {"read", "write"}
    assert as_user(BUILDER).get("/api/gateway-catalog/nope").status_code == 404


def test_gateway_catalog_is_for_builders_and_degrades_cleanly(fs, as_user, catalog_gw):
    assert as_user(PLAIN).get("/api/gateway-catalog").status_code == 403
    catalog_gw.fail = oc.OpenConnectorError("down", "unreachable")
    oc.reset_catalog_cache()
    assert as_user(BUILDER).get("/api/gateway-catalog").status_code == 502


# ------------------------------------------------------------------ enabling any service (the wizard)
SLACK_DETAIL = {
    "service": "slack", "displayName": "Slack", "categories": ["Communication"], "authTypes": ["oauth2", "api_key"], "homepageUrl": "https://slack.com",
    "auth": [{"type": "oauth2", "scopes": ["channels:read", "chat:write", "files:read", "openid", "email"], "optionalScopes": []}],
    "actions": [
        {"id": "slack.list_channels", "name": "list_channels", "description": "List channels", "operationType": "read", "requiredScopes": ["channels:read"],
         "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer"}}, "required": []}},
        {"id": "slack.send_message", "name": "send_message", "description": "Send a message", "operationType": "write", "requiredScopes": ["chat:write"],
         "inputSchema": {"type": "object", "properties": {"channel": {"type": "string"}, "text": {"type": "string"}, "blocks": {"type": "array"}}, "required": ["channel", "text"]}},
        {"id": "slack.delete_message", "name": "delete_message", "description": "Delete", "operationType": "destructive", "requiredScopes": ["chat:write"], "inputSchema": {}},
    ],
    "triggers": [], "execution": {"actionCount": 3, "locallyExecutableActionCount": 3}}
ZENDESK_DETAIL = {
    "service": "zendesk", "displayName": "Zendesk", "categories": ["Communication"], "authTypes": ["api_key"], "auth": [{"type": "api_key"}],
    "actions": [{"id": "zendesk.list_tickets", "name": "list_tickets", "description": "List", "operationType": "read", "requiredScopes": [], "inputSchema": {}}]}
ARXIV_DETAIL = {"service": "arxiv", "displayName": "arXiv", "categories": ["Data"], "authTypes": ["no_auth"], "auth": [{"type": "no_auth"}],
                "actions": [{"id": "arxiv.search", "name": "search", "description": "Search", "operationType": "read", "requiredScopes": [], "inputSchema": {"properties": {"max_results": {"type": "integer"}}}}]}
DETAILS = {"slack": SLACK_DETAIL, "zendesk": ZENDESK_DETAIL, "arxiv": ARXIV_DETAIL}
SETUPS = {
    "slack": {"auth": [{"type": "oauth2", "clientFields": [{"key": "clientId", "label": "Client ID", "required": True, "secret": False},
                                                          {"key": "clientSecret", "label": "Client secret", "required": True, "secret": True}], "scopes": ["chat:write"]},
                       {"type": "api_key", "fields": [{"key": "apiKey", "label": "Bot token", "required": True, "secret": True}]}],
              "oauthClient": {"configured": False, "expectedRedirectUri": "https://portal.example/api/oc/oauth/callback", "missingFields": ["clientId", "clientSecret"]}},
    "zendesk": {"auth": [{"type": "api_key", "fields": [{"key": "apiKey", "label": "API token", "required": True, "secret": True},
                                                       {"key": "subdomain", "label": "Subdomain", "required": True, "secret": False}]}]},
    "arxiv": {"auth": [{"type": "no_auth", "fields": []}]},
}


class EnableGateway(FakeGateway):
    def __init__(self):
        super().__init__()
        self.bad_credential = False
        self.oauth_ok = False  # like the real gateway: configured once an OAuth client has been stored

    def __call__(self, method, path, *, json=None, params=None):
        self.calls.append((method, path, json, params))
        if self.fail:
            raise self.fail
        if path == "/v1/providers":
            return [{"service": s, "displayName": d["displayName"], "categories": [{"id": "x"}], "authTypes": d["authTypes"]} for s, d in DETAILS.items()]
        if path.startswith("/api/providers/"):
            return DETAILS[path.rsplit("/", 1)[1]]
        if path.endswith("/setup"):
            svc = path.split("/")[-2]
            out = dict(SETUPS[svc])
            if "oauthClient" in out:
                out["oauthClient"] = {**out["oauthClient"], "configured": self.oauth_ok}
            return out
        if path == "/api/oauth/configs" and method == "GET":
            return [{"service": "slack", "clientId": "cid-1"}]
        if path.startswith("/api/oauth/configs/"):
            self.oauth_ok = True
            return {"configured": True}
        if path.startswith("/api/connections/") and method == "PUT":
            if self.bad_credential:
                raise oc.OpenConnectorError("API token is invalid.", "invalid_input", 400)
            return {"ok": True}
        if path.startswith("/api/connections/") and method == "DELETE":
            return {}
        if path == "/v1/apps":
            return self.apps
        if path == "/health":
            return {}
        if path.startswith("/v1/actions/"):
            return {"output": {"echo": path.rsplit("/", 1)[1], "input": json}}
        return super().__call__(method, path, json=json, params=params)


@pytest.fixture
def egw(monkeypatch):
    monkeypatch.setenv("OPEN_CONNECTOR_URL", "http://oc.test")
    monkeypatch.setenv("OPEN_CONNECTOR_TOKEN", "t")
    config.settings.cache_clear()
    oc.reset_catalog_cache()
    oc.reset_detail_cache()
    g = EnableGateway()
    monkeypatch.setattr(oc, "_request", g)
    monkeypatch.setattr(oc, "health", lambda: True)
    yield g
    oc.reset_catalog_cache()
    oc.reset_detail_cache()
    config.settings.cache_clear()


def test_setup_info_lists_fields_actions_and_redirect_uri(fs, as_user, egw):
    d = as_user(ADMIN).get("/api/gateway-connectors/setup/slack").json()
    assert [o["type"] for o in d["auth_options"]] == ["oauth2", "api_key"]
    assert [f["key"] for f in d["auth_options"][0]["fields"]] == ["clientId", "clientSecret"]
    assert d["oauth_client"]["expected_redirect_uri"].endswith("/api/oc/oauth/callback") and d["existing_connector_id"] is None
    assert {a["id"]: a["operation"] for a in d["actions"]}["slack.delete_message"] == "destructive"
    assert as_user(BUILDER).get("/api/gateway-connectors/setup/slack").status_code == 403
    assert as_user(ADMIN).get("/api/gateway-connectors/setup/nope").status_code == 404


def test_enable_oauth_service_requests_only_the_scopes_the_actions_need(fs, as_user, egw, audit_log):
    c = as_user(ADMIN)
    body = {"service": "slack", "label": "Slack", "auth_mode": "oauth2", "allowed_actions": ["slack.list_channels"],
            "client": {"clientId": "cid", "clientSecret": "sec-123"}}
    r = c.post("/api/gateway-connectors", json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["type"] == "gateway" and out["config"]["allowed_actions"] == ["slack.list_channels"]
    assert out["config"]["scopes"] == ["channels:read", "openid", "email"]  # no chat:write: nothing allowed needs it
    put = next(x for x in egw.calls if x[0] == "PUT" and x[1] == "/api/oauth/configs/slack")
    assert put[2]["clientId"] == "cid" and put[2]["clientSecret"] == "sec-123" and put[2]["requestedScopes"] == ["channels:read", "openid", "email"]
    stored = fs.store[f"connectors/{out['id']}"]
    assert "sec-123" not in json.dumps(stored, default=str)  # the secret lives in the gateway only
    assert "sec-123" not in json.dumps(audit_log(), default=str)
    assert c.post("/api/gateway-connectors", json=body).status_code == 409  # one connector per service


def test_enable_validation(fs, as_user, egw):
    c = as_user(ADMIN)
    base = {"service": "slack", "label": "Slack", "auth_mode": "oauth2", "allowed_actions": ["slack.list_channels"], "client": {"clientId": "a", "clientSecret": "b"}}
    assert as_user(BUILDER).post("/api/gateway-connectors", json=base).status_code == 403
    assert c.post("/api/gateway-connectors", json={**base, "allowed_actions": ["slack.nope"]}).status_code == 422
    assert c.post("/api/gateway-connectors", json={**base, "allowed_actions": []}).status_code == 422
    assert c.post("/api/gateway-connectors", json={**base, "client": {"clientId": "a"}}).status_code == 422  # secret missing
    assert c.post("/api/gateway-connectors", json={**base, "service": "arxiv", "allowed_actions": ["arxiv.search"]}).status_code == 422  # oauth2 not offered
    assert c.post("/api/gateway-connectors", json={**base, "service": "zzz"}).status_code == 404


def test_enable_shared_credential_service(fs, as_user, egw):
    c = as_user(ADMIN)
    body = {"service": "zendesk", "label": "Zendesk", "auth_mode": "api_key", "allowed_actions": ["zendesk.list_tickets"], "credentials": {"apiKey": "tok", "subdomain": "acme"}}
    r = c.post("/api/gateway-connectors", json=body)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    put = next(x for x in egw.calls if x[0] == "PUT" and x[1] == "/api/connections/zendesk")
    assert put[2]["authType"] == "api_key" and put[2]["connectionName"] == oc.shared_name(cid) and put[2]["values"] == {"apiKey": "tok", "subdomain": "acme"}
    assert "tok" not in json.dumps(fs.store[f"connectors/{cid}"], default=str)
    c.put(f"/api/connectors/{cid}/share", json={"access": "account", "role": "use", "members": []})
    item = as_user(PLAIN).get("/api/my-connectors").json()[0]
    assert item["state"] == "shared" and item["mode"] == "shared" and item["service"] == "zendesk"
    assert as_user(PLAIN).post(f"/api/my-connectors/{cid}/connect").status_code == 409  # nothing for a user to connect
    # deleting the connector removes the shared credential from the gateway
    assert c.delete(f"/api/connectors/{cid}").status_code == 204
    assert ("DELETE", "/api/connections/zendesk", {"connectionName": oc.shared_name(cid), "revoke": False}, None) in egw.calls


def test_bad_shared_credential_is_rejected_and_nothing_is_created(fs, as_user, egw):
    egw.bad_credential = True
    body = {"service": "zendesk", "label": "Zendesk", "auth_mode": "api_key", "allowed_actions": ["zendesk.list_tickets"], "credentials": {"apiKey": "x", "subdomain": "acme"}}
    r = as_user(ADMIN).post("/api/gateway-connectors", json=body)
    assert r.status_code == 422 and "invalid" in r.json()["detail"]
    assert not [p for p in fs.store if p.startswith("connectors/")]


def test_enable_no_auth_service_and_use_it(fs, as_user, egw):
    c = as_user(ADMIN)
    cid = c.post("/api/gateway-connectors", json={"service": "arxiv", "label": "arXiv", "auth_mode": "no_auth", "allowed_actions": ["arxiv.search"]}).json()["id"]
    out = connectors.invoke("gateway", {"service": "arxiv", "auth_mode": "no_auth", "allowed_actions": ["arxiv.search"]}, {}, "search",
                            {"max_results": "5"}, redact_pii=False, user_id="u-x", connector_id=cid)
    call = next(x for x in egw.calls if x[1] == "/v1/actions/arxiv.search")
    assert call[3] is None and call[2]["input"] == {"max_results": 5}  # no connection name; "5" became the integer the action declares
    assert json.loads(out)["echo"] == "arxiv.search"


def test_gateway_invoke_uses_the_right_connection_and_only_allowed_actions(fs, as_user, egw, monkeypatch):
    monkeypatch.setattr(connectors.deid, "deidentify", lambda t: t.replace("secret-name", "[X]"))
    oauth_cfg = {"service": "slack", "auth_mode": "oauth2", "allowed_actions": ["slack.list_channels"]}
    connectors.invoke("gateway", oauth_cfg, {}, "slack.list_channels", {"limit": "3"}, redact_pii=True, user_id="u-u1", connector_id="c1")
    assert next(x for x in egw.calls if x[1] == "/v1/actions/slack.list_channels")[3] == {"connectionName": "u-u-u1"}  # the user's own grant
    shared_cfg = {"service": "slack", "auth_mode": "api_key", "allowed_actions": ["slack.list_channels"]}
    egw.calls.clear()
    connectors.invoke("gateway", shared_cfg, {}, "list_channels", {}, redact_pii=False, user_id="u-u1", connector_id="c2")
    assert next(x for x in egw.calls if x[1] == "/v1/actions/slack.list_channels")[3] == {"connectionName": oc.shared_name("c2")}
    with pytest.raises(RuntimeError, match="未允許"):
        connectors.invoke("gateway", oauth_cfg, {}, "slack.send_message", {"channel": "c", "text": "t"}, redact_pii=False, user_id="u-u1", connector_id="c1")
    with pytest.raises(RuntimeError, match="使用者身分"):
        connectors.invoke("gateway", oauth_cfg, {}, "slack.list_channels", {}, redact_pii=False, user_id=None, connector_id="c1")
    egw.fail = oc.OpenConnectorError("no", "connection_not_found", 404)
    with pytest.raises(RuntimeError, match="尚未連線"):
        connectors.invoke("gateway", oauth_cfg, {}, "slack.list_channels", {}, redact_pii=False, user_id="u-u1", connector_id="c1")


def test_actions_endpoint_and_update_for_gateway_connectors(fs, as_user, egw):
    c = as_user(ADMIN)
    cid = c.post("/api/gateway-connectors", json={"service": "slack", "label": "Slack", "auth_mode": "oauth2", "allowed_actions": ["slack.list_channels"],
                                                  "client": {"clientId": "a", "clientSecret": "b"}}).json()["id"]
    acts = c.get(f"/api/connectors/{cid}/actions").json()
    assert [a["id"] for a in acts] == ["slack.list_channels"] and acts[0]["write"] is False
    # widen the permission: scopes are recomputed and pushed to the gateway
    egw.calls.clear()
    r = c.put(f"/api/gateway-connectors/{cid}", json={"allowed_actions": ["slack.list_channels", "slack.send_message"]})
    assert r.status_code == 200 and r.json()["config"]["scopes"] == ["channels:read", "chat:write", "openid", "email"]
    put = next(x for x in egw.calls if x[1] == "/api/oauth/configs/slack")
    assert put[2]["clientId"] == "cid-1" and "clientSecret" not in put[2]  # stored client reused, secret untouched
    acts = c.get(f"/api/connectors/{cid}/actions").json()
    send = next(a for a in acts if a["id"] == "slack.send_message")
    assert send["write"] is True and [(x["key"], x["required"]) for x in send["args"]] == [("channel", True), ("text", True), ("blocks", False)]
    assert c.put(f"/api/gateway-connectors/{cid}", json={"allowed_actions": ["slack.bogus"]}).status_code == 422
    # connectors list hides the generic type from the catalog cards but the connector itself is a normal connector
    types = {t["id"] for t in c.get("/api/connectors/types").json()["types"]}
    assert "gateway" not in types and "calendar" in types


def test_admin_test_button_for_gateway_connectors(fs, as_user, egw):
    c = as_user(ADMIN)
    cid = c.post("/api/gateway-connectors", json={"service": "zendesk", "label": "Zendesk", "auth_mode": "api_key",
                                                  "allowed_actions": ["zendesk.list_tickets"], "credentials": {"apiKey": "t", "subdomain": "s"}}).json()["id"]
    egw.apps = [{"service": "zendesk", "alias": oc.shared_name(cid), "status": "active"}]
    assert c.post(f"/api/connectors/{cid}/test").json()["ok"] is True
    egw.apps = []
    assert c.post(f"/api/connectors/{cid}/test").json()["ok"] is False


def test_validation_errors_from_the_gateway_name_the_problem(monkeypatch):
    monkeypatch.setenv("OPEN_CONNECTOR_URL", "http://oc.test")
    monkeypatch.setenv("OPEN_CONNECTOR_TOKEN", "t")
    config.settings.cache_clear()

    class R:
        status_code, content, text = 400, b"x", "x"

        def json(self):
            return {"success": False, "message": "Action input does not match the action schema.", "errorCode": "invalid_input",
                    "data": [{"error": 'Instance does not have required property "abstractQuery".'}, {"error": 'Property "query" does not match additional properties schema.'}]}

    monkeypatch.setattr(oc.httpx, "request", lambda *a, **k: R())
    with pytest.raises(oc.OpenConnectorError) as e:
        oc._request("POST", "/v1/actions/arxiv.search_by_abstract", json={"input": {"query": "x"}})
    assert "abstractQuery" in str(e.value) and "query" in str(e.value) and e.value.code == "invalid_input"
    config.settings.cache_clear()


def test_preview_scopes_shows_what_users_will_be_asked(fs, as_user, egw):
    c = as_user(ADMIN)
    r = c.post("/api/gateway-connectors/preview-scopes", json={"service": "slack", "allowed_actions": ["slack.list_channels"]}).json()
    assert r["data_scopes"] == ["channels:read"] and r["identity_scopes"] == ["openid", "email"] and r["grants_write"] is False
    w = c.post("/api/gateway-connectors/preview-scopes", json={"service": "slack", "allowed_actions": ["slack.list_channels", "slack.send_message"]}).json()
    assert w["grants_write"] is True and "chat:write" in w["data_scopes"] and w["operations"] == {"read": 1, "write": 1, "destructive": 0}
    assert c.post("/api/gateway-connectors/preview-scopes", json={"service": "slack", "allowed_actions": ["slack.bogus"]}).status_code == 422
    assert as_user(BUILDER).post("/api/gateway-connectors/preview-scopes", json={"service": "slack"}).status_code == 403


def test_catalog_marks_services_enabled_through_the_wizard(fs, as_user, egw):
    c = as_user(ADMIN)
    cid = c.post("/api/gateway-connectors", json={"service": "arxiv", "label": "arXiv", "auth_mode": "no_auth", "allowed_actions": ["arxiv.search"]}).json()["id"]
    items = {i["service"]: i for i in c.get("/api/gateway-catalog").json()["items"]}
    assert items["arxiv"]["enabled_type"] == "gateway" and items["arxiv"]["connector_id"] == cid and items["slack"]["enabled_type"] is None
    assert c.get("/api/gateway-catalog?enabled_only=true").json()["total"] == 1
    d = c.get("/api/gateway-catalog/arxiv").json()
    assert d["enabled_type"] == "gateway" and d["connector_id"] == cid


def test_callback_is_forwarded_under_the_gateways_mount_prefix(monkeypatch):
    monkeypatch.setenv("OPEN_CONNECTOR_TOKEN", "t")
    seen = {}

    class R:
        status_code, headers, content = 200, {"content-type": "text/html"}, b"ok"

    monkeypatch.setattr(oc.httpx, "get", lambda url, **k: (seen.update(url=url) or R()))
    # cloud: gateway origin is <site>/api/oc, so its URL carries the prefix and the browser path already starts with it
    monkeypatch.setenv("OPEN_CONNECTOR_URL", "https://oc-abc.run.app/api/oc")
    config.settings.cache_clear()
    oc.forward_callback("/api/oc/oauth/callback", "code=1&state=s")
    assert seen["url"] == "https://oc-abc.run.app/api/oc/oauth/callback?code=1&state=s"
    # local: no prefix, path is passed through
    monkeypatch.setenv("OPEN_CONNECTOR_URL", "http://localhost:3100")
    config.settings.cache_clear()
    oc.forward_callback("/oauth/callback", "")
    assert seen["url"] == "http://localhost:3100/oauth/callback"
    config.settings.cache_clear()


def test_platform_google_client_reused(monkeypatch):
    from app.config import settings
    from app.routers import gateway_connectors as gc

    monkeypatch.setattr(gc, "settings", lambda: type("S", (), {"google_oauth_client_id": "id", "google_oauth_client_secret": "sec"})())
    assert gc.platform_client("gmail") == {"clientId": "id", "clientSecret": "sec"}
    assert gc.platform_client("slack") == {}
    monkeypatch.setattr(gc, "settings", lambda: type("S", (), {"google_oauth_client_id": "", "google_oauth_client_secret": ""})())
    assert gc.platform_client("gmail") == {}
