"""稽核記錄 and 用量與成本 filter by a real group (群組管理): the people in the group, not the old fixed department list."""
from app.engine import usage

from .conftest import ADMIN


def _people(fs):
    fs.put("groups/g1", {"name": "心臟內科", "description": ""})
    fs.put("groups/g2", {"name": "空群組", "description": ""})
    fs.put("users/amy@example.com", {"email": "amy@example.com", "uid": "u-amy", "groups": ["g1"], "role": "user", "status": "active"})
    fs.put("users/bob@example.com", {"email": "bob@example.com", "uid": "u-bob", "groups": [], "role": "user", "status": "active"})


def test_audit_can_be_filtered_by_the_members_of_a_group(fs, as_user):
    _people(fs)
    from app import db
    db.audit("u-amy", "chat.run", "Amy@example.com", session_id="s1")
    db.audit("u-bob", "chat.run", "bob@example.com", session_id="s2")
    db.audit("u-amy", "session.delete", "", session_id="s3")  # no e-mail recorded: matched on the uid
    c = as_user(ADMIN)
    got = c.get("/api/audit", params={"group": "g1"}).json()["items"]
    assert sorted(i["details"].get("session_id") for i in got) == ["s1", "s3"]
    assert c.get("/api/audit", params={"group": "g2"}).json()["items"] == []
    assert len(c.get("/api/audit").json()["items"]) >= 3  # no group: everyone
    assert c.get("/api/audit", params={"group": "nope"}).status_code == 404
    csv = c.get("/api/audit/export.csv", params={"group": "g1"}).text
    assert "s1" in csv and "s2" not in csv


def test_usage_can_be_filtered_by_the_members_of_a_group(fs, as_user):
    _people(fs)
    day = usage.day_key()
    for i, (uid, tokens) in enumerate((("u-amy", 10), ("u-amy", 20), ("u-bob", 100))):  # the raw ledger rows usage.record writes
        fs.put(f"usage/r{i}", {"day": day, "env": "production", "agent_id": "a1", "agent_name": "A", "department": "", "uid": uid,
                               "group": "fast", "model": "gemini-3-flash", "prompt_tokens": tokens, "completion_tokens": 0,
                               "cost_usd": 0.01, "ms": 100, "ok": True, "fallback": False})
    c = as_user(ADMIN)
    g1 = c.get("/api/monitoring/summary", params={"group": "g1"}).json()
    assert g1["requests"] == 2 and g1["prompt_tokens"] == 30
    assert g1["daily"][-1]["by_model"][0]["model"] == "gemini-3-flash"
    rows = c.get("/api/monitoring/agents", params={"group": "g1"}).json()
    assert [(r["agent_id"], r["requests"], r["tokens"]) for r in rows] == [("a1", 2, 30)]
    assert c.get("/api/monitoring/summary", params={"group": "g2"}).json()["requests"] == 0
    assert c.get("/api/monitoring/agents", params={"group": "nope"}).status_code == 404


def test_users_carry_their_real_group_membership(fs, as_user):
    _people(fs)
    c = as_user(ADMIN)
    amy = c.get("/api/users/amy@example.com").json()
    assert amy["groups"] == ["g1"]
    listed = {u["email"]: u["groups"] for u in c.get("/api/users").json()["users"]}
    assert listed["amy@example.com"] == ["g1"] and listed["bob@example.com"] == []
