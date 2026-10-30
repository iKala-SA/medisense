from app import sharing
from app.schemas import Share

from .conftest import ADMIN, BUILDER, BUILDER2, PLAIN


def doc(**share):
    return {"owner_uid": BUILDER.uid, "share": share}


def test_owner_and_admin_always(fs):
    d = doc(access="restricted", members=[])
    assert sharing.can_view(BUILDER, d) and sharing.can_edit(BUILDER, d)
    assert sharing.can_view(ADMIN, d) and sharing.can_edit(ADMIN, d)


def test_no_access_for_others(fs):
    d = doc(access="restricted", members=[])
    assert not sharing.can_view(PLAIN, d)
    assert not sharing.can_edit(PLAIN, d)
    assert not sharing.can_view(PLAIN, {"owner_uid": "x"})  # no share block at all


def test_member_by_email_roles(fs):
    d = doc(access="restricted", members=[{"type": "user", "id": "USER@example.com", "role": "use"}])
    assert sharing.can_view(PLAIN, d) and not sharing.can_edit(PLAIN, d)
    d = doc(access="restricted", members=[{"type": "user", "id": "user@example.com", "role": "edit"}])
    assert sharing.can_edit(PLAIN, d)
    assert not sharing.can_view(BUILDER2, d)


def test_group_membership(fs):
    fs.put("groups/g1", {"name": "ICU", "member_emails": ["user@example.com"]})
    d = doc(access="restricted", members=[{"type": "group", "id": "g1", "role": "edit"}])
    assert sharing.can_edit(PLAIN, d)
    assert not sharing.can_view(BUILDER2, d)


def test_account_wide(fs):
    assert sharing.can_view(PLAIN, doc(access="account", role="use", members=[]))
    assert not sharing.can_edit(PLAIN, doc(access="account", role="use", members=[]))
    assert sharing.can_edit(PLAIN, doc(access="account", role="edit", members=[]))
    # best role wins
    d = doc(access="account", role="use", members=[{"type": "user", "id": "user@example.com", "role": "edit"}])
    assert sharing.can_edit(PLAIN, d)


def test_manage_is_owner_or_admin_only(fs):
    d = doc(access="account", role="edit", members=[])
    assert sharing.can_manage(BUILDER, d) and sharing.can_manage(ADMIN, d)
    assert not sharing.can_manage(BUILDER2, d)


def test_share_keys():
    s = Share(members=[{"type": "user", "id": "A@x.com"}, {"type": "group", "id": "g1"}])
    assert sharing.share_keys(s) == ["g:g1", "u:a@x.com"]


def test_agent_share_endpoint_and_visibility(fs, as_user, audit_log):
    c = as_user(BUILDER)
    r = c.post("/api/agents", json={"name": "A1"})
    assert r.status_code == 201 and r.json()["share"]["access"] == "restricted"
    aid = r.json()["id"]
    # other builder cannot see the private draft; plain user neither
    assert as_user(BUILDER2).get(f"/api/agents/{aid}").status_code == 403
    # owner shares (view) with BUILDER2
    r = as_user(BUILDER).put(f"/api/agents/{aid}/share", json={"access": "restricted", "members": [
        {"type": "user", "id": "builder2@example.com", "name": "B2", "role": "use"}]})
    assert r.status_code == 200 and r.json()["share"]["members"][0]["id"] == "builder2@example.com"
    assert as_user(BUILDER2).get(f"/api/agents/{aid}").status_code == 200
    ids = [a["id"] for a in as_user(BUILDER2).get("/api/agents").json()]
    assert aid in ids
    # view-only: cannot edit (PUT -> 403); non-owner cannot reshare
    assert as_user(BUILDER2).put(f"/api/agents/{aid}", json={"name": "hack"}).status_code == 403
    assert as_user(BUILDER2).put(f"/api/agents/{aid}/share", json={"access": "account"}).status_code == 403
    # upgrade to edit
    as_user(BUILDER).put(f"/api/agents/{aid}/share", json={"members": [
        {"type": "user", "id": "builder2@example.com", "role": "edit"}]})
    assert as_user(BUILDER2).put(f"/api/agents/{aid}", json={"name": "renamed"}).status_code == 200
    # an update from an older client (no share field) must not wipe the share
    assert as_user(BUILDER).get(f"/api/agents/{aid}").json()["share"]["members"]
    assert any(a["action"] == "agent.share" for a in audit_log())


def test_published_still_hospital_wide(fs, as_user):
    fs.put("agents/p1", {"name": "P", "owner_uid": BUILDER.uid, "owner_email": BUILDER.email, "status": "published", "version": 1})
    assert as_user(PLAIN).get("/api/agents/p1").status_code == 200


def test_groups_admin_only_and_directory(fs, as_user):
    assert as_user(BUILDER).post("/api/groups", json={"name": "ICU"}).status_code == 403
    c = as_user(ADMIN)
    r = c.post("/api/groups", json={"name": "ICU", "member_emails": ["Nurse@Example.com", "nurse@example.com"]})
    assert r.status_code == 201 and r.json()["member_emails"] == ["nurse@example.com"]
    assert c.post("/api/groups", json={"name": "ICU"}).status_code == 201  # duplicate names are allowed
    fs.put("users/nurse@example.com", {"email": "nurse@example.com", "name": "Nina", "department": "護理部", "status": "active"})
    fs.put("users/gone@example.com", {"email": "gone@example.com", "name": "Nina Gone", "status": "suspended"})
    d = as_user(PLAIN).get("/api/directory", params={"q": "nin"}).json()
    assert [u["email"] for u in d["users"]] == ["nurse@example.com"]
    d = as_user(PLAIN).get("/api/directory", params={"q": "icu"}).json()
    assert d["groups"][0]["name"] == "ICU" and d["groups"][0]["member_count"] == 1
    assert as_user(PLAIN).get("/api/groups").status_code == 403
