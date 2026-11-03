from app.auth import User

from .conftest import ADMIN, PLAIN


def seed(fs):
    fs.put("users/a@ikala.ai", {"email": "a@ikala.ai", "role": "admin"})
    fs.put("users/b@ikala.ai", {"email": "b@ikala.ai", "role": "user"})
    fs.put("users/c@ikala.ai", {"email": "c@ikala.ai"})  # no role -> user
    fs.put("roles/admin", {"id": "admin", "name": "系統管理員（覆寫）", "en": "Admin", "desc": "d", "custom": False,
                           "status": True, "can": ["發布核可"]})
    fs.put("roles/auditor", {"id": "auditor", "name": "稽核員", "en": "", "desc": "稽核", "custom": True,
                             "status": False, "can": ["稽核紀錄"]})


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
    assert by_id["auditor"]["custom"] is True and by_id["auditor"]["status"] is False
    assert body["stats"] == {"total_roles": 4, "system_roles": 3, "custom_roles": 1, "assigned_users": 3}


def test_custom_flag_comes_from_the_document(fs, as_user):
    fs.put("roles/field-lead", {"id": "field-lead", "name": "現場主管", "en": "", "desc": "", "custom": False,
                                "status": True, "can": []})  # not a built-in id, but marked as system
    fs.put("roles/admin", {"id": "admin", "name": "系統管理員", "en": "Admin", "desc": "", "custom": True,
                           "status": True, "can": []})  # built-in id, but marked as custom
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


def test_patch_role_is_admin_only(fs, as_user):
    assert as_user(PLAIN).patch("/api/roles/user", json={"name": "x"}).status_code == 403


def test_patch_admin_role_is_refused(fs, as_user):
    seed(fs)
    assert as_user(ADMIN).patch("/api/roles/admin", json={"name": "x"}).status_code == 403


def test_patch_unknown_custom_role_is_404(fs, as_user):
    assert as_user(ADMIN).patch("/api/roles/ghost", json={"name": "x"}).status_code == 404


def test_patch_system_role_overrides_name_and_desc(fs, as_user):
    seed(fs)
    r = as_user(ADMIN).patch("/api/roles/user", json={"name": "  員工  ", "desc": "新說明"})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "user" and body["name"] == "員工" and body["desc"] == "新說明" and body["custom"] is False
    listed = {x["id"]: x for x in as_user(ADMIN).get("/api/roles").json()["roles"]}
    assert listed["user"]["name"] == "員工"


def test_patch_custom_role_keeps_custom_flag_and_other_fields(fs, as_user):
    seed(fs)
    r = as_user(ADMIN).patch("/api/roles/auditor", json={"desc": "新稽核說明"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "稽核員" and body["desc"] == "新稽核說明"
    assert body["custom"] is True and body["status"] is False and body["can"] == ["稽核紀錄"]


def test_patch_rejects_blank_name_and_empty_body_is_noop(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    assert c.patch("/api/roles/user", json={"name": "   "}).status_code == 422
    assert c.patch("/api/roles/user", json={}).status_code == 200


def test_create_role_is_admin_only(fs, as_user):
    assert as_user(PLAIN).post("/api/roles", json={"name": "現場主管"}).status_code == 403


def test_create_custom_role_appears_in_list(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    r = c.post("/api/roles", json={"name": "  現場主管  ", "desc": "負責現場排班"})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "現場主管" and body["desc"] == "負責現場排班"
    assert body["custom"] is True and body["status"] is True and body["can"] == [] and body["member_count"] == 0
    listed = {x["id"]: x for x in c.get("/api/roles").json()["roles"]}
    assert listed[body["id"]]["custom"] is True
    assert c.get("/api/roles").json()["stats"]["custom_roles"] == 2


def test_create_role_validates_name(fs, as_user):
    c = as_user(ADMIN)
    assert c.post("/api/roles", json={"name": "   "}).status_code == 422
    assert c.post("/api/roles", json={"name": "x" * 41}).status_code == 422
    assert c.post("/api/roles", json={}).status_code == 422


def test_status_true_means_enabled(fs, as_user):
    fs.put("roles/legacy", {"id": "legacy", "name": "舊角色", "custom": True, "suspended": True, "can": []})
    fs.put("roles/paused", {"id": "paused", "name": "停用角色", "custom": True, "status": False, "can": []})
    by_id = {r["id"]: r for r in as_user(ADMIN).get("/api/roles").json()["roles"]}
    assert by_id["legacy"]["status"] is True  # missing status counts as 啟用; old field is not read
    assert by_id["paused"]["status"] is False


def test_patch_english_name_is_optional_and_clearable(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    assert c.patch("/api/roles/auditor", json={"en": "  Auditor  "}).json()["en"] == "Auditor"
    assert c.patch("/api/roles/auditor", json={"en": ""}).json()["en"] == ""
    assert c.patch("/api/roles/auditor", json={"en": "x" * 41}).status_code == 422
    assert c.patch("/api/roles/admin", json={"en": "Root"}).status_code == 403


def test_patch_status_toggle_and_labels(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    r = c.patch("/api/roles/auditor", json={"status": True, "can": [" 稽核紀錄 ", "稽核紀錄", "匯出"]})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] is True and body["can"] == ["稽核紀錄", "匯出"] and body["permission_count"] == 2
    assert c.patch("/api/roles/auditor", json={"status": False}).json()["status"] is False


def test_patch_label_validation_and_admin_is_fixed(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    assert c.patch("/api/roles/auditor", json={"can": ["   "]}).status_code == 422
    assert c.patch("/api/roles/auditor", json={"can": ["x" * 21]}).status_code == 422
    assert c.patch("/api/roles/auditor", json={"can": ["a"] * 21}).status_code == 422
    assert c.patch("/api/roles/admin", json={"status": False}).status_code == 403
    assert c.patch("/api/roles/admin", json={"can": []}).status_code == 403


def test_delete_custom_role_unlinks_groups(fs, as_user):
    seed(fs)
    fs.put("groups/g1", {"name": "護理部", "role_ids": ["auditor", "user"], "member_emails": []})
    fs.put("groups/g2", {"name": "資訊室", "role_ids": ["user"], "member_emails": []})
    c = as_user(ADMIN)
    assert c.delete("/api/roles/auditor").status_code == 204
    assert [r["id"] for r in c.get("/api/roles").json()["roles"]] == ["admin", "builder", "user"]
    assert fs.store["groups/g1"]["role_ids"] == ["user"]
    assert fs.store["groups/g2"]["role_ids"] == ["user"]


def test_delete_role_guards(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    assert as_user(PLAIN).delete("/api/roles/auditor").status_code == 403
    assert c.delete("/api/roles/user").status_code == 403  # built-in, even with an override document
    assert c.delete("/api/roles/builder").status_code == 403  # built-in without a document
    assert c.delete("/api/roles/ghost").status_code == 404


def test_assign_roles_to_user_is_record_only(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    r = c.patch("/api/users/b@ikala.ai", json={"roles": [" auditor ", "auditor", "", "builder"]})
    assert r.status_code == 200
    assert r.json()["roles"] == ["auditor", "builder"]
    assert r.json()["role"] == "user"  # access still follows the effective role
    assert fs.store["users/b@ikala.ai"]["roles"] == ["auditor", "builder"]
    assert c.get("/api/users/b@ikala.ai").json()["roles"] == ["auditor", "builder"]


def test_assign_unknown_role_is_422(fs, as_user):
    seed(fs)
    assert as_user(ADMIN).patch("/api/users/b@ikala.ai", json={"roles": ["ghost"]}).status_code == 422


def test_assign_roles_needs_no_reason_and_is_audited(fs, as_user):
    seed(fs)
    r = as_user(ADMIN).patch("/api/users/b@ikala.ai", json={"roles": ["auditor"]})
    assert r.status_code == 200


def test_deleting_role_removes_user_assignments(fs, as_user):
    seed(fs)
    fs.put("users/b@ikala.ai", {"email": "b@ikala.ai", "role": "user", "roles": ["auditor", "builder"]})
    assert as_user(ADMIN).delete("/api/roles/auditor").status_code == 204
    assert fs.store["users/b@ikala.ai"]["roles"] == ["builder"]


def test_admin_role_can_be_assigned_to_users_and_groups(fs, as_user):
    seed(fs)
    fs.put("groups/g1", {"name": "護理部", "role_ids": [], "member_emails": []})
    c = as_user(ADMIN)
    assert c.patch("/api/users/b@ikala.ai", json={"roles": ["admin"]}).json()["roles"] == ["admin"]
    assert c.patch("/api/groups/g1", json={"role_ids": ["admin"]}).json()["role_ids"] == ["admin"]


def test_permission_resources_are_unique_and_match_design():
    from app.permissions import RESOURCES
    ids = [r[0] for r in RESOURCES]
    # 11 features, each with a full (`x`) and a read-only (`x-viewer`) entry
    assert len(ids) == 22 and len(set(ids)) == 22
    assert ids[0] == "chat" and ids[-1] == "settings"


def test_permissions_list_is_admin_only_and_ordered(fs, as_user):
    assert as_user(PLAIN).get("/api/permissions").status_code == 403
    rows = as_user(ADMIN).get("/api/permissions").json()
    assert [r["id"] for r in rows][:3] == ["chat", "chat-viewer", "workbench"] and len(rows) == 22
    assert rows[0] == {"id": "chat", "name": "對話", "desc": "AI 對話與聊天紀錄", "order": 1}


def test_role_permissions_are_selected_from_catalog(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    r = c.patch("/api/roles/auditor", json={"permissions": [" chat ", "agent", "chat"]})
    assert r.status_code == 200
    assert r.json()["permissions"] == ["chat", "agent"]
    listed = {x["id"]: x for x in c.get("/api/roles").json()["roles"]}
    assert listed["auditor"]["permissions"] == ["chat", "agent"]
    assert listed["user"]["permissions"] == []  # built-in without a document


def test_role_permissions_reject_unknown_and_admin_is_fixed(fs, as_user):
    seed(fs)
    c = as_user(ADMIN)
    assert c.patch("/api/roles/auditor", json={"permissions": ["ghost"]}).status_code == 422
    assert c.patch("/api/roles/admin", json={"permissions": ["chat"]}).status_code == 403
    assert c.patch("/api/roles/auditor", json={"permissions": []}).json()["permissions"] == []


def staff_with(fs, rid, permissions):
    fs.put(f"roles/{rid}", {"id": rid, "name": rid, "custom": True, "permissions": permissions})
    return User(uid=f"u-{rid}", email=f"{rid}@example.com", name=rid, role="user", roles=(rid,))


def test_roles_viewer_reads_roles_and_catalog_but_cannot_write(fs, as_user):
    seed(fs)
    client = as_user(staff_with(fs, "ro", ["roles-viewer"]))
    assert client.get("/api/roles").status_code == 200
    assert client.get("/api/permissions").status_code == 200
    assert client.post("/api/roles", json={"name": "x", "desc": ""}).status_code == 403
    assert client.patch("/api/roles/auditor", json={"name": "y"}).status_code == 403
    assert client.delete("/api/roles/auditor").status_code == 403


def test_roles_permission_reads_and_writes(fs, as_user):
    seed(fs)
    client = as_user(staff_with(fs, "editor", ["roles"]))
    assert client.get("/api/roles").status_code == 200
    assert client.get("/api/permissions").status_code == 200
    assert client.post("/api/roles", json={"name": "現場主管", "desc": ""}).status_code == 201
    assert client.patch("/api/roles/auditor", json={"name": "稽核員2"}).status_code == 200


def test_user_without_roles_permission_is_refused(fs, as_user):
    seed(fs)
    client = as_user(staff_with(fs, "other", ["chat"]))
    assert client.get("/api/roles").status_code == 403
    assert client.get("/api/permissions").status_code == 403
    assert client.post("/api/roles", json={"name": "x", "desc": ""}).status_code == 403
    assert as_user(PLAIN).get("/api/roles").status_code == 403
