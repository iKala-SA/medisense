from .conftest import ADMIN, PLAIN


def seed(fs):
    fs.put("users/a@ikala.ai", {"email": "a@ikala.ai", "role": "admin"})
    fs.put("users/b@ikala.ai", {"email": "b@ikala.ai", "role": "user"})
    fs.put("users/c@ikala.ai", {"email": "c@ikala.ai"})  # no role -> user
    fs.put("roles/admin", {"id": "admin", "name": "系統管理員（覆寫）", "en": "Admin", "desc": "d", "custom": False,
                           "suspended": False, "can": ["發布核可"]})
    fs.put("roles/auditor", {"id": "auditor", "name": "稽核員", "en": "", "desc": "稽核", "custom": True,
                             "suspended": True, "can": ["稽核紀錄"]})


def test_list_roles_is_admin_only(fs, as_user):
    assert as_user(PLAIN).get("/api/roles").status_code == 403


def test_empty_collection_lists_system_roles(fs, as_user):
    body = as_user(ADMIN).get("/api/roles").json()
    assert [r["id"] for r in body["roles"]] == ["admin", "builder", "user"]
    assert body["stats"] == {"total_roles": 3, "system_roles": 3, "custom_roles": 0, "assigned_users": 0}


def test_stored_documents_override_and_add_custom_roles(fs, as_user):
    seed(fs)
    body = as_user(ADMIN).get("/api/roles").json()
    assert [r["id"] for r in body["roles"]] == ["admin", "builder", "user", "auditor"]
    by_id = {r["id"]: r for r in body["roles"]}
    assert by_id["admin"]["name"] == "系統管理員（覆寫）"
    assert by_id["admin"]["en"] == "Admin" and by_id["admin"]["permission_count"] == 1
    assert by_id["auditor"]["custom"] is True and by_id["auditor"]["suspended"] is True
    assert body["stats"] == {"total_roles": 4, "system_roles": 3, "custom_roles": 1, "assigned_users": 3}


def test_custom_flag_comes_from_the_document(fs, as_user):
    fs.put("roles/field-lead", {"id": "field-lead", "name": "現場主管", "en": "", "desc": "", "custom": False,
                                "suspended": False, "can": []})  # not a built-in id, but marked as system
    fs.put("roles/admin", {"id": "admin", "name": "系統管理員", "en": "Admin", "desc": "", "custom": True,
                           "suspended": False, "can": []})  # built-in id, but marked as custom
    by_id = {r["id"]: r for r in as_user(ADMIN).get("/api/roles").json()["roles"]}
    assert by_id["field-lead"]["custom"] is False
    assert by_id["admin"]["custom"] is True


def test_member_counts_use_effective_role(fs, as_user):
    seed(fs)
    by_id = {r["id"]: r for r in as_user(ADMIN).get("/api/roles").json()["roles"]}
    assert by_id["admin"]["member_count"] == 1
    assert by_id["user"]["member_count"] == 2  # explicit user and the one without a role
    assert by_id["auditor"]["member_count"] == 0


def test_filter_by_type_and_search(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    assert [r["id"] for r in c.get("/api/roles", params={"type": "custom"}).json()["roles"]] == ["auditor"]
    assert [r["id"] for r in c.get("/api/roles", params={"type": "system"}).json()["roles"]] == ["admin", "builder", "user"]
    assert [r["id"] for r in c.get("/api/roles", params={"search": "  稽核 "}).json()["roles"]] == ["auditor"]
    assert c.get("/api/roles", params={"type": "bogus"}).status_code == 422
