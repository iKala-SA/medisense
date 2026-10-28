from datetime import UTC, datetime, timedelta

from .conftest import ADMIN, BUILDER, BUILDER2, PLAIN


def seed(fs, sid, uid, n, mins, **extra):
    fs.put(f"sessions/{sid}", {"uid": uid, "agent_id": "a1", "messages": [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"msg {i} " + "x" * 40} for i in range(n)],
        "updated_at": datetime(2026, 11, 1, tzinfo=UTC) + timedelta(minutes=mins), **extra})


def test_list_own_only_newest_first_with_paging(fs, as_user):
    seed(fs, "s1", BUILDER.uid, 2, 1, title="first")
    seed(fs, "s2", BUILDER.uid, 4, 2)
    seed(fs, "s3", BUILDER.uid, 2, 3, title="third")
    seed(fs, "other", BUILDER2.uid, 2, 9, title="secret")
    c = as_user(BUILDER)
    page = c.get("/api/sessions", params={"limit": 2}).json()
    assert [i["id"] for i in page["items"]] == ["s3", "s2"] and page["next_cursor"]
    assert page["items"][1]["title"].startswith("msg 0") and len(page["items"][1]["title"]) <= 30  # legacy fallback
    assert page["items"][1]["message_count"] == 4 and page["items"][0]["agent_id"] == "a1"
    nxt = c.get("/api/sessions", params={"limit": 2, "cursor": page["next_cursor"]}).json()
    assert [i["id"] for i in nxt["items"]] == ["s1"] and nxt["next_cursor"] is None


def test_get_rename_delete_are_own_only(fs, as_user, audit_log):
    seed(fs, "mine", BUILDER.uid, 2, 1, title="t")
    seed(fs, "theirs", BUILDER2.uid, 2, 2, title="t")
    c = as_user(BUILDER)
    d = c.get("/api/sessions/mine").json()
    assert [m["role"] for m in d["messages"]] == ["user", "assistant"]
    for sid in ("theirs", "nope"):
        assert c.get(f"/api/sessions/{sid}").status_code == 404
        assert c.patch(f"/api/sessions/{sid}", json={"title": "x"}).status_code == 404
        assert c.delete(f"/api/sessions/{sid}").status_code == 404
    assert as_user(ADMIN).get("/api/sessions/mine").status_code == 404  # not even admins
    assert c.patch("/api/sessions/mine", json={"title": "  New   name "}).json()["title"] == "New name"
    assert c.patch("/api/sessions/mine", json={"title": ""}).status_code == 422
    assert c.delete("/api/sessions/mine").status_code == 204
    assert "sessions/mine" not in fs.store and "sessions/theirs" in fs.store
    assert {"session.update", "session.delete"} <= {a["action"] for a in audit_log()}


def test_run_sets_title_from_deidentified_message(fs, as_user, monkeypatch):
    from app.engine import llm

    fs.put("agents/a1", {"name": "A", "owner_uid": BUILDER.uid, "status": "published", "version": 1})
    fs.put("agents/a1/versions/1", {"name": "A"})
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("王小明", "[PERSON]"))
    monkeypatch.setattr(llm, "complete", lambda **kw: llm.Completion("答", "gemini-3-flash", 1, 1, 0.0, 1))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    c = as_user(BUILDER)
    r = c.post("/api/agents/a1/run", json={"message": "王小明 的血壓偏高，請問建議的追蹤頻率與用藥調整方式是什麼"}).json()
    title = fs.store[f"sessions/{r['session_id']}"]["title"]
    assert "王小明" not in title and title.startswith("[PERSON]") and len(title) == 30
    c.post("/api/agents/a1/run", json={"message": "second", "session_id": r["session_id"]})
    assert fs.store[f"sessions/{r['session_id']}"]["title"] == title  # only the first run titles


def test_chat_default_agent_audit_and_attachment_limit(fs, as_user, monkeypatch, audit_log):
    from app.engine import llm

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return llm.Completion("hello", "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    c = as_user(BUILDER)
    r = c.post("/api/chat", json={"message": "hi there"}).json()
    assert r["reply"] == "hello" and fs.store[f"sessions/{r['session_id']}"]["title"] == "hi there"
    assert seen["group"] == "fast"  # auto -> default routing (simple) -> fast
    assert any(a["action"] == "chat.run" for a in audit_log())
    assert as_user(BUILDER2).post("/api/chat", json={"message": "x", "session_id": r["session_id"]}).status_code == 403
    # attachment text is added to the system prompt, never to the stored messages
    fs.store[f"sessions/{r['session_id']}"]["attachments"] = [{"id": "a", "name": "lab.txt", "text": "ALT 40", "chars": 6}]
    c.post("/api/chat", json={"message": "summarise", "session_id": r["session_id"]})
    assert "ALT 40" in seen["system"]
    assert all("ALT 40" not in m["content"] for m in fs.store[f"sessions/{r['session_id']}"]["messages"])


def test_chat_attachment_upload(fs, as_user, monkeypatch):
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("A123456789", "[ID]"))
    c = as_user(BUILDER)
    r = c.post("/api/chat/attachments", files={"file": ("note.txt", "病人 A123456789 肝功能 ALT 40".encode())})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "[ID]" in j["snippet"] and "A123456789" not in j["snippet"]
    assert fs.store[f"sessions/{j['session_id']}"]["attachments"][0]["name"] == "note.txt"
    assert c.post("/api/chat/attachments", files={"file": ("x.exe", b"MZ")}).status_code == 415
    assert as_user(BUILDER2).post("/api/chat/attachments", data={"session_id": j["session_id"]},
                                  files={"file": ("n.txt", b"hello")}).status_code == 403


def test_calendar_status(fs, as_user):
    # No calendar connector exists yet: an honest "not connected" with the reason (full flow: tests/test_open_connector.py).
    r = as_user(BUILDER).get("/api/calendar/status").json()
    assert r["connected"] is False and r["connector_id"] is None and r["reason"]


def test_chat_returns_thinking_and_persists_steps(fs, as_user, monkeypatch):
    from app.engine import llm

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return llm.Completion("答案", "gemini-3.1-pro", 3, 4, 0.0, 5, reasoning="先確認問題，再比較兩個選項")

    monkeypatch.setattr(llm, "complete", fake)
    c = as_user(BUILDER)
    r = c.post("/api/chat", json={"message": "請分析兩個方案", "model_group": "reasoning"}).json()
    assert r["trace"][1]["thinking"] == "先確認問題，再比較兩個選項" and seen["think"] == "medium"
    d = c.get(f"/api/sessions/{r['session_id']}").json()
    meta = d["messages"][1]["meta"]
    assert d["messages"][0]["meta"] is None and meta["trace"][1]["thinking"].startswith("先確認") and meta["citations"] == []


def test_chat_general_scope_offers_no_search_tool(fs, as_user, monkeypatch):
    from app.engine import llm

    seen = []
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr(llm, "complete", lambda **kw: seen.append(kw.get("tools")) or llm.Completion("ok", "gemini-3-flash", 1, 1, 0.0, 1))
    fs.put("documents/d1", {"status": "indexed", "rag_file": "f1", "name": "指引"})
    c = as_user(BUILDER)
    c.post("/api/chat", json={"message": "hi", "knowledge_scope": "general"})
    assert seen[-1] is None  # model only: nothing to call
    c.post("/api/chat", json={"message": "hi", "knowledge_scope": "all"})
    assert [t["function"]["name"] for t in seen[-1]] == ["search_knowledge"]  # indexed, visible documents are searchable


def _stub_chat(monkeypatch, models=("gemini-3-flash", "gemini-2.5-flash")):
    from app.engine import llm

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr(llm, "model_catalog", lambda: [{"id": m, "model": f"vertex_ai/{m}"} for m in models])
    seen = {}

    def fake(**kw):
        seen.update(kw)
        if kw.get("on_delta"):
            kw["on_delta"]("thought", "想一下")
            kw["on_delta"]("text", "你")
            kw["on_delta"]("text", "好")
        return llm.Completion("你好", kw.get("model") or "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr(llm, "complete", fake)
    return seen


def test_chat_pins_the_chosen_model(fs, as_user, monkeypatch):
    seen = _stub_chat(monkeypatch)
    c = as_user(BUILDER)
    r = c.post("/api/chat", json={"message": "hi", "model": "gemini-2.5-flash"}).json()
    assert seen["model"] == "gemini-2.5-flash" and r["trace"][1]["model"] == "gemini-2.5-flash"
    assert c.post("/api/chat", json={"message": "hi", "model": "gpt-9"}).status_code == 422


def test_chat_pin_is_ignored_when_sovereign_only(fs, as_user, monkeypatch):
    seen = _stub_chat(monkeypatch)
    monkeypatch.setattr("app.engine.routing.sovereign_only", lambda: True)
    as_user(BUILDER).post("/api/chat", json={"message": "hi", "model": "gemini-2.5-flash"})
    assert not seen.get("model") and seen["group"] == "sovereign"


def test_cited_document_viewer_respects_visibility(fs, as_user, monkeypatch):
    class Blob:
        def download_as_text(self, encoding="utf-8"):
            return "第一段\n第二段 ALT 40"

    class Bucket:
        def blob(self, path):
            assert path == "docs/d1/deidentified.txt"
            return Blob()

    monkeypatch.setattr("app.routers.chat._bucket", lambda: Bucket())
    monkeypatch.setattr("app.routers.knowledge.settings", lambda: type("S", (), {"upload_bucket": "test-bucket"})())
    fs.store["documents/d1"] = {"name": "指引.pdf", "version": 2, "deid_uri": "gs://test-bucket/docs/d1/deidentified.txt",
                                "share": {"access": "restricted", "role": "use", "members": []}, "uploaded_uid": BUILDER.uid}
    fs.store["documents/d2"] = {"name": "公開.pdf", "version": 1, "deid_uri": "gs://test-bucket/docs/d1/deidentified.txt"}
    r = as_user(PLAIN).get("/api/chat/documents/d2")
    assert r.status_code == 200 and r.json()["name"] == "公開.pdf" and "ALT 40" in r.json()["text"]
    assert as_user(PLAIN).get("/api/chat/documents/nope").status_code == 404
    assert as_user(PLAIN).get("/api/chat/documents/d1").status_code == 404  # not shared with this user


# ---- original-file viewing (routers/originals.py)
def _original_setup(fs, monkeypatch, pii):
    import app.routers.originals as o

    monkeypatch.setattr(o, "settings", lambda: type("S", (), {"download_signing_key": "k" * 32, "original_link_ttl_seconds": 120})())
    blob = type("Blob", (), {"download_as_bytes": lambda self: b"%PDF-1.4 original"})()
    monkeypatch.setattr(o, "_bucket", lambda: type("B", (), {"blob": lambda self, p: blob})())
    monkeypatch.setattr(o, "_blob_path", lambda uri: uri)
    text_blob = type("T", (), {"download_as_text": lambda self, encoding="utf-8": "去識別化文字"})()
    monkeypatch.setattr("app.routers.chat._bucket", lambda: type("B", (), {"blob": lambda self, p: text_blob})())
    fs.store["documents/d1"] = {"name": "指引.pdf", "version": 2, "gcs_uri": "gs://b/o.pdf", "deid_uri": "gs://b/d.txt", "pii": pii}
    return o


def _audits(fs, action):
    return [d for p, d in fs.store.items() if p.startswith("audit/") and d["action"] == action]


def test_original_without_personal_data_opens_for_anyone_and_is_audited(fs, as_user, monkeypatch):
    _original_setup(fs, monkeypatch, "none")
    c = as_user(PLAIN)
    r = c.post("/api/chat/documents/d1/original", json={})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["kind"] == "pdf" and j["ttl_seconds"] == 120 and PLAIN.email in j["watermark"]
    got = c.get(j["url"])
    assert got.status_code == 200 and got.content.startswith(b"%PDF") and got.headers["cache-control"] == "no-store"
    assert "inline" in got.headers["content-disposition"]
    assert "attachment" in c.get(j["url"] + "&download=true").headers["content-disposition"]
    opened = _audits(fs, "knowledge.original_open")
    assert len(opened) == 1 and opened[0]["actor_email"] == PLAIN.email and opened[0]["doc_id"] == "d1" and opened[0]["at"]
    assert [a["disposition"] for a in _audits(fs, "knowledge.original_fetch")] == ["view", "download"]


def test_original_with_personal_data_needs_grant_and_purpose(fs, as_user, monkeypatch):
    from dataclasses import replace

    _original_setup(fs, monkeypatch, "found")
    assert as_user(PLAIN).post("/api/chat/documents/d1/original", json={"purpose": "查核病人處置"}).status_code == 403
    assert as_user(PLAIN).get("/api/chat/documents/d1").json()["original"] == "denied"
    granted = replace(PLAIN, uid="u-doc", email="doc@example.com", original_view=True)
    c = as_user(granted)
    assert c.get("/api/chat/documents/d1").json()["original"] == "purpose"
    assert c.post("/api/chat/documents/d1/original", json={"purpose": " "}).status_code == 422
    assert not _audits(fs, "knowledge.original_open")  # refused attempts issue no link and no open record
    ok = c.post("/api/chat/documents/d1/original", json={"purpose": "查核病人處置"})
    assert ok.status_code == 200 and _audits(fs, "knowledge.original_open")[0]["purpose"] == "查核病人處置"
    fs.store["documents/d1"]["pii"] = "unknown"  # unclassified counts as personal data
    assert as_user(PLAIN).post("/api/chat/documents/d1/original", json={"purpose": "查核病人處置"}).status_code == 403


def test_original_link_is_bound_expires_and_follows_revocation(fs, as_user, monkeypatch):
    from dataclasses import replace

    o = _original_setup(fs, monkeypatch, "found")
    doc = replace(PLAIN, original_view=True)
    url = as_user(doc).post("/api/chat/documents/d1/original", json={"purpose": "會診討論"}).json()["url"]
    other = replace(PLAIN, uid="u-other", email="other@example.com", original_view=True)
    assert as_user(other).get(url).status_code == 403  # a copied link is useless to someone else
    assert as_user(doc).get(url.replace("t=", "t=x")).status_code == 401  # tampered
    assert as_user(PLAIN).get(url).status_code == 403  # grant removed after the link was issued
    monkeypatch.setattr(o.time, "time", lambda: 10**10)
    assert as_user(doc).get(url).status_code == 401  # expired


def test_original_viewing_is_off_without_a_signing_key(fs, as_user, monkeypatch):
    o = _original_setup(fs, monkeypatch, "none")
    monkeypatch.setattr(o, "settings", lambda: type("S", (), {"download_signing_key": "", "original_link_ttl_seconds": 120})())
    assert as_user(PLAIN).post("/api/chat/documents/d1/original", json={}).status_code == 503
    assert not _audits(fs, "knowledge.original_open")


def test_admin_grants_original_view_with_reason_and_audit(fs, as_user):
    fs.store["users/user@example.com"] = {"email": "user@example.com", "uid": "u-u1", "role": "user", "status": "active"}
    c = as_user(ADMIN)
    assert c.patch("/api/users/user@example.com", json={"original_view": True}).status_code == 422  # needs a reason
    r = c.patch("/api/users/user@example.com", json={"original_view": True, "reason": "感染科醫師需查核個案"})
    assert r.status_code == 200 and r.json()["original_view"] is True
    assert _audits(fs, "user.original_view")[0]["new"] is True


def test_admin_switch_for_web_search_defaults_off_and_is_admin_only_and_audited(fs, as_user):
    from app.engine import features

    assert as_user(PLAIN).get("/api/features").json()["web_search"] is False  # off until an admin says otherwise
    assert not features.web_search_enabled()
    assert as_user(PLAIN).put("/api/features", json={"web_search": True}).status_code == 403
    r = as_user(ADMIN).put("/api/features", json={"web_search": True})
    assert r.status_code == 200 and r.json()["web_search"] is True and r.json()["updated_by"] == ADMIN.email
    assert as_user(PLAIN).get("/api/features").json()["web_search"] is True and features.web_search_enabled()
    ev = [d for p, d in fs.store.items() if p.startswith("audit/") and d["action"] == "features.update"][0]
    assert ev["web_search_old"] is False and ev["web_search_new"] is True


def test_features_carry_validated_rag_distance_thresholds(fs, as_user):
    from app.engine import features

    c = as_user(ADMIN)
    got = as_user(PLAIN).get("/api/features").json()
    assert got["rag_keep_distance"] == 0.34 and got["rag_max_distance"] == 0.40 and features.rag_thresholds() == (0.34, 0.40)
    assert c.put("/api/features", json={"web_search": False, "rag_keep_distance": 0.45, "rag_max_distance": 0.30}).status_code == 422  # keep must not exceed max
    assert c.put("/api/features", json={"web_search": False, "rag_keep_distance": 0.01, "rag_max_distance": 0.30}).status_code == 422
    ok = c.put("/api/features", json={"web_search": False, "rag_keep_distance": 0.30, "rag_max_distance": 0.45})
    assert ok.status_code == 200 and features.rag_thresholds() == (0.30, 0.45)
    ev = [d for p, d in fs.store.items() if p.startswith("audit/") and d["action"] == "features.update"][-1]
    assert ev["rag_distance_old"] == [0.34, 0.4] and ev["rag_distance_new"] == [0.3, 0.45]


# ---- 👍 / 👎
def _chat_once(c, monkeypatch):
    from app.engine import llm

    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("A123456789", "[ID]"))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr(llm, "complete", lambda **kw: llm.Completion("答案內容", "gemini-3-flash", 1, 1, 0.0, 1))
    return c.post("/api/chat", json={"message": "請問", "knowledge_scope": "general"}).json()


def test_thumbs_down_keeps_reasons_and_deidentified_details_and_shows_on_reopen(fs, as_user, monkeypatch, audit_log):
    c = as_user(BUILDER)
    r = _chat_once(c, monkeypatch)
    assert r["message_index"] == 1  # user = 0, assistant = 1
    body = {"session_id": r["session_id"], "message_index": 1, "rating": "down", "reasons": ["inaccurate", "incomplete", "inaccurate"],
            "details": "病人 A123456789 的數值不對"}
    assert c.post("/api/chat/feedback", json=body).status_code == 200
    doc = fs.store[f"feedback/{r['session_id']}_1"]
    assert doc["reasons"] == ["inaccurate", "incomplete"] and "A123456789" not in doc["details"] and "[ID]" in doc["details"]
    assert doc["question"] == "請問" and doc["answer"] == "答案內容" and doc["models"] == ["gemini-3-flash"] and doc["user_email"] == BUILDER.email
    assert c.get(f"/api/sessions/{r['session_id']}").json()["feedback"] == {"1": "down"}
    ev = [a for a in audit_log() if a["action"] == "chat.feedback"][0]
    assert ev["rating"] == "down" and "details" not in ev  # the audit trail never carries the free text
    # thumbs up replaces it (and drops the reasons); none withdraws it
    c.post("/api/chat/feedback", json={**body, "rating": "up", "details": ""})
    assert fs.store[f"feedback/{r['session_id']}_1"]["rating"] == "up" and fs.store[f"feedback/{r['session_id']}_1"]["reasons"] == []
    c.post("/api/chat/feedback", json={**body, "rating": "none"})
    assert f"feedback/{r['session_id']}_1" not in fs.store and c.get(f"/api/sessions/{r['session_id']}").json()["feedback"] == {}


def test_feedback_only_on_your_own_assistant_replies_and_admins_can_read_it(fs, as_user, monkeypatch):
    c = as_user(BUILDER)
    r = _chat_once(c, monkeypatch)
    ok = {"session_id": r["session_id"], "message_index": 1, "rating": "down", "reasons": ["slow"], "details": ""}
    assert as_user(BUILDER2).post("/api/chat/feedback", json=ok).status_code == 404  # someone else's session
    assert c.post("/api/chat/feedback", json={**ok, "message_index": 0}).status_code == 422  # that is the user's own message
    assert c.post("/api/chat/feedback", json={**ok, "message_index": 9}).status_code == 422
    assert c.post("/api/chat/feedback", json={**ok, "reasons": ["nonsense"]}).status_code == 422
    c.post("/api/chat/feedback", json=ok)
    assert c.get("/api/chat/feedback").status_code == 403
    rows = as_user(ADMIN).get("/api/chat/feedback").json()
    assert len(rows) == 1 and rows[0]["reasons"] == ["slow"] and rows[0]["rating"] == "down"


# ---- code / document blocks: 存到空間
def test_save_to_space_creates_a_library_document_inside_the_space(fs, as_user, monkeypatch):
    import app.routers.knowledge as k

    seen = {}
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("A123456789", "[ID]"))
    monkeypatch.setattr(k, "_index", lambda doc_id, version, filename, data, ctype: seen.update(name=filename, data=data, ctype=ctype) or
                        {"gcs_uri": "gs://b/o", "deid_uri": "gs://b/d", "rag_file": "f", "chars": len(data), "status": "indexed", "error": "", "pii": "none", "pii_types": []})
    c = as_user(BUILDER)
    space = c.post("/api/spaces", json={"name": "我的空間"}).json()
    r = c.post("/api/chat/save-to-space", json={"space_id": space["id"], "filename": "a/b:report.py", "content": "print('A123456789')"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["filename"] == "a_b_report.py.txt" and seen["name"] == "a_b_report.py.txt" and b"A123456789" not in seen["data"] and b"[ID]" in seen["data"]  # unsupported type gets .txt
    assert j["document_id"] in c.get(f"/api/spaces/{space['id']}").json()["document_ids"]
    md = c.post("/api/chat/save-to-space", json={"space_id": space["id"], "filename": "單張.md", "content": "# 標題"}).json()
    assert md["filename"] == "單張.md" and seen["ctype"] == "text/markdown"
    assert as_user(PLAIN).post("/api/chat/save-to-space", json={"space_id": space["id"], "filename": "x.md", "content": "x"}).status_code == 403  # library is builder-only
    assert as_user(BUILDER2).post("/api/chat/save-to-space", json={"space_id": space["id"], "filename": "x.md", "content": "x"}).status_code == 403  # not their space
