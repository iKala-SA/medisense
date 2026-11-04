"""登入與 SSO: Keycloak payloads (Entra identity provider, LDAP federation), the admin API, the public providers list,
and what auth.current_user does with allowed domains, switched-off providers and a second sign-in method."""
import json

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth
from app.config import settings
from app.engine import keycloak as kc
from app.engine import sso
from app.main import app

from .conftest import ADMIN, BUILDER

KC = "https://kc.example.com"


class FakeKeycloak:
    """Just enough of the Keycloak 26 admin REST API."""

    def __init__(self):
        self.idps: dict[str, dict] = {}
        self.components: dict[str, dict] = {}
        self.calls: list[tuple[str, str, dict | None]] = []
        self.ldap_ok = True
        self.n = 0

    def handler(self, req: httpx.Request) -> httpx.Response:
        path, m = req.url.path, req.method
        body = json.loads(req.content) if req.content and req.headers.get("content-type", "").startswith("application/json") else None
        self.calls.append((m, path, body))
        if path.endswith("/protocol/openid-connect/token"):
            form = dict(x.split("=", 1) for x in req.content.decode().split("&"))
            if form.get("client_secret") != "kc-secret":
                return httpx.Response(401, json={"error": "unauthorized_client"})
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 300})
        assert req.headers["authorization"] == "Bearer tok"
        pre = "/admin/realms/medisense"
        rest = path[len(pre):]
        if rest == "" and m == "GET":
            return httpx.Response(200, json={"id": "realm-uuid", "realm": "medisense"})
        if rest == "/identity-provider/instances":
            if m == "POST":
                self.idps[body["alias"]] = body
                return httpx.Response(201)
            return httpx.Response(200, json=list(self.idps.values()))
        if rest.startswith("/identity-provider/instances/"):
            alias = rest.rsplit("/", 1)[-1]
            if alias not in self.idps:
                return httpx.Response(404, json={"error": "not found"})
            if m == "GET":
                rep = json.loads(json.dumps(self.idps[alias]))
                rep["config"]["clientSecret"] = kc.SECRET
                return httpx.Response(200, json=rep)
            if m == "PUT":
                if body["config"]["clientSecret"] == kc.SECRET:
                    body["config"]["clientSecret"] = self.idps[alias]["config"]["clientSecret"]
                self.idps[alias] = body
                return httpx.Response(204)
            self.idps.pop(alias)
            return httpx.Response(204)
        if rest == "/components":
            if m == "POST":
                self.n += 1
                cid = f"c{self.n}"
                self.components[cid] = {**body, "id": cid}
                self.n += 1  # Keycloak creates the default mappers with the provider
                self.components[f"c{self.n}"] = {"id": f"c{self.n}", "name": "email", "parentId": cid, "providerType": kc.LDAP_MAPPER,
                                                 "config": {"ldap.attribute": ["mail"]}}
                return httpx.Response(201, headers={"location": f"{KC}{pre}/components/{cid}"})
            q = dict(req.url.params)
            rows = [c for c in self.components.values() if (not q.get("name") or c.get("name") == q["name"])
                    and (not q.get("parent") or c.get("parentId") == q["parent"]) and (not q.get("type") or c.get("providerType") == q["type"])]
            return httpx.Response(200, json=[{**c, "config": {**c["config"], **({"bindCredential": [kc.SECRET]} if "bindCredential" in c["config"] else {})}}
                                             for c in rows])
        if rest.startswith("/components/"):
            cid = rest.rsplit("/", 1)[-1]
            if m == "PUT":
                if body["config"].get("bindCredential") == [kc.SECRET]:
                    body["config"]["bindCredential"] = self.components[cid]["config"]["bindCredential"]
                self.components[cid] = body
            elif m == "DELETE":
                self.components = {k: v for k, v in self.components.items() if k != cid and v.get("parentId") != cid}
            return httpx.Response(204)
        if rest == "/testLDAPConnection":
            return httpx.Response(204) if self.ldap_ok else httpx.Response(400, json={"errorMessage": "LDAPErrorCode.CommunicationError"})
        return httpx.Response(404)


@pytest.fixture
def keycloak(monkeypatch):
    fake = FakeKeycloak()
    s = settings()
    monkeypatch.setattr(s, "keycloak_url", KC)
    monkeypatch.setattr(s, "keycloak_client_secret", "kc-secret")
    monkeypatch.setattr(kc, "_client", lambda: httpx.Client(transport=httpx.MockTransport(fake.handler)))
    kc.reset()
    yield fake
    kc.reset()


@pytest.fixture(autouse=True)
def _fresh_sso(monkeypatch):
    from app.routers import sso as sso_router
    monkeypatch.setattr(sso_router, "_identity_platform", lambda: {"provider_id": "oidc.medisense-sso", "ok": True, "issuer": "", "error": ""})
    sso.reset_cache()
    yield
    sso.reset_cache()


ENTRA = {"tenant_id": "11111111-2222-3333-4444-555555555555", "client_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
         "client_secret": "s3cret!", "enabled": True}
LDAP = {"vendor": "ad", "connection_url": "ldaps://dc1.hospital.local:636", "bind_dn": "CN=svc-medisense,OU=Svc,DC=hospital,DC=local",
        "bind_password": "bind-pw", "users_dn": "OU=Staff,DC=hospital,DC=local", "email_attr": "userPrincipalName"}


def test_entra_goes_to_keycloak_and_the_secret_never_comes_back(fs, as_user, keycloak, audit_log):
    c = as_user(ADMIN)
    r = c.put("/api/sso/entra", json=ENTRA)
    assert r.status_code == 200, r.text
    assert r.json()["redirect_uri"] == f"{KC}/realms/medisense/broker/entra/endpoint"
    idp = keycloak.idps["entra"]
    assert idp["providerId"] == "oidc" and idp["trustEmail"] is True
    assert idp["config"]["issuer"] == f"https://login.microsoftonline.com/{ENTRA['tenant_id']}/v2.0"
    assert idp["config"]["clientSecret"] == "s3cret!"
    assert "s3cret!" not in json.dumps(fs.store.get("config/sso"), default=str)  # Medisense keeps no secret
    # an update without a secret keeps Keycloak's
    assert c.put("/api/sso/entra", json={**ENTRA, "client_secret": "", "enabled": False}).status_code == 200
    assert keycloak.idps["entra"]["config"]["clientSecret"] == "s3cret!" and keycloak.idps["entra"]["enabled"] is False
    got = c.get("/api/sso").json()
    assert got["entra"]["in_keycloak"] and got["entra"]["tenant_id"] == ENTRA["tenant_id"] and got["keycloak"]["ok"]
    assert "s3cret!" not in json.dumps(got)
    assert c.delete("/api/sso/entra").status_code == 204 and "entra" not in keycloak.idps
    actions = [a["action"] for a in audit_log()]
    assert actions.count("sso.entra.update") == 2 and "sso.entra.delete" in actions
    assert not any("s3cret!" in json.dumps(a, default=str) for a in audit_log())


def test_first_entra_setup_needs_a_secret(fs, as_user, keycloak):
    r = as_user(ADMIN).put("/api/sso/entra", json={**ENTRA, "client_secret": ""})
    assert r.status_code == 422 and "client secret" in r.json()["detail"]
    assert as_user(ADMIN).put("/api/sso/entra", json={**ENTRA, "tenant_id": "bad tenant/"}).status_code == 422


def test_ldap_federation_is_read_only_and_maps_the_email_attribute(fs, as_user, keycloak, audit_log):
    c = as_user(ADMIN)
    r = c.put("/api/sso/ldap", json=LDAP)
    assert r.status_code == 200, r.text
    comp = next(x for x in keycloak.components.values() if x.get("name") == kc.LDAP)
    cfg = comp["config"]
    assert comp["parentId"] == "realm-uuid" and comp["providerId"] == "ldap"
    assert cfg["editMode"] == ["READ_ONLY"] and cfg["usernameLDAPAttribute"] == ["sAMAccountName"] and cfg["uuidLDAPAttribute"] == ["objectGUID"]
    assert cfg["bindCredential"] == ["bind-pw"] and cfg["connectionUrl"] == [LDAP["connection_url"]]
    mapper = next(x for x in keycloak.components.values() if x.get("name") == "email")
    assert mapper["config"]["ldap.attribute"] == ["userPrincipalName"]
    assert "bind-pw" not in json.dumps(fs.store.get("config/sso"), default=str)
    # an update keeps the stored password and switches the vendor defaults
    assert c.put("/api/sso/ldap", json={**LDAP, "bind_password": "", "vendor": "other"}).status_code == 200
    comp = keycloak.components[comp["id"]]
    assert comp["config"]["bindCredential"] == ["bind-pw"] and comp["config"]["usernameLDAPAttribute"] == ["uid"]
    assert c.get("/api/sso").json()["ldap"]["has_password"]
    assert c.delete("/api/sso/ldap").status_code == 204 and not keycloak.components
    assert {"sso.ldap.update", "sso.ldap.delete"} <= {a["action"] for a in audit_log()}


def test_ldap_test_reports_failure_as_an_answer(fs, as_user, keycloak):
    c = as_user(ADMIN)
    t = {"action": "connection", "connection_url": LDAP["connection_url"]}
    assert c.post("/api/sso/ldap/test", json=t).json() == {"ok": True, "message": "連線成功"}
    keycloak.ldap_ok = False
    r = c.post("/api/sso/ldap/test", json={**t, "action": "auth", "bind_dn": LDAP["bind_dn"], "bind_password": "x"})
    assert r.status_code == 200 and r.json()["ok"] is False and "CommunicationError" in r.json()["message"]
    sent = [b for m, p, b in keycloak.calls if p.endswith("/testLDAPConnection")]
    assert sent[-1]["action"] == "testAuthentication" and sent[-1]["bindCredential"] == "x"


def test_sso_is_admin_only_and_a_missing_keycloak_is_503(fs, as_user):
    assert as_user(BUILDER).get("/api/sso").status_code == 403
    assert as_user(BUILDER).put("/api/sso/google", json={"enabled": True}).status_code == 403
    c = as_user(ADMIN)
    got = c.get("/api/sso").json()
    assert got["keycloak"] == {"configured": False, "url": "", "realm": "medisense", "ok": False, "error": "未設定"}
    r = c.put("/api/sso/entra", json=ENTRA)
    assert r.status_code == 503 and "Keycloak" in r.json()["detail"]


def test_google_settings_and_public_providers(fs, as_user, audit_log):
    c = as_user(ADMIN)
    r = c.put("/api/sso/google", json={"enabled": True, "allowed_domains": ["Hospital.org.tw", "@vghtc.gov.tw", "hospital.org.tw"],
                                       "hd": "hospital.org.tw"})
    assert r.status_code == 200 and r.json()["allowed_domains"] == ["hospital.org.tw", "vghtc.gov.tw"]
    assert c.put("/api/sso/google", json={"allowed_domains": ["not a domain"]}).status_code == 422
    fs.put("config/sso", {**fs.store["config/sso"], "entra": {"enabled": True, "tenant_id": "t", "client_id": "c", "display_name": "院內 Microsoft"}})
    sso.reset_cache()
    pub = TestClient(app).get("/api/auth/providers").json()  # no sign-in
    assert pub["google"] == {"enabled": True, "hd": "hospital.org.tw"}
    assert pub["entra"] == {"enabled": True, "label": "院內 Microsoft", "provider_id": "oidc.medisense-sso", "hint": "entra"}
    assert pub["ldap"]["enabled"] is False
    assert "tenant_id" not in json.dumps(pub) and "client_id" not in json.dumps(pub)
    assert "sso.google.update" in {a["action"] for a in audit_log()}


# --- auth.current_user ------------------------------------------------------------------------------------------------

def _claims(email="amy@hospital.org.tw", uid="fb-amy", provider="google.com"):
    return {"uid": uid, "email": email, "email_verified": True, "name": "Amy", "firebase": {"sign_in_provider": provider}}


@pytest.fixture
def sign_in(monkeypatch):
    box = {}
    monkeypatch.setattr(auth.fb_auth, "verify_id_token", lambda t, check_revoked=False: box["claims"])

    def go(**kw):
        box["claims"] = _claims(**kw)
        auth._cache.clear()
        return auth.current_user("tok")
    return go


def test_allowed_domains_come_from_the_settings_page_too(fs, sign_in, monkeypatch):
    monkeypatch.setattr(settings(), "allowed_domains", "example.com")
    with pytest.raises(HTTPException) as e:
        sign_in()
    assert e.value.status_code == 403
    fs.put("config/sso", {"google": {"allowed_domains": ["hospital.org.tw"]}})
    sso.reset_cache()
    assert sign_in().email == "amy@hospital.org.tw"
    assert fs.store["users/amy@hospital.org.tw"]["login_provider"] == "google.com"


def test_a_switched_off_provider_cannot_sign_in(fs, sign_in):
    with pytest.raises(HTTPException) as e:
        sign_in(provider="oidc.medisense-sso")  # neither Entra nor LDAP is on
    assert e.value.status_code == 403
    fs.put("config/sso", {"ldap": {"enabled": True}, "google": {"enabled": False}})
    sso.reset_cache()
    assert sign_in(provider="oidc.medisense-sso", uid="fb-ldap", email="ldap@hospital.org.tw").uid == "fb-ldap"
    with pytest.raises(HTTPException):
        sign_in()  # Google is switched off
    assert sign_in(email="root@example.com", uid="fb-root").role == "admin"  # bootstrap admins always get in


def test_an_unlinked_second_sign_in_method_cannot_take_over_the_account(fs, sign_in, monkeypatch):
    fs.put("config/sso", {"entra": {"enabled": True}})
    sso.reset_cache()
    sign_in()  # first sign-in with Google: uid fb-amy
    monkeypatch.setattr(auth.fb_auth, "get_user", lambda uid: type("U", (), {"disabled": False})())
    with pytest.raises(HTTPException) as e:
        sign_in(uid="fb-amy-entra", provider="oidc.medisense-sso")
    assert e.value.status_code == 409
    assert fs.store["users/amy@hospital.org.tw"]["uid"] == "fb-amy"
    # linked (same uid) is fine and records the method
    assert sign_in(provider="oidc.medisense-sso").uid == "fb-amy"
    assert fs.store["users/amy@hospital.org.tw"]["login_provider"] == "oidc.medisense-sso"
