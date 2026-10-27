from datetime import UTC, datetime

from app.routers import schedules as sch

from .conftest import ADMIN, BUILDER, BUILDER2


def utc(y, mo, d, h, mi):  # Asia/Taipei is UTC+8, so Taipei h:mi == UTC h-8
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def S(freq, t="08:00", enabled=True):
    return {"frequency": freq, "time": t, "enabled": enabled}


def test_due_logic_taipei_timezone():
    mon_8am = utc(2026, 11, 2, 0, 0)  # Mon 2026-11-02 08:00 Taipei
    assert sch.slot_of(mon_8am) == "2026-11-02T08:00"
    assert sch.is_due(S("daily"), mon_8am)
    assert not sch.is_due(S("daily", "08:01"), mon_8am)
    assert not sch.is_due(S("daily", enabled=False), mon_8am)
    assert sch.is_due(S("weekdays"), mon_8am) and sch.is_due(S("weekly_mon"), mon_8am)
    assert not sch.is_due(S("monthly_1"), mon_8am)
    sat = utc(2026, 11, 7, 0, 0)
    assert not sch.is_due(S("weekdays"), sat) and not sch.is_due(S("weekly_mon"), sat) and sch.is_due(S("daily"), sat)
    first = utc(2026, 11, 1, 0, 0)  # Sunday, the 1st
    assert sch.is_due(S("monthly_1"), first)
    # date rolls over by timezone: Sun 16:30 UTC is Mon 00:30 Taipei
    assert sch.is_due(S("weekly_mon", "00:30"), utc(2026, 11, 1, 16, 30))


def test_validation(fs, as_user):
    fs.put("agents/a1", {"name": "A", "owner_uid": BUILDER.uid, "status": "published", "version": 1})
    c = as_user(BUILDER)
    base = {"name": "daily", "agent_id": "a1", "prompt": "hi"}
    assert c.post("/api/schedules", json={**base, "time": "25:00"}).status_code == 422
    assert c.post("/api/schedules", json={**base, "frequency": "hourly"}).status_code == 422
    assert c.post("/api/schedules", json={**base, "agent_id": "nope"}).status_code == 404
    r = c.post("/api/schedules", json=base)
    assert r.status_code == 201 and r.json()["frequency"] == "daily" and r.json()["last_run"] is None
    sid = r.json()["id"]
    assert as_user(BUILDER2).get(f"/api/schedules/{sid}").status_code == 403
    assert c.patch(f"/api/schedules/{sid}/enabled", json={"enabled": False}).json()["enabled"] is False


def test_tick_token(fs, as_user):
    c = as_user(BUILDER)
    assert c.post("/api/schedules/tick").status_code == 401
    assert c.post("/api/schedules/tick", headers={"X-Scheduler-Token": "wrong"}).status_code == 401
    r = c.post("/api/schedules/tick", headers={"X-Scheduler-Token": "tick-secret"})
    assert r.status_code == 200 and r.json()["due"] == 0


def test_tick_runs_due_once_and_run_now(fs, as_user, monkeypatch, audit_log):
    from app.engine import flow, llm

    fs.put("users/builder@example.com", {"email": "builder@example.com", "name": "B", "role": "builder", "status": "active"})
    fs.put("agents/a1", {"name": "A", "owner_uid": BUILDER.uid, "owner_email": BUILDER.email, "status": "published", "version": 1})
    fs.put("agents/a1/versions/1", {"name": "A", "instructions": "x"})
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(llm, "complete", lambda **kw: llm.Completion("pong", "gemini-3-flash", 1, 1, 0.0, 1))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    fixed = utc(2026, 11, 2, 0, 0)
    monkeypatch.setattr("app.db.now", lambda: fixed)
    c = as_user(BUILDER)
    sid = c.post("/api/schedules", json={"name": "morning", "agent_id": "a1", "prompt": "ping", "time": "08:00"}).json()["id"]
    c.post("/api/schedules", json={"name": "later", "agent_id": "a1", "prompt": "ping", "time": "09:00"})
    hdr = {"X-Scheduler-Token": "tick-secret"}
    r = c.post("/api/schedules/tick", headers=hdr).json()
    assert r["slot"] == "2026-11-02T08:00" and r["checked"] == 2 and r["due"] == 1
    assert r["results"][0]["status"] == "ok" and r["results"][0]["session_id"]
    again = c.post("/api/schedules/tick", headers=hdr).json()
    assert again["due"] == 1 and again["results"] == []  # lock already taken for this minute
    got = c.get(f"/api/schedules/{sid}").json()
    assert got["last_run"]["status"] == "ok"
    sess = fs.store[f"sessions/{got['last_run']['session_id']}"]
    assert sess["uid"] == BUILDER.uid and sess["messages"][-1]["content"] == "pong" and sess["title"].startswith("[排程]")
    # run-now by someone without edit rights is refused; owner can
    assert as_user(BUILDER2).post(f"/api/schedules/{sid}/run-now").status_code == 403
    assert as_user(BUILDER).post(f"/api/schedules/{sid}/run-now").json()["status"] == "ok"
    assert sum(1 for a in audit_log() if a["action"] == "schedule.run") == 2


def test_run_failure_is_recorded(fs, as_user):
    fs.put("users/builder@example.com", {"email": "builder@example.com", "role": "builder"})
    fs.put("agents/a1", {"name": "A", "owner_uid": BUILDER.uid, "status": "published", "version": 1})
    c = as_user(BUILDER)
    sid = c.post("/api/schedules", json={"name": "n", "agent_id": "a1", "prompt": "p"}).json()["id"]
    fs.store["agents/a1"]["status"] = "draft"  # agent unpublished meanwhile
    fs.store["agents/a1"]["owner_uid"] = "other"
    r = c.post(f"/api/schedules/{sid}/run-now").json()
    assert r["status"] == "error" and "403" in r["error"]
    assert c.get(f"/api/schedules/{sid}").json()["last_run"]["status"] == "error"
    assert as_user(ADMIN).get(f"/api/schedules/{sid}").status_code == 200
