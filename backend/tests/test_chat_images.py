import base64

from app.engine import chat_images, deid

from .conftest import BUILDER, BUILDER2

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff" + b"\x00" * 64


class Store:
    """In-memory stand-in for the bucket + DLP so the pipeline can be tested without Google."""
    def __init__(self, monkeypatch):
        self.blobs, self.redacted, self.deleted = {}, [], []
        monkeypatch.setattr(deid, "redact_image", lambda data, mime: (self.redacted.append(data), b"REDACTED-" + data[:4])[1])
        monkeypatch.setattr(chat_images, "_bucket", lambda: self)

    def blob(self, path):
        store = self

        class B:
            def upload_from_string(self, data, content_type=None):
                store.blobs[path] = data

            def download_as_bytes(self):
                return store.blobs[path]

            def delete(self):
                store.deleted.append(path)
                store.blobs.pop(path, None)
        return B()


def test_image_is_redacted_before_it_is_stored_and_seen_by_the_model(fs, as_user, monkeypatch, audit_log):
    from app.engine import llm

    st = Store(monkeypatch)
    monkeypatch.setattr(deid, "deidentify", lambda t: t)
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return llm.Completion("看到了", "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr(llm, "complete", fake)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    c = as_user(BUILDER)
    r = c.post("/api/chat/attachments", files={"file": ("image.png", PNG, "image/png")})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["kind"] == "image" and j["snippet"] == ""
    assert st.redacted == [PNG]  # DLP saw the original ...
    stored = st.blobs[next(iter(st.blobs))]
    assert stored.startswith(b"REDACTED-") and PNG not in stored.replace(b"REDACTED-", b"")  # ... only the redacted copy is kept
    assert any(a["action"] == "chat.attach_image" for a in audit_log())

    out = c.post("/api/chat", json={"message": "這張圖是什麼", "session_id": j["session_id"]}).json()
    assert out["reply"] == "看到了"
    content = seen["messages"][-1]["content"]
    assert content[0] == {"type": "text", "text": "這張圖是什麼"}
    url = content[1]["image_url"]["url"]
    assert url.startswith("data:image/png;base64,") and base64.b64decode(url.split(",", 1)[1]).startswith(b"REDACTED-")
    assert "[附件" not in seen["system"]  # images are not repeated as a text attachment block

    # thumbnail is the redacted copy, owner only; removing deletes the object
    sid, aid = j["session_id"], j["attachment_id"]
    assert c.get(f"/api/chat/attachments/{sid}/{aid}/image").content.startswith(b"REDACTED-")
    assert as_user(BUILDER2).get(f"/api/chat/attachments/{sid}/{aid}/image").status_code == 404
    assert as_user(BUILDER2).delete(f"/api/chat/attachments/{sid}/{aid}").status_code == 404
    assert c.delete(f"/api/chat/attachments/{sid}/{aid}").status_code == 204 and st.deleted and not st.blobs
    assert fs.store[f"sessions/{sid}"]["attachments"] == []


def test_image_checks_and_failure_is_closed(fs, as_user, monkeypatch):
    st = Store(monkeypatch)
    c = as_user(BUILDER)
    assert c.post("/api/chat/attachments", files={"file": ("x.png", b"not an image at all")}).status_code == 415
    assert c.post("/api/chat/attachments", files={"file": ("x.png", PNG + b"\x00" * 4_100_000)}).status_code == 413
    sid = None
    for _ in range(3):
        sid = c.post("/api/chat/attachments", data={"session_id": sid} if sid else None, files={"file": ("a.jpg", JPG)}).json()["session_id"]
    assert c.post("/api/chat/attachments", data={"session_id": sid}, files={"file": ("a.jpg", JPG)}).status_code == 409  # 3 per chat

    def boom(data, mime):
        raise RuntimeError("DLP down")

    monkeypatch.setattr(deid, "redact_image", boom)
    n = len(st.blobs)
    r = c.post("/api/chat/attachments", files={"file": ("y.png", PNG)})
    assert r.status_code == 502 and len(st.blobs) == n  # nothing stored, nothing reaches a model


def test_images_blocked_under_hospital_only_models_and_deleted_with_the_chat(fs, as_user, monkeypatch):
    st = Store(monkeypatch)
    monkeypatch.setattr(deid, "deidentify", lambda t: t)
    c = as_user(BUILDER)
    sid = c.post("/api/chat/attachments", files={"file": ("a.png", PNG)}).json()["session_id"]
    monkeypatch.setattr("app.engine.routing.sovereign_only", lambda: True)
    r = c.post("/api/chat", json={"message": "hi", "session_id": sid})
    assert r.status_code == 409 and "圖片" in r.text
    assert c.delete(f"/api/sessions/{sid}").status_code == 204 and st.deleted  # blobs go with the conversation
