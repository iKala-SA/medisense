"""The agent runtime: the model chooses the steps (engine/agent.py)."""
import json

import pytest

from app.engine import agent as rt
from app.engine import llm, rag
from app.schemas import AgentIn

from .conftest import BUILDER


def call(name, args, id_="c1"):
    return {"id": id_, "name": name, "arguments": json.dumps(args, ensure_ascii=False)}


class Script:
    """A fake model: each complete() pops the next scripted turn (text or tool calls) and records what it was sent."""

    def __init__(self, *turns):
        self.turns, self.sent = list(turns), []

    def __call__(self, **kw):
        self.sent.append(kw)
        t = self.turns.pop(0)
        if kw.get("on_delta") and isinstance(t, str):
            kw["on_delta"]("text", t)
        calls = tuple(t) if isinstance(t, list) else ()
        return llm.Completion("" if calls else t, "gemini-3-flash", 10, 5, 0.001, 7, reasoning="先想一下" if calls else "", tool_calls=calls)


@pytest.fixture
def rig(fs, monkeypatch):
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr("app.engine.deid.deidentify_many", lambda ts: list(ts))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)
    monkeypatch.setattr(rag, "hospital_corpus", lambda: "c")
    monkeypatch.setattr(rag, "library_index", lambda: {"F1": "d1"})
    monkeypatch.setattr(rag, "retrieve", lambda *a, **k: [
        {"text": "每份指引應標示版本號", "source": "辦法.pdf", "uri": "x/ragFiles/F1", "score": 0.9, "page": 2}])

    def go(script, agent=None, **kw):
        monkeypatch.setattr(llm, "complete", script)
        events = []
        r = rt.run_agent(agent or AgentIn(name="Medisense"), agent_id="a", user_id="u", user_message=kw.pop("msg", "指引版本管理？"),
                         history=[], emit=events.append, **kw)
        return r, events
    return go


def test_model_that_answers_directly_never_searches(rig):
    s = Script("你好！")
    r, ev = rig(s, rag_files=["f"], msg="hello")
    assert r.reply == "你好！" and [t.type for t in r.trace] == ["input", "llm"] and not r.citations
    assert [x["function"]["name"] for x in s.sent[0]["tools"]] == ["search_knowledge"]  # offered, not forced


def test_model_decides_to_search_and_the_steps_carry_its_reason_and_the_platform_facts(rig):
    s = Script([call("search_knowledge", {"reason": "使用者問院內版本規定，先搜尋指引", "query": "指引 版本"})], "標示版本號 [1]")
    r, ev = rig(s, rag_files=["f"])
    assert [t.type for t in r.trace] == ["input", "knowledge", "llm"]
    k = r.trace[1]
    assert k.reason == "使用者問院內版本規定，先搜尋指引"  # the model's words
    assert "命中 1 段" in k.summary and "指引 版本" in k.summary  # the platform's facts
    assert k.model == "gemini-3-flash" and k.prompt_tokens == 10 and k.thinking == "先想一下"  # the deciding call's stats
    assert r.reply == "標示版本號 [1]" and r.citations[0].doc_id == "d1" and r.citations[0].page == 2
    # the passage reached the model as a tool result, numbered for citation
    tool_msg = [m for m in s.sent[1]["messages"] if m["role"] == "tool"][0]
    assert tool_msg["content"].startswith("[1] 來源：辦法.pdf")
    kinds = [e["event"] for e in ev]
    assert "citations" in kinds and ("step_skip", "turn-0") in [(e["event"], e.get("node_id")) for e in ev]


def test_search_can_repeat_and_passages_keep_stable_numbers(rig):
    s = Script([call("search_knowledge", {"reason": "a", "query": "q1"})], [call("search_knowledge", {"reason": "b", "query": "q2"}, "c2")], "ok")
    r, _ = rig(s, rag_files=["f"])
    assert [t.type for t in r.trace] == ["input", "knowledge", "knowledge", "llm"] and len(r.citations) == 1  # same passage, one [1]


def test_no_documents_means_no_search_tool(rig):
    s = Script("ok")
    rig(s)
    assert s.sent[0]["tools"] is None


def test_runaway_tool_loop_is_stopped_and_the_model_must_answer(rig):
    s = Script(*[[call("search_knowledge", {"reason": "r", "query": "q"}, f"c{i}")] for i in range(rt.MAX_ROUNDS)], "只好這樣回答")
    r, _ = rig(s, rag_files=["f"])
    assert r.reply == "只好這樣回答" and s.sent[-1].get("tools") is None and "已達工具呼叫上限" in r.trace[-1].summary


def test_pinned_model_is_used_but_sovereign_only_wins(rig):
    s = Script("ok")
    rig(s, pin_model="gemini-2.5-flash")
    assert s.sent[0]["model"] == "gemini-2.5-flash"
    s2 = Script("ok")
    rig(s2, AgentIn(name="A", routing={"sovereign_only": True}), pin_model="gemini-2.5-flash")
    assert s2.sent[0]["model"] is None and s2.sent[0]["group"] == "sovereign"


def _connector(fs, write):
    fs.put("connectors/k1", {"type": "slack", "name": "護理站 Slack", "config": {}, "secrets": {}})
    return AgentIn.model_validate({"name": "A", "flow": {"nodes": [
        {"id": "t1", "type": "tool", "data": {"connector_id": "k1", "action": "send_message"}},
        *([{"id": "ap", "type": "approval", "data": {"message": "要送出訊息嗎？"}}] if write else [])], "edges": []}})


def test_write_tool_pauses_for_approval_then_resumes(fs, rig, monkeypatch):
    ran = []
    monkeypatch.setattr(rt, "invoke_connector", lambda cid, action, args, **k: ran.append(args) or ("已送出", "Slack · 成功"))
    ag = _connector(fs, write=True)
    tool = next(iter(rt.build_tools(ag, [], "x").values()))
    assert tool.write and "text" in tool.spec["function"]["parameters"]["properties"]
    s = Script([call(tool.name, {"reason": "通知值班護理師", "text": "請查房"})], "已通知")
    r, _ = rig(s, ag)
    assert r.pending and r.pending["message"] == "要送出訊息嗎？" and not ran  # nothing sent before a human says yes
    assert r.trace[-1].type == "approval" and r.trace[-1].reason == "通知值班護理師"
    s2 = Script("已通知")
    monkeypatch.setattr(llm, "complete", s2)
    r2 = rt.run_agent(ag, agent_id="a", user_id="u", user_message="x", history=[], resume=r.pending)
    assert ran == [{"text": "請查房"}] and r2.reply == "已通知" and not r2.pending
    assert [t.type for t in r2.trace] == ["approval", "tool", "llm"]


def test_write_tool_runs_straight_through_without_an_approval_node(fs, rig, monkeypatch):
    ran = []
    monkeypatch.setattr(rt, "invoke_connector", lambda cid, action, args, **k: ran.append(args) or ("ok", "成功"))
    ag = _connector(fs, write=False)
    tool = next(iter(rt.build_tools(ag, [], "x").values()))
    r, _ = rig(Script([call(tool.name, {"reason": "r", "text": "hi"})], "done"), ag)
    assert ran and not r.pending and r.reply == "done"


def test_tool_failure_is_reported_to_the_model_not_raised(fs, rig, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(rt, "invoke_connector", boom)
    ag = _connector(fs, write=False)
    tool = next(iter(rt.build_tools(ag, [], "x").values()))
    s = Script([call(tool.name, {"reason": "r", "text": "hi"})], "抱歉，工具暫時無法使用")
    r, _ = rig(s, ag)
    assert "執行失敗" in r.trace[1].summary and "RuntimeError" in [m for m in s.sent[1]["messages"] if m["role"] == "tool"][0]["content"]


def test_empty_answer_after_a_tool_is_retried_once_without_tools(rig):
    s = Script([call("search_knowledge", {"reason": "r", "query": "q"})], "", "補答")
    r, _ = rig(s, rag_files=["f"])
    assert r.reply == "補答" and s.sent[-1].get("tools") is None


def test_structured_output_node_shapes_the_final_answer(fs, rig):
    ag = AgentIn.model_validate({"name": "A", "flow": {"nodes": [{"id": "so", "type": "structured_output", "data": {"schema": "{}"}}], "edges": []}})
    r, _ = rig(Script("很好", '{"ok": true}'), ag)
    assert r.structured == {"ok": True} and r.trace[-1].type == "structured_output"
