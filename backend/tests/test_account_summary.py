"""管理帳戶 → 帳戶資訊: the caller's own profile, groups, roles, owned assets and usage; /api/me carries group and role names."""
from datetime import timedelta

from app import db
from app.auth import User
from app.engine import usage

from .conftest import BUILDER

ME = User(uid="u-me", email="me@example.com", name="Me", role="user", roles=("r-nurse",), groups=("g1", "g2"))


def _seed(fs):
    fs.put("users/me@example.com", {"email": ME.email, "uid": ME.uid, "status": "active", "login_provider": "oidc.keycloak"})
    fs.put("groups/g1", {"name": "心臟內科"})
    fs.put("groups/g2", {"name": "資訊室"})
    fs.put("roles/r-nurse", {"name": "護理長", "custom": True})
    fs.put("agents/a1", {"name": "衛教助手", "owner_uid": ME.uid, "status": "published", "version": 5})
    fs.put("agents/a2", {"name": "交班流程", "owner_uid": ME.uid, "kind": "flow", "status": "draft", "review": {"state": "pending"}})
    fs.put("agents/a3", {"name": "已刪除", "owner_uid": ME.uid, "status": "deleted"})
    fs.put("agents/x", {"name": "別人的", "owner_uid": BUILDER.uid, "status": "published"})
    fs.put("skills/s1", {"name": "白話衛教單張", "owner_uid": ME.uid, "enabled": True})
    fs.put("spaces/sp1", {"name": "指引", "owner_uid": ME.uid, "document_ids": ["d1", "d2"]})
    today = db.now()
    for back, cost in ((0, 0.5), (3, 1.0), (40, 9.0)):
        day = usage.day_key(today - timedelta(days=back))
        fs.put(f"{usage.USER_DAILY}/{day}_{ME.uid}", {"day": day, "uid": ME.uid, "requests": 2, "tokens": 100, "cost_usd": cost})
    fs.put(f"{usage.USER_DAILY}/{usage.day_key(today)}_{BUILDER.uid}", {"day": usage.day_key(today), "uid": BUILDER.uid, "requests": 99, "tokens": 9, "cost_usd": 99.0})


def test_summary_is_the_callers_own_data(fs, as_user):
    _seed(fs)
    d = as_user(ME).get("/api/me/summary").json()
    assert d["profile"]["login_label"] == "院內 SSO（OIDC）" and d["profile"]["role_label"] == "護理長"
    assert [g["name"] for g in d["groups"]] == ["心臟內科", "資訊室"]
    assert d["roles"] == [{"id": "r-nurse", "name": "護理長", "custom": True}]
    a = d["assets"]
    assert a["agents"]["count"] == 1 and a["agents"]["published"] == 1 and a["agents"]["items"][0]["version"] == 5
    assert a["flows"]["count"] == 1 and a["flows"]["items"][0]["status"] == "pending"  # deleted agent left out
    assert a["skills"]["count"] == 1 and a["spaces"]["items"][0]["documents"] == 2
    u = d["usage"]
    assert u["today"] == {"requests": 2, "tokens": 100, "cost_usd": 0.5}
    assert u["week"]["cost_usd"] == 1.5 and len(u["daily"]) == 14  # the 40-day-old row and other people never count


def test_me_carries_group_and_role_names(fs, as_user):
    _seed(fs)
    d = as_user(ME).get("/api/me").json()
    assert d["group_names"] == ["心臟內科", "資訊室"] and d["role_label"] == "護理長"
    plain = User(uid="u-p", email="p@example.com", name="P", role="builder")
    p = as_user(plain).get("/api/me").json()
    assert p["group_names"] == [] and p["role_label"] == "建置者"
