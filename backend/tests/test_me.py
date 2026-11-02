from app.auth import User

from .conftest import PLAIN


def test_me_without_roles_returns_empty_lists(fs, as_user):
    body = as_user(PLAIN).get("/api/me").json()
    assert body["roles"] == [] and body["groups"] == [] and body["permissions"] == []
    assert body["role"] == "user"


def test_me_returns_assigned_roles_and_their_permissions(fs, as_user):
    fs.put("roles/auditor", {"id": "auditor", "name": "稽核員", "custom": True, "permissions": ["settings", "chat"]})
    fs.put("roles/spaces-lead", {"id": "spaces-lead", "name": "空間主管", "custom": True, "permissions": ["spaces", "chat"]})
    fs.put("roles/unknown", {"id": "unknown", "name": "x", "custom": True, "permissions": ["no-such-resource"]})
    user = User(uid="u-x", email="x@example.com", name="X", role="user",
                roles=("auditor", "spaces-lead", "missing-doc"))
    body = as_user(user).get("/api/me").json()
    assert body["roles"] == ["auditor", "spaces-lead", "missing-doc"]
    # union, deduplicated, in the order of app/permissions.py
    assert body["permissions"] == ["chat", "spaces", "settings"]


def test_unknown_permission_ids_in_storage_are_dropped(fs, as_user):
    fs.put("roles/bad", {"id": "bad", "name": "bad", "custom": True, "permissions": ["no-such-resource"]})
    user = User(uid="u-x", email="x@example.com", name="X", role="user", roles=("bad",))
    assert as_user(user).get("/api/me").json()["permissions"] == []


def test_permissions_union_user_roles_and_group_roles_distinct(fs, as_user):
    fs.put("roles/auditor", {"id": "auditor", "name": "稽核員", "custom": True, "permissions": ["settings", "chat"]})
    fs.put("roles/spaces-lead", {"id": "spaces-lead", "name": "空間主管", "custom": True, "permissions": ["spaces", "chat"]})
    fs.put("roles/ops", {"id": "ops", "name": "營運", "custom": True, "permissions": ["connectors", "spaces"]})
    fs.put("groups/g-ward", {"name": "病房", "role_ids": ["spaces-lead", "ops"]})
    fs.put("groups/g-empty", {"name": "空群組", "role_ids": []})
    user = User(uid="u-x", email="x@example.com", name="X", role="user", roles=("auditor",),
                groups=("g-ward", "g-empty", "g-deleted"))
    body = as_user(user).get("/api/me").json()
    assert body["roles"] == ["auditor"]  # user.roles only; group roles are not added to `roles`
    assert body["groups"] == ["g-ward", "g-empty", "g-deleted"]
    assert body["permissions"] == ["chat", "connectors", "spaces", "settings"]  # distinct, RESOURCES order


def test_group_roles_alone_grant_permissions(fs, as_user):
    fs.put("roles/ops", {"id": "ops", "name": "營運", "custom": True, "permissions": ["connectors"]})
    fs.put("groups/g-ward", {"name": "病房", "role_ids": ["ops"]})
    user = User(uid="u-x", email="x@example.com", name="X", role="user", groups=("g-ward",))
    assert as_user(user).get("/api/me").json()["permissions"] == ["connectors"]
