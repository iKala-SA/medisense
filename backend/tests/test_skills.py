from app.engine import skills

from .conftest import ADMIN, BUILDER, BUILDER2, PLAIN


def make(c, **kw):
    r = c.post("/api/skills", json={"name": "s", "instructions": "Be brief.", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_crud_and_validation(fs, as_user, audit_log):
    c = as_user(BUILDER)
    assert c.post("/api/skills", json={"name": "x" * 65}).status_code == 422
    assert c.post("/api/skills", json={"name": "ok", "description": "d" * 1025}).status_code == 422
    s = make(c)
    assert s["enabled"] is True and s["my_role"] == "owner" and s["share"]["access"] == "restricted"
    assert c.put(f"/api/skills/{s['id']}", json={"name": "s2", "instructions": "v2"}).json()["name"] == "s2"
    assert [x["id"] for x in c.get("/api/skills").json()] == [s["id"]]
    assert c.patch(f"/api/skills/{s['id']}/enabled", json={"enabled": False}).json()["enabled"] is False
    assert c.delete(f"/api/skills/{s['id']}").status_code == 204
    assert c.get(f"/api/skills/{s['id']}").status_code == 404
    acts = [a["action"] for a in audit_log()]
    assert {"skill.create", "skill.update", "skill.disable", "skill.delete"} <= set(acts)


def test_run_only_user_cannot_create_and_list_is_scoped(fs, as_user):
    assert as_user(PLAIN).post("/api/skills", json={"name": "n"}).status_code == 403
    s = make(as_user(BUILDER))
    assert as_user(BUILDER2).get("/api/skills").json() == []
    assert as_user(BUILDER2).get(f"/api/skills/{s['id']}").status_code == 403
    as_user(BUILDER).put(f"/api/skills/{s['id']}/share", json={"access": "account", "role": "use"})
    assert [x["id"] for x in as_user(PLAIN).get("/api/skills").json()] == [s["id"]]
    assert as_user(BUILDER2).put(f"/api/skills/{s['id']}", json={"name": "z"}).status_code == 403
    assert as_user(BUILDER2).delete(f"/api/skills/{s['id']}").status_code == 403
    assert len(as_user(ADMIN).get("/api/skills").json()) == 1


def test_instruction_injection_helper(fs):
    fs.put("skills/a", {"name": "A", "instructions": "Use SI units.", "enabled": True, "owner_uid": BUILDER.uid})
    fs.put("skills/off", {"name": "Off", "instructions": "never", "enabled": False, "owner_uid": BUILDER.uid})
    fs.put("skills/priv", {"name": "Priv", "instructions": "secret", "enabled": True, "owner_uid": "someone-else"})
    fs.put("skills/pub", {"name": "Pub", "instructions": "Be kind.", "enabled": True, "owner_uid": "someone-else",
                          "share": {"access": "account", "role": "use", "members": []}})
    out = skills.build_prefix(["a", "off", "priv", "pub", "missing", "a"], BUILDER)
    assert "Use SI units." in out and "Be kind." in out
    assert "never" not in out and "secret" not in out
    assert out.index("Use SI units.") < out.index("Be kind.")
    assert skills.build_prefix([], BUILDER) == ""


def test_prefix_reaches_system_prompt(fs, monkeypatch):
    from app.engine import agent, llm
    from app.schemas import AgentIn

    seen = {}

    def fake_complete(**kw):
        seen.update(kw)
        return llm.Completion(text="ok", model="gemini-3-flash", prompt_tokens=1, completion_tokens=1, cost_usd=0, ms=1)

    monkeypatch.setattr(llm, "complete", fake_complete)
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    r = agent.run_agent(AgentIn(name="A", instructions="BASE"), agent_id="a", user_id="u", user_message="hi", history=[],
                      skill_prefix="## Skill: S\nDO X")
    assert r.reply == "ok"
    assert seen["system"].startswith("## Skill: S\nDO X") and "BASE" in seen["system"]
