"""Group CRUD, member management and the group audit trail (specifications/BE-GROUP-SPEC.md)."""
from types import SimpleNamespace

import pytest

from app.routers import groups as groups_router

from .conftest import ADMIN, PLAIN


@pytest.fixture(autouse=True)
def any_domain(monkeypatch):
    """Tests must not depend on the local .env ALLOWED_DOMAINS; an empty list allows every domain."""
    monkeypatch.setattr(groups_router, "settings", lambda: SimpleNamespace(allowed_domain_list=[]))


def seed_group(fs, gid="g1", name="護理部", members=()):
    fs.put(f"groups/{gid}", {"name": name, "description": "", "member_emails": list(members),
                             "created_by": ADMIN.email, "created_at": None, "updated_at": None})


def seed_user(fs, email, name="", status="active", department="護理部"):
    fs.put(f"users/{email}", {"email": email, "name": name, "status": status, "department": department,
                              "role": "user"})


def test_patch_updates_name_and_keeps_members(fs, as_user, audit_log):
    seed_group(fs, members=["staff-a@example.test"])
    r = as_user(ADMIN).patch("/api/groups/g1", json={"description": "夜班"})
    assert r.status_code == 200
    assert r.json()["description"] == "夜班"
    assert r.json()["member_emails"] == ["staff-a@example.test"]
    assert fs.store["groups/g1"]["updated_by"] == ADMIN.email
    assert any(a["action"] == "group.update" and a["fields"] == ["description"] for a in audit_log())


def test_duplicate_group_names_are_allowed(fs, as_user):
    seed_group(fs, "g1", "護理部")
    seed_group(fs, "g2", "藥劑部")
    client = as_user(ADMIN)
    assert client.patch("/api/groups/g2", json={"name": "護理部"}).status_code == 200
    assert client.post("/api/groups", json={"name": "護理部", "description": "", "member_emails": []}).status_code == 201
    assert client.put("/api/groups/g1", json={"name": "護理部", "description": "", "member_emails": []}).status_code == 200


def test_patch_rejects_blank_name(fs, as_user):
    seed_group(fs)
    assert as_user(ADMIN).patch("/api/groups/g1", json={"name": "   "}).status_code == 422


def test_add_members_reports_added_skipped_and_rejected(fs, as_user, audit_log):
    seed_group(fs, members=["already@example.test"])
    seed_user(fs, "already@example.test")
    seed_user(fs, "new-a@example.test", "甲")
    seed_user(fs, "new-b@example.test", "乙")
    r = as_user(ADMIN).post("/api/groups/g1/members", json={"emails": [
        " New-A@Example.test ", "already@example.test", "new-a@example.test",
        "ghost@example.test", "not-an-email", "new-b@example.test"]})
    assert r.status_code == 200
    body = r.json()
    assert body["added"] == ["new-a@example.test", "new-b@example.test"]
    assert body["skipped"] == ["already@example.test", "new-a@example.test"]
    assert {"email": "ghost@example.test", "reason": "not_a_registered_account"} in body["rejected"]
    assert {"email": "not-an-email", "reason": "invalid_email"} in body["rejected"]
    assert fs.store["groups/g1"]["member_emails"] == ["already@example.test", "new-a@example.test",
                                                      "new-b@example.test"]
    assert not any(p == "users/ghost@example.test" for p in fs.store)  # never creates an account
    assert any(a["action"] == "group.member_add" and a["added"] == 2 for a in audit_log())


def test_add_members_rejects_domain_outside_allowed_list(fs, as_user, monkeypatch):
    monkeypatch.setattr(groups_router, "settings", lambda: SimpleNamespace(allowed_domain_list=["hospital.test"]))
    seed_group(fs)
    seed_user(fs, "outsider@example.test")
    r = as_user(ADMIN).post("/api/groups/g1/members", json={"emails": ["outsider@example.test"]})
    assert r.json()["rejected"] == [{"email": "outsider@example.test", "reason": "domain_not_allowed"}]


def test_add_members_limit_rejects_whole_batch(fs, as_user):
    seed_group(fs, members=[f"m{i}@example.test" for i in range(1000)])
    seed_user(fs, "late@example.test")
    r = as_user(ADMIN).post("/api/groups/g1/members", json={"emails": ["late@example.test"]})
    assert r.status_code == 422
    assert len(fs.store["groups/g1"]["member_emails"]) == 1000


def test_remove_member_and_missing_member(fs, as_user, audit_log):
    seed_group(fs, members=["staff-a@example.test", "staff-b@example.test"])
    client = as_user(ADMIN)
    assert client.delete("/api/groups/g1/members/Staff-A@example.test").status_code == 204
    assert fs.store["groups/g1"]["member_emails"] == ["staff-b@example.test"]
    assert client.delete("/api/groups/g1/members/staff-a@example.test").status_code == 404
    assert any(a["action"] == "group.member_remove" and a["email"] == "staff-a@example.test" for a in audit_log())


def test_list_members_shows_account_state(fs, as_user):
    seed_group(fs, members=["zeta@example.test", "alpha@example.test", "gone@example.test"])
    seed_user(fs, "zeta@example.test", "甲", status="suspended")
    seed_user(fs, "alpha@example.test", "")
    r = as_user(ADMIN).get("/api/groups/g1/members")
    assert r.status_code == 200
    rows = {m["email"]: m for m in r.json()}
    assert rows["zeta@example.test"]["status"] == "suspended"
    assert rows["alpha@example.test"]["has_account"] is True
    assert rows["gone@example.test"]["has_account"] is False
    # sorted by name, falling back to e-mail when the name is empty
    assert [m["email"] for m in r.json()] == ["alpha@example.test", "gone@example.test", "zeta@example.test"]


def test_member_endpoints_are_admin_only(fs, as_user):
    seed_group(fs, members=["staff-a@example.test"])
    client = as_user(PLAIN)
    assert client.patch("/api/groups/g1", json={"name": "x"}).status_code == 403
    assert client.get("/api/groups/g1/members").status_code == 403
    assert client.post("/api/groups/g1/members", json={"emails": ["a@example.test"]}).status_code == 403
    assert client.delete("/api/groups/g1/members/staff-a@example.test").status_code == 403


def test_member_endpoints_404_for_unknown_group(fs, as_user):
    client = as_user(ADMIN)
    assert client.get("/api/groups/nope/members").status_code == 404
    assert client.post("/api/groups/nope/members", json={"emails": ["a@example.test"]}).status_code == 404
    assert client.patch("/api/groups/nope", json={"name": "x"}).status_code == 404


def test_create_sets_updated_by(fs, as_user):
    r = as_user(ADMIN).post("/api/groups", json={"name": "新群組", "description": "", "member_emails": []})
    assert r.status_code == 201
    assert r.json()["updated_by"] == ADMIN.email


def test_member_rows_keep_their_own_name_when_snapshots_come_back_unordered(fs, as_user, monkeypatch):
    """Firestore get_all makes no ordering promise; each row must still carry its own name and e-mail."""
    seed_group(fs, members=["aaa@example.test", "bbb@example.test", "ccc@example.test"])
    seed_user(fs, "aaa@example.test", "甲")
    seed_user(fs, "bbb@example.test", "乙")
    seed_user(fs, "ccc@example.test", "丙")
    real_get_all = fs.get_all
    monkeypatch.setattr(fs, "get_all", lambda refs: list(reversed(real_get_all(refs))))
    rows = {m["email"]: m["name"] for m in as_user(ADMIN).get("/api/groups/g1/members").json()}
    assert rows == {"aaa@example.test": "甲", "bbb@example.test": "乙", "ccc@example.test": "丙"}
