import os

for k, v in {"GOOGLE_CLOUD_PROJECT": "test-project", "LITELLM_BASE_URL": "http://localhost:4000",
             "LITELLM_API_KEY": "sk-test", "UPLOAD_BUCKET": "test-bucket", "SCHEDULER_TOKEN": "tick-secret",
             "ADMIN_EMAILS": "root@example.com"}.items():
    os.environ.setdefault(k, v)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.auth import User, current_user  # noqa: E402
from app.engine import features, llm, routing  # noqa: E402
from app.main import app  # noqa: E402

from .fake_firestore import FakeClient  # noqa: E402

ADMIN = User(uid="u-admin", email="admin@example.com", name="Admin", role="admin")
BUILDER = User(uid="u-b1", email="builder@example.com", name="Builder", role="builder")
BUILDER2 = User(uid="u-b2", email="builder2@example.com", name="Builder Two", role="builder")
PLAIN = User(uid="u-u1", email="user@example.com", name="User", role="user")


@pytest.fixture
def fs(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(db, "client", lambda: fake)
    llm.reset_registry_cache()
    routing.reset_cache()
    features.reset_cache()
    from app.auth import _cache
    _cache.clear()
    yield fake
    llm.reset_registry_cache()
    routing.reset_cache()
    features.reset_cache()


@pytest.fixture
def as_user():
    """as_user(User) -> TestClient authenticated as that user. Each client carries its own X-Test-User header, so
    several users can be used in one test (current_user is overridden to read it)."""
    from fastapi import Request

    users: dict[str, User] = {}

    def override(request: Request) -> User:
        return users[request.headers["x-test-user"]]

    app.dependency_overrides[current_user] = override

    def make(user: User) -> TestClient:
        users[user.uid] = user
        return TestClient(app, headers={"X-Test-User": user.uid})
    yield make
    app.dependency_overrides.clear()


@pytest.fixture
def audit_log(fs):
    return lambda: [d for p, d in fs.store.items() if p.startswith("audit/")]
