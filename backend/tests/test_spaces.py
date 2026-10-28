from .conftest import ADMIN, BUILDER, BUILDER2, PLAIN


def test_spaces_flow(fs, as_user, audit_log):
    fs.put("documents/d1", {"name": "Guideline", "status": "indexed"})
    fs.put("documents/d2", {"name": "Private", "status": "indexed", "uploaded_uid": "someone",
                            "share": {"access": "restricted", "members": []}})
    c = as_user(BUILDER)
    assert c.post("/api/spaces", json={"name": "S", "document_ids": ["d1", "zzz"]}).status_code == 422
    assert c.post("/api/spaces", json={"name": "S", "document_ids": ["d2"]}).status_code == 422
    assert c.post("/api/spaces", json={"name": "Org", "type": "org"}).status_code == 403
    s = c.post("/api/spaces", json={"name": "S", "type": "team", "document_ids": ["d1"]}).json()
    assert s["documents_count"] == 1 and s["my_role"] == "owner"
    assert as_user(PLAIN).get(f"/api/spaces/{s['id']}").status_code == 403
    assert c.post(f"/api/spaces/{s['id']}/documents", json={"document_ids": ["d1", "d1"]}).json()["document_ids"] == ["d1"]
    assert c.delete(f"/api/spaces/{s['id']}/documents/nope").status_code == 404
    assert c.delete(f"/api/spaces/{s['id']}/documents/d1").json()["documents_count"] == 0
    c.put(f"/api/spaces/{s['id']}/share", json={"members": [{"type": "user", "id": "builder2@example.com", "role": "edit"}]})
    assert as_user(BUILDER2).post(f"/api/spaces/{s['id']}/documents", json={"document_ids": ["d1"]}).status_code == 200
    assert as_user(BUILDER2).delete(f"/api/spaces/{s['id']}").status_code == 403
    org = as_user(ADMIN).post("/api/spaces", json={"name": "Hospital", "type": "org"}).json()
    assert org["id"] in [x["id"] for x in as_user(PLAIN).get("/api/spaces").json()]
    assert as_user(PLAIN).post(f"/api/spaces/{org['id']}/documents", json={"document_ids": ["d1"]}).status_code == 403
    assert c.delete(f"/api/spaces/{s['id']}").status_code == 204
    assert {"space.create", "space.documents", "space.share", "space.delete"} <= {a["action"] for a in audit_log()}
