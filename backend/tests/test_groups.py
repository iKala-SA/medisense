"""Group CRUD, member management and the group audit trail (specifications/BE-GROUP-SPEC.md)."""
from types import SimpleNamespace

import pytest

from app.auth import User
from app.routers import groups as groups_router

from .conftest import ADMIN, PLAIN


@pytest.fixture(autouse=True)
def any_domain(monkeypatch):
    """Tests must not depend on the local .env ALLOWED_DOMAINS; an empty list allows every domain."""
    monkeypatch.setattr(groups_router, "settings", lambda: SimpleNamespace(allowed_domain_list=[]))


def seed_group(fs, gid="g1", name="護理部", members=()):
    fs.put(f"groups/{gid}", {"name": name, "description": "", "created_by": ADMIN.email, "created_at": None,
                             "updated_at": None})
    for email in members:  # membership lives on the user: users/{email}.groups
        seed_user(fs, email, groups=[*fs.store.get(f"users/{email}", {}).get("groups", []), gid])


def seed_user(fs, email, name="", status="active", department="護理部", groups=None):
    cur = fs.store.get(f"users/{email}", {})
    fs.put(f"users/{email}", {**cur, "email": email, "name": name, "status": status, "department": department,
                              "role": "user", "groups": list(groups if groups is not None else cur.get("groups", []))})


def members_of(fs, gid):
    return sorted(p.split("/", 1)[1] for p, d in fs.store.items()
                  if p.startswith("users/") and gid in (d.get("groups") or []))


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
    assert members_of(fs, "g1") == ["already@example.test", "new-a@example.test", "new-b@example.test"]
    assert "member_emails" not in fs.store["groups/g1"]
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
    assert len(members_of(fs, "g1")) == 1000


def test_remove_member_and_missing_member(fs, as_user, audit_log):
    seed_group(fs, members=["staff-a@example.test", "staff-b@example.test"])
    client = as_user(ADMIN)
    assert client.delete("/api/groups/g1/members/Staff-A@example.test").status_code == 204
    assert members_of(fs, "g1") == ["staff-b@example.test"]
    assert fs.store["users/staff-a@example.test"]["groups"] == []
    assert client.delete("/api/groups/g1/members/staff-a@example.test").status_code == 404
    assert any(a["action"] == "group.member_remove" and a["email"] == "staff-a@example.test" for a in audit_log())


def test_list_members_shows_account_state(fs, as_user):
    seed_group(fs, members=["zeta@example.test", "alpha@example.test"])
    seed_user(fs, "zeta@example.test", "甲", status="suspended")
    seed_user(fs, "alpha@example.test", "")
    r = as_user(ADMIN).get("/api/groups/g1/members")
    assert r.status_code == 200
    rows = {m["email"]: m for m in r.json()}
    assert rows["zeta@example.test"]["status"] == "suspended"
    assert rows["alpha@example.test"]["has_account"] is True
    # sorted by name, falling back to e-mail when the name is empty
    assert [m["email"] for m in r.json()] == ["alpha@example.test", "zeta@example.test"]


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


def test_role_ids_default_empty_and_grant_then_remove(fs, as_user, audit_log):
    seed_group(fs)  # legacy document without role_ids
    client = as_user(ADMIN)
    assert client.get("/api/groups/g1").json()["role_ids"] == []
    r = client.patch("/api/groups/g1", json={"role_ids": ["builder", "builder"]})
    assert r.status_code == 200 and r.json()["role_ids"] == ["builder"]
    assert any(a["action"] == "group.update" and a["new_role_ids"] == ["builder"] and a["old_role_ids"] == []
               for a in audit_log())
    r = client.patch("/api/groups/g1", json={"role_ids": []})
    assert r.json()["role_ids"] == []
    assert r.json()["member_emails"] == []  # PATCH of role_ids never touches members


def test_role_ids_reject_unknown_role_without_writing(fs, as_user):
    seed_group(fs)
    client = as_user(ADMIN)
    assert client.patch("/api/groups/g1", json={"role_ids": ["no-such-role"]}).status_code == 422
    assert client.post("/api/groups", json={"name": "x", "role_ids": ["no-such-role"]}).status_code == 422
    assert fs.store["groups/g1"].get("role_ids") is None  # nothing written on rejection


def test_role_ids_accept_admin_and_user(fs, as_user):
    seed_group(fs)
    r = as_user(ADMIN).patch("/api/groups/g1", json={"role_ids": ["admin", "user", "builder"]})
    assert r.status_code == 200 and r.json()["role_ids"] == ["admin", "user", "builder"]


def test_role_ids_accept_stored_custom_role_document(fs, as_user):
    fs.put("roles/auditor", {"id": "auditor", "name": "稽核員", "custom": True})
    seed_group(fs)
    r = as_user(ADMIN).patch("/api/groups/g1", json={"role_ids": ["auditor"]})
    assert r.status_code == 200 and r.json()["role_ids"] == ["auditor"]


def test_role_ids_survive_member_changes(fs, as_user):
    seed_group(fs, members=["staff-a@example.test"])
    client = as_user(ADMIN)
    client.patch("/api/groups/g1", json={"role_ids": ["builder"]})
    client.delete("/api/groups/g1/members/staff-a@example.test")
    assert fs.store["groups/g1"]["role_ids"] == ["builder"]


def test_create_and_put_strip_name_and_description(fs, as_user):
    c = as_user(ADMIN)
    r = c.post("/api/groups", json={"name": "  護理部  ", "description": "  說明  ", "member_emails": [], "role_ids": []})
    assert r.status_code == 201
    assert r.json()["name"] == "護理部" and r.json()["description"] == "說明"
    assert c.post("/api/groups", json={"name": "   ", "member_emails": []}).status_code == 422


def test_patch_role_ids_drops_empty_strings(fs, as_user):
    seed_group(fs)
    r = as_user(ADMIN).patch("/api/groups/g1", json={"role_ids": ["", " user ", "user", "  "]})
    assert r.status_code == 200
    assert r.json()["role_ids"] == ["user"]


def seed_role(fs, rid, permissions):
    fs.put(f"roles/{rid}", {"id": rid, "name": rid, "custom": True, "permissions": permissions})


def staff(uid, roles=(), groups=()):
    return User(uid=f"u-{uid}", email=f"{uid}@example.com", name=uid, role="user", roles=tuple(roles),
                groups=tuple(groups))


def test_viewer_can_read_groups_but_not_write(fs, as_user):
    seed_group(fs, members=["staff-a@example.test"])
    seed_role(fs, "ro", ["groups-viewer"])
    client = as_user(staff("viewer", roles=["ro"]))
    assert client.get("/api/groups").status_code == 200
    assert client.get("/api/groups/g1").status_code == 200
    assert client.get("/api/groups/g1/members").status_code == 200
    assert client.post("/api/groups", json={"name": "x", "description": "", "member_emails": []}).status_code == 403
    assert client.patch("/api/groups/g1", json={"name": "x"}).status_code == 403
    assert client.put("/api/groups/g1", json={"name": "x", "description": "", "member_emails": []}).status_code == 403
    assert client.delete("/api/groups/g1").status_code == 403
    assert client.post("/api/groups/g1/members", json={"emails": ["a@example.test"]}).status_code == 403
    assert client.delete("/api/groups/g1/members/staff-a@example.test").status_code == 403
    assert fs.store["groups/g1"]["name"] == "護理部"
    assert members_of(fs, "g1") == ["staff-a@example.test"]


def test_groups_permission_allows_read_and_write(fs, as_user):
    seed_group(fs)
    seed_role(fs, "editor", ["groups"])
    client = as_user(staff("editor", roles=["editor"]))
    assert client.get("/api/groups").status_code == 200
    assert client.patch("/api/groups/g1", json={"description": "夜班"}).status_code == 200
    assert client.post("/api/groups", json={"name": "藥劑部", "description": "", "member_emails": []}).status_code == 201


def test_group_role_grants_groups_permission(fs, as_user):
    seed_group(fs)
    seed_role(fs, "editor", ["groups"])
    fs.put("groups/ops", {"name": "營運", "description": "", "role_ids": ["editor"]})
    client = as_user(staff("member", groups=["ops"]))
    assert client.patch("/api/groups/g1", json={"description": "夜班"}).status_code == 200


def test_user_without_groups_permission_is_refused(fs, as_user):
    seed_group(fs)
    seed_role(fs, "other", ["chat", "spaces"])
    client = as_user(staff("nobody", roles=["other"]))
    assert client.get("/api/groups").status_code == 403
    assert client.get("/api/groups/g1").status_code == 403
    assert client.get("/api/groups/g1/members").status_code == 403
    assert client.patch("/api/groups/g1", json={"name": "x"}).status_code == 403


def test_plain_user_without_any_role_is_refused(fs, as_user):
    seed_group(fs)
    assert as_user(PLAIN).get("/api/groups").status_code == 403
