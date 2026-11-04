"""Database connectors inside an agent run (MVP): two tools per connection, guarded read-only SQL, de-identified rows, audit."""
import json

import pytest

from app.engine import agent as rt
from app.engine import db_direct, db_tools, llm
from app.schemas import AgentIn, Capabilities

from .conftest import ADMIN, PLAIN
from .test_agent import Script, call
from .test_db_connectors import body, secrets  # noqa: F401  (fixture)


@pytest.fixture
def world(fs, as_user, secrets, monkeypatch, audit_log):  # noqa: F811
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("王小明", "[PERSON_NAME]"))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    cid = as_user(ADMIN).post("/api/db-connectors", json=body(max_rows=2)).json()["id"]
    sent = []

    def run(kind, conn, user, password, sql, max_rows):
        sent.append({"kind": kind, "host": conn["host"], "user": user, "password": password, "sql": sql, "max_rows": max_rows})
        if "information_schema" in sql.lower():
            return '{"t":"public.v_stock","c":"name","ty":"text"}\n{"t":"public.v_stock","c":"qty","ty":"integer"}'
        return '{"name":"阿斯匹靈","qty":12}\n{"name":"王小明 領藥","qty":3}'
    monkeypatch.setattr(db_direct, "run", run)
    return cid, sent, audit_log


def spec(cid, kind):
    return next(s for s in db_tools.tool_specs([cid]) if s["meta"]["kind"] == kind)


def test_each_connection_gives_a_tables_tool_and_a_sql_tool(world):
    cid, _, _ = world
    specs = db_tools.tool_specs([cid])
    assert [s["meta"]["kind"] for s in specs] == ["tables", "sql"]
    assert "PostgreSQL" in specs[1]["description"] and "藥品庫存與領藥紀錄" in specs[1]["description"] and "最多回傳 2 筆" in specs[1]["description"]
    assert db_tools.tool_specs([]) == [] and db_tools.tool_specs(["nope"]) == []


def test_tables_tool_lists_columns_with_the_connection_login(world):
    cid, sent, _ = world
    text, summary = db_tools.execute(spec(cid, "tables")["meta"], {}, user_id="u", email=PLAIN.email, agent_id="a")
    assert text == "- public.v_stock：name(text), qty(integer)" and summary == "藥局資料庫 · 資料表"
    assert sent[0]["user"] == "ro_pharm" and sent[0]["password"] == "s3cret"


def test_model_sql_is_guarded_limited_deidentified_and_audited(world, monkeypatch):
    cid, sent, audit = world
    name = spec(cid, "sql")["name"]
    s = Script([call(name, {"reason": "r", "sql": "DELETE FROM v_stock"})],
               [call(name, {"reason": "r", "sql": "SELECT name, qty FROM public.v_stock WHERE qty > 1"}, "c2")], "庫存 12")
    monkeypatch.setattr(llm, "complete", s)
    ag = AgentIn(name="藥師助理", capabilities=Capabilities(db_connectors=[cid]))
    r = rt.run_agent(ag, agent_id="a", user_id="u", user_message="庫存?", history=[], user_email=PLAIN.email)
    assert [x["sql"] for x in sent] == ["SELECT name, qty FROM public.v_stock WHERE qty > 1 LIMIT 2"]  # the DELETE never left
    tools = [m["content"] for m in s.sent[-1]["messages"] if m["role"] == "tool"]
    assert "未通過檢查" in tools[0]
    assert "阿斯匹靈" in tools[1] and "王小明" not in tools[1] and "[PERSON_NAME]" in tools[1] and "2 筆上限" in tools[1]
    assert r.reply == "庫存 12"
    logs = [x for x in audit() if x["action"] == "db.query"]
    assert [x["ok"] for x in logs] == [False, True] and logs[1]["rows"] == 2 and "阿斯匹靈" not in json.dumps(logs, default=str)


def test_driver_errors_are_reported_not_raised(world, monkeypatch):
    cid, _, audit = world

    def boom(*a, **k):
        raise db_direct.DirectError("帳號或密碼錯誤")
    monkeypatch.setattr(db_direct, "run", boom)
    text, summary = db_tools.execute(spec(cid, "sql")["meta"], {"sql": "SELECT 1"}, user_id="u", email=PLAIN.email, agent_id="a")
    assert "帳號或密碼錯誤" in text and "未執行" in summary
    assert audit()[-1]["ok"] is False


def test_describe_filters_and_truncates():
    rows = [(f"t{i}", "c", "int") for i in range(50)]
    assert db_direct.describe(rows, match="t4").count("\n") == 10  # t4, t40..t49
    assert "未列出" in db_direct.describe(rows, max_chars=60)
    assert db_direct.describe([], match="x") == "（找不到符合的資料表）"
