from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app

from .conftest import ADMIN, BUILDER, BUILDER2, PLAIN

RAW = "王小明"


@pytest.fixture(autouse=True)
def fake_deid(monkeypatch):
    calls = []

    def one(t):
        calls.append(1)
        return t.replace(RAW, "[PERSON_NAME]")

    monkeypatch.setattr("app.engine.deid.deidentify", one)
    monkeypatch.setattr("app.engine.deid.deidentify_many", lambda ts: [calls.append(1) or t.replace(RAW, "[PERSON_NAME]") for t in ts])
    return calls


def seed(fs, sid="s1", uid=BUILDER.uid, **extra):
    fs.put(f"sessions/{sid}", {"uid": uid, "agent_id": "a1", "title": "血壓追蹤", "messages": [
        {"role": "user", "content": "[PERSON_NAME] 的血壓偏高"},
        {"role": "assistant", "content": f"建議 {RAW} 每週量測", "meta": {"trace": [{"summary": "secret step"}]}}],
        "attachments": [{"id": "x", "name": f"{RAW}.png", "kind": "image", "blob": "chat-images/x"}],
        "updated_at": db.now(), "expire_at": db.now() + timedelta(days=180), **extra})


def test_owner_creates_once_and_others_cannot(fs, as_user, audit_log):
    seed(fs)
    c = as_user(BUILDER)
    assert c.get("/api/sessions/s1/share").json() is None
    r = c.post("/api/sessions/s1/share").json()
    exp = datetime.fromisoformat(r["expires_at"])
    assert timedelta(days=29, hours=23) < exp - datetime.now(UTC) <= timedelta(days=30)
    assert c.post("/api/sessions/s1/share").json()["id"] == r["id"]  # existing active link is returned
    assert c.get("/api/sessions/s1/share").json()["id"] == r["id"]
    assert len([p for p in fs.store if p.startswith("shares/")]) == 1
    for other in (BUILDER2, ADMIN):  # not even admins can share someone else's chat
        assert as_user(other).post("/api/sessions/s1/share").status_code == 404
        assert as_user(other).delete("/api/sessions/s1/share").status_code == 404
    created = [a for a in audit_log() if a["action"] == "share.create"]
    assert len(created) == 1 and created[0]["share_id"] == r["id"] and created[0]["session_id"] == "s1"


def test_locked_and_archived_can_be_shared_empty_cannot(fs, as_user):
    seed(fs, locked=True, archived=True)
    seed(fs, "empty", messages=[])
    c = as_user(BUILDER)
    assert c.post("/api/sessions/s1/share").status_code == 200
    assert c.post("/api/sessions/empty/share").status_code == 409


def test_signed_in_non_owner_views_deidentified_snapshot_and_view_is_audited(fs, as_user, audit_log):
    seed(fs)
    sid = as_user(BUILDER).post("/api/sessions/s1/share").json()["id"]
    # later messages are not part of the snapshot
    fs.store["sessions/s1"]["messages"].append({"role": "user", "content": "later"})
    v = as_user(PLAIN).get(f"/api/shares/{sid}")
    assert v.status_code == 200
    body = v.json()
    assert [m["content"] for m in body["messages"]] == ["[PERSON_NAME] 的血壓偏高", "建議 [PERSON_NAME] 每週量測"]
    assert RAW not in v.text and "secret step" not in v.text and "chat-images" not in v.text
    assert body["attachments"] == 1 and body["owner_name"] == BUILDER.name and body["title"] == "血壓追蹤"
    stored = fs.store[f"shares/{sid}"]
    assert RAW not in str(stored) and "meta" not in str(stored["messages"])
    as_user(BUILDER2).get(f"/api/shares/{sid}")
    views = [a for a in audit_log() if a["action"] == "share.view"]
    assert [(a["actor"], a["share_id"]) for a in views] == [(PLAIN.uid, sid), (BUILDER2.uid, sid)]
    assert all("at" in a and "messages" not in a and "content" not in a for a in views)


def test_unauthenticated_rejected(fs, as_user):
    seed(fs)
    sid = as_user(BUILDER).post("/api/sessions/s1/share").json()["id"]
    app.dependency_overrides.clear()
    anon = TestClient(app)
    assert anon.get(f"/api/shares/{sid}").status_code == 401
    assert anon.post("/api/sessions/s1/share").status_code == 401


def test_revoke(fs, as_user, audit_log):
    seed(fs)
    c = as_user(BUILDER)
    sid = c.post("/api/sessions/s1/share").json()["id"]
    assert c.delete("/api/sessions/s1/share").status_code == 204
    assert as_user(PLAIN).get(f"/api/shares/{sid}").status_code == 404
    assert c.delete("/api/sessions/s1/share").status_code == 404
    assert c.get("/api/sessions/s1/share").json() is None
    assert [a["share_id"] for a in audit_log() if a["action"] == "share.revoke"] == [sid]
    assert c.post("/api/sessions/s1/share").json()["id"] != sid  # a new link after revoking


def test_expired_and_deleted_conversation(fs, as_user):
    seed(fs)
    c = as_user(BUILDER)
    sid = c.post("/api/sessions/s1/share").json()["id"]
    fs.store[f"shares/{sid}"]["expire_at"] = db.now() - timedelta(seconds=1)
    assert as_user(PLAIN).get(f"/api/shares/{sid}").status_code == 404
    assert c.get("/api/sessions/s1/share").json() is None
    new = c.post("/api/sessions/s1/share").json()["id"]  # expired one is not reused
    assert new != sid
    assert c.delete("/api/sessions/s1").status_code == 204
    assert not [p for p in fs.store if p.startswith("shares/")]
    assert as_user(PLAIN).get(f"/api/shares/{new}").status_code == 404


def test_share_never_outlives_conversation(fs, as_user):
    seed(fs, expire_at=db.now() + timedelta(days=5))
    r = as_user(BUILDER).post("/api/sessions/s1/share").json()
    assert datetime.fromisoformat(r["expires_at"]) - datetime.now(UTC) < timedelta(days=5, minutes=1)


def test_deid_failure_fails_closed(fs, as_user, monkeypatch):
    seed(fs)

    def boom(_):
        raise RuntimeError("DLP down")
    monkeypatch.setattr("app.engine.deid.deidentify_many", boom)
    c = TestClient(app, raise_server_exceptions=False, headers={"X-Test-User": BUILDER.uid})
    as_user(BUILDER)
    assert c.post("/api/sessions/s1/share").status_code == 500
    assert not [p for p in fs.store if p.startswith("shares/")]
