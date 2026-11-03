"""Users management guarded by the `users` / `users-viewer` permissions (see auth.require_permission)."""
from app.auth import User

from .conftest import ADMIN, PLAIN


def staff_with(fs, rid, permissions):
    fs.put(f"roles/{rid}", {"id": rid, "name": rid, "custom": True, "permissions": permissions})
    return User(uid=f"u-{rid}", email=f"{rid}@example.com", name=rid, role="user", roles=(rid,))


def seed_target(fs):
    fs.put("users/target@example.com", {"email": "target@example.com", "uid": "u-t", "name": "T", "role": "user",
                                        "status": "active", "department": "護理部", "roles": []})


def test_users_viewer_reads_but_cannot_write(fs, as_user):
    seed_target(fs)
    client = as_user(staff_with(fs, "ro", ["users-viewer"]))
    assert client.get("/api/users").status_code == 200
    assert client.get("/api/users/target@example.com").status_code == 200
    assert client.patch("/api/users/target@example.com", json={"department": "藥劑部"}).status_code == 403
    assert client.post("/api/users", json={"email": "new@example.com", "role": "user"}).status_code == 403
    assert client.get("/api/users/export.csv").status_code == 403  # personal data: write-level
    assert client.delete("/api/users/target@example.com").status_code == 403
    assert fs.store["users/target@example.com"]["department"] == "護理部"


def test_users_permission_reads_and_writes(fs, as_user):
    seed_target(fs)
    client = as_user(staff_with(fs, "editor", ["users"]))
    assert client.get("/api/users").status_code == 200
    assert client.get("/api/users/export.csv").status_code == 200
    assert client.patch("/api/users/target@example.com", json={"department": "藥劑部"}).status_code == 200
    assert fs.store["users/target@example.com"]["department"] == "藥劑部"


def test_user_without_users_permission_is_refused(fs, as_user):
    seed_target(fs)
    client = as_user(staff_with(fs, "other", ["chat"]))
    assert client.get("/api/users").status_code == 403
    assert client.get("/api/users/target@example.com").status_code == 403
    assert as_user(PLAIN).get("/api/users").status_code == 403


def test_admin_account_role_still_passes(fs, as_user):
    seed_target(fs)
    assert as_user(ADMIN).get("/api/users").status_code == 200
