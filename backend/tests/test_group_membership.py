"""Membership lives on users/{email}.groups (2026-11-02 decision); groups/{id} no longer stores member_emails."""
from types import SimpleNamespace

import pytest

from app.routers import groups as groups_router
from scripts import migrate_group_membership

from .conftest import ADMIN


@pytest.fixture(autouse=True)
def any_domain(monkeypatch):
    monkeypatch.setattr(groups_router, "settings", lambda: SimpleNamespace(allowed_domain_list=[]))


def user(fs, email, groups=()):
    fs.put(f"users/{email}", {"email": email, "name": email.split("@")[0], "status": "active", "role": "user",
                              "groups": list(groups)})


def test_create_stores_membership_on_users_and_not_on_group(fs, as_user):
    user(fs, "a@example.test")
    user(fs, "b@example.test")
    r = as_user(ADMIN).post("/api/groups", json={"name": "ICU", "member_emails": ["B@example.test", "ghost@example.test",
                                                                                   "a@example.test"]})
    gid = r.json()["id"]
    assert r.status_code == 201 and r.json()["member_emails"] == ["a@example.test", "b@example.test"]
    assert fs.store["users/a@example.test"]["groups"] == [gid]
    assert fs.store["users/b@example.test"]["groups"] == [gid]
    assert "member_emails" not in fs.store[f"groups/{gid}"]
    assert not any(p == "users/ghost@example.test" for p in fs.store)


def test_put_replaces_membership(fs, as_user):
    user(fs, "a@example.test", groups=["g1"])
    user(fs, "b@example.test")
    fs.put("groups/g1", {"name": "ICU"})
    r = as_user(ADMIN).put("/api/groups/g1", json={"name": "ICU", "description": "", "member_emails": ["b@example.test"]})
    assert r.json()["member_emails"] == ["b@example.test"]
    assert fs.store["users/a@example.test"]["groups"] == []
    assert fs.store["users/b@example.test"]["groups"] == ["g1"]


def test_delete_group_drops_the_id_from_every_member(fs, as_user):
    user(fs, "a@example.test", groups=["g1", "g2"])
    fs.put("groups/g1", {"name": "ICU"})
    fs.put("groups/g2", {"name": "ER"})
    assert as_user(ADMIN).delete("/api/groups/g1").status_code == 204
    assert fs.store["users/a@example.test"]["groups"] == ["g2"]


def test_migration_dry_run_changes_nothing_and_apply_moves_membership(fs, monkeypatch):
    user(fs, "a@example.test")
    fs.put("groups/g1", {"name": "ICU", "member_emails": ["a@example.test", "ghost@example.test"]})
    monkeypatch.setattr(migrate_group_membership.db, "client", lambda: fs)

    migrate_group_membership.main(apply=False)
    assert fs.store["groups/g1"]["member_emails"] == ["a@example.test", "ghost@example.test"]
    assert fs.store["users/a@example.test"]["groups"] == []

    migrate_group_membership.main(apply=True)
    migrate_group_membership.main(apply=True)  # re-run is harmless
    assert fs.store["users/a@example.test"]["groups"] == ["g1"]
    assert "member_emails" not in fs.store["groups/g1"]
    assert not any(p == "users/ghost@example.test" for p in fs.store)
