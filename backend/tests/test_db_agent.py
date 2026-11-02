"""Database connectors inside an agent run: per-user grants, A and B calls, de-identification, audit."""
import json

import pytest

from app.engine import agent as rt
from app.engine import db_tools, llm
from app.schemas import AgentIn, Capabilities

from .conftest import ADMIN, BUILDER, BUILDER2, PLAIN
from .test_agent import Script, call
from .test_db_connectors import body, groups, secrets  # noqa: F401  (fixtures)


REAL_TOOLBOX_CALL = db_tools._toolbox_call


@pytest.fixture
def world(fs, as_user, secrets, monkeypatch, audit_log):  # noqa: F811
    groups(fs)
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("王小明", "[PERSON_NAME]"))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    rules = [{"group_id": "g_pharm", "source_id": "ro_pharm", "queries": ["stock"], "views": ["v1"]},
             {"group_id": "g_nurse", "source_id": "ro_nurse", "queries": [], "views": []}]
    cid = as_user(ADMIN).post("/api/db-connectors", json=body(rules=rules)).json()["id"]
    sent = []

    def toolbox(tool, args):
        sent.append((tool, args))
        return '{"name":"阿斯匹靈","qty":12}\n{"name":"王小明 領藥","qty":3}'
    monkeypatch.setattr(db_tools, "_toolbox_call", toolbox)
    return cid, sent, audit_log


def run(model, cid, email, msg="庫存?"):
    ag = AgentIn(name="藥師助理", capabilities=Capabilities(db_connectors=[cid]))
    return rt.run_agent(ag, agent_id="a", user_id="u", user_message=msg, history=[], user_email=email)


def test_tools_offered_follow_the_executing_users_rule(world, monkeypatch):
    cid, _, _ = world
    names = lambda email: [x["name"] for x in db_tools.tool_specs([cid], email)]  # noqa: E731
    assert len(names(BUILDER.email)) == 2  # g_pharm is first: a query tool and the natural-language tool
    assert names(BUILDER2.email) == []  # nurse rule grants nothing
    assert names(PLAIN.email) == [] and names(ADMIN.email) == []  # no rule, no admin shortcut
    sql = next(s for s in db_tools.tool_specs([cid], BUILDER.email) if s["meta"]["kind"] == "sql")
    assert "public.v_stock" in sql["description"] and "patient_id" not in sql["description"]  # sensitive column never shown to the model


def test_predefined_query_runs_on_the_rules_login_and_results_are_deidentified(world, monkeypatch):
    cid, sent, audit = world
    name = next(s["name"] for s in db_tools.tool_specs([cid], BUILDER.email) if s["meta"]["kind"] == "query")
    s = Script([call(name, {"reason": "查庫存", "code": "A1"})], "庫存 12")
    monkeypatch.setattr(llm, "complete", s)
    r = run(s, cid, BUILDER.email)
    assert sent == [(f"{cid}__ro_pharm__stock", {"code": "A1"})]
    tool_msg = next(m for m in s.sent[1]["messages"] if m["role"] == "tool")["content"]
    assert "阿斯匹靈" in tool_msg and "王小明" not in tool_msg and "[PERSON_NAME]" in tool_msg
    assert r.reply == "庫存 12"
    a = [x for x in audit() if x["action"] == "db.query"][-1]
    assert a["ok"] and a["rule"] == 0 and a["rows"] == 2 and "阿斯匹靈" not in json.dumps(a, default=str)


def test_natural_language_sql_goes_through_the_guard(world, monkeypatch):
    cid, sent, audit = world
    name = next(s["name"] for s in db_tools.tool_specs([cid], BUILDER.email) if s["meta"]["kind"] == "sql")
    s = Script([call(name, {"reason": "r", "sql": "SELECT patient_id FROM public.v_stock"})],
               [call(name, {"reason": "r", "sql": "SELECT name, qty FROM public.v_stock WHERE qty > 5"}, "c2")], "好")
    monkeypatch.setattr(llm, "complete", s)
    run(s, cid, BUILDER.email)
    assert sent == [(f"{cid}__ro_pharm__sql", {"sql": "SELECT name, qty FROM public.v_stock WHERE qty > 5 LIMIT 100"})]  # the 1st was refused, never sent
    tools = [m["content"] for m in s.sent[-1]["messages"] if m["role"] == "tool"]
    assert "未通過檢查" in tools[0] and "敏感" in tools[0]
    assert [x["ok"] for x in audit() if x["action"] == "db.query"] == [False, True]


def test_grant_is_rechecked_at_call_time(world, monkeypatch):
    cid, sent, audit = world
    spec = next(s for s in db_tools.tool_specs([cid], BUILDER.email) if s["meta"]["kind"] == "query")
    text, _ = db_tools.execute(spec["meta"], {"code": "A"}, user_id="u", email=PLAIN.email, agent_id="a")  # e.g. removed from the group mid-run
    assert "沒有使用這個資料庫的權限" in text and sent == []
    text, _ = db_tools.execute(spec["meta"], {}, user_id="u", email=BUILDER.email, agent_id="a")
    assert "缺少參數" in text and sent == []


def test_database_not_listed_by_the_agent_is_never_offered(world):
    cid, _, _ = world
    assert db_tools.tool_specs([], BUILDER.email) == []
    assert db_tools.tool_specs(["nope"], BUILDER.email) == []


def test_unconfigured_toolbox_is_reported_not_crashed(world, monkeypatch):
    cid, _, _ = world
    monkeypatch.setattr(db_tools, "_toolbox_call", REAL_TOOLBOX_CALL)  # TOOLBOX_URL is empty
    spec = next(s for s in db_tools.tool_specs([cid], BUILDER.email) if s["meta"]["kind"] == "query")
    text, _ = db_tools.execute(spec["meta"], {"code": "A"}, user_id="u", email=BUILDER.email, agent_id="a")
    assert "尚未啟用" in text


def test_catalog_is_names_only_for_builders(world, as_user):
    cid, _, _ = world
    assert as_user(BUILDER).get("/api/db-connectors/catalog").json() == [{"id": cid, "name": "藥局資料庫", "kind": "postgres"}]
    assert as_user(PLAIN).get("/api/db-connectors/catalog").status_code == 403


def test_end_to_end_with_a_toolbox_that_serves_the_rendered_tools_yaml(world, as_user, monkeypatch):
    """Admin config -> rendered tools.yaml -> (fake) Toolbox over real HTTP/MCP -> agent run -> de-identified answer."""
    import socket
    import sqlite3

    from .fake_toolbox import Server, make_app

    cid, _, audit = world
    monkeypatch.setattr(db_tools, "_toolbox_call", REAL_TOOLBOX_CALL)
    yml = as_user(ADMIN).get("/api/db-connectors/apply/state").json()["render"]["yaml"]
    assert "s3cret" not in yml
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.execute("ATTACH ':memory:' AS public")
    con.execute("CREATE TABLE public.v_stock (name TEXT, qty INT, code TEXT, patient_id TEXT)")
    con.executemany("INSERT INTO public.v_stock VALUES (?,?,?,?)", [("阿斯匹靈", 12, "A1", "p1"), ("王小明 領藥", 3, "B2", "p2"), ("胰島素", 40, "C3", "p3")])
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    seen = []
    monkeypatch.setattr("app.engine.db_tools.settings", lambda: type("S", (), {"toolbox_url": f"http://127.0.0.1:{port}"})())
    qname = next(x["name"] for x in db_tools.tool_specs([cid], BUILDER.email) if x["meta"]["kind"] == "query")
    sqlname = next(x["name"] for x in db_tools.tool_specs([cid], BUILDER.email) if x["meta"]["kind"] == "sql")
    with Server(make_app(yml, con, seen), port):
        script = Script([call(qname, {"reason": "查", "code": "A1"})],
                        [call(sqlname, {"reason": "查多", "sql": "SELECT name, qty FROM public.v_stock WHERE qty > 5"}, "c2")],
                        [call(sqlname, {"reason": "偷看", "sql": "SELECT patient_id FROM public.v_stock"}, "c3")], "完成")
        monkeypatch.setattr(llm, "complete", script)
        r = run(script, cid, BUILDER.email)
    assert r.reply == "完成"
    assert [t for t, _ in seen] == [f"{cid}__ro_pharm__stock", f"{cid}__ro_pharm__sql"]  # the patient_id query never reached Toolbox
    msgs = [m["content"] for m in script.sent[-1]["messages"] if m["role"] == "tool"]
    assert "阿斯匹靈" in msgs[0] and '"qty": 12' in msgs[0]
    assert "胰島素" in msgs[1] and "王小明" not in msgs[1]  # (public.v_stock has 2 rows over 5)
    assert "敏感" in msgs[2]


def test_chat_agent_profile_lists_databases_with_per_user_access(world, as_user):
    cid, _, _ = world
    from app.schemas import AgentIn as A  # noqa: F401
    other = as_user(ADMIN).post("/api/db-connectors", json=body(name="人事資料庫", rules=[{"group_id": "g_nurse", "source_id": "ro_nurse", "queries": [], "views": ["v1"]}])).json()["id"]
    ag = as_user(ADMIN).post("/api/agents", json={"name": "藥師助理", "capabilities": {"db_connectors": [cid, other]}}).json()["id"]
    as_user(ADMIN).post(f"/api/agents/{ag}/publish")
    got = {d["name"]: d for d in as_user(BUILDER).get(f"/api/chat/agents/{ag}").json()["databases"]}
    assert got["藥局資料庫"] == {"id": cid, "name": "藥局資料庫", "kind": "postgres", "allowed": True, "queries": 1, "views": 1}
    assert got["人事資料庫"]["allowed"] is True  # BUILDER is also in the nurse group; first matching rule wins per connector
    plain = {d["name"]: d["allowed"] for d in as_user(PLAIN).get(f"/api/chat/agents/{ag}").json()["databases"]}
    assert plain == {"藥局資料庫": False, "人事資料庫": False}  # listed, but locked: PLAIN is in no group


def test_chat_without_an_agent_uses_only_the_databases_the_user_switched_on(world, as_user, monkeypatch):
    cid, sent, _ = world
    seen = []
    monkeypatch.setattr("app.engine.agent.run_agent", lambda agent, **kw: seen.append((agent.capabilities.db_connectors, kw["user_email"])) or (_ for _ in ()).throw(RuntimeError("stop")))
    monkeypatch.setattr("app.routers.runs.agent_runtime.run_agent", lambda agent, **kw: seen.append((agent.capabilities.db_connectors, kw["user_email"])) or (_ for _ in ()).throw(RuntimeError("stop")))
    for ids in ([], [cid, cid]):
        try:
            as_user(BUILDER).post("/api/chat", json={"message": "庫存?", "db_connectors": ids, "knowledge_scope": "general"})
        except RuntimeError:
            pass
    assert seen == [([], BUILDER.email), ([cid], BUILDER.email)]  # nothing on by default; duplicates collapsed


def test_specific_data_chat_reads_the_chosen_spaces_by_the_callers_rights(world, as_user, monkeypatch):
    seen = []
    monkeypatch.setattr("app.engine.capabilities.space_rag_files", lambda user, ids: [f"{user.email}:{i}" for i in ids])
    monkeypatch.setattr("app.routers.runs.agent_runtime.run_agent", lambda agent, **kw: seen.append(kw["rag_files"]) or (_ for _ in ()).throw(RuntimeError("stop")))
    for scope, ids in (("selected", ["s1", "s1", "s2"]), ("all", ["s1"]), ("general", ["s1"])):
        try:
            as_user(BUILDER).post("/api/chat", json={"message": "hi", "knowledge_scope": scope, "space_ids": ids})
        except RuntimeError:
            pass
    assert seen[0] == [f"{BUILDER.email}:s1", f"{BUILDER.email}:s2"] and seen[1:] == [[], []]  # spaces apply only to 具體資料


def test_slash_skills_are_added_for_that_message_and_checked_per_user(world, as_user, fs, monkeypatch):
    fs.put("skills/k1", {"name": "衛教語氣", "instructions": "用淺白的話", "enabled": True, "owner_uid": "x", "share": {"access": "account", "role": "use", "members": []}})
    fs.put("skills/k2", {"name": "私人", "instructions": "不該被看到", "enabled": True, "owner_uid": "x", "share_keys": []})
    seen = []
    monkeypatch.setattr("app.routers.runs.agent_runtime.run_agent", lambda agent, **kw: seen.append(kw["skill_prefix"]) or (_ for _ in ()).throw(RuntimeError("stop")))
    for ids in ([], ["k1", "k2", "nope"]):
        try:
            as_user(BUILDER).post("/api/chat", json={"message": "hi", "skill_ids": ids, "knowledge_scope": "general"})
        except RuntimeError:
            pass
    assert seen[0] == "" and "淺白" in seen[1] and "不該被看到" not in seen[1]
