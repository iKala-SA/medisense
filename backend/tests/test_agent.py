"""The agent runtime: the model chooses the steps (engine/agent.py)."""
import json

import pytest

from app.engine import agent as rt
from app.engine import llm, rag
from app.schemas import AgentIn, Citation

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
        {"text": "每份指引應標示版本號", "source": "辦法.pdf", "uri": "x/ragFiles/F1", "score": 0.27, "page": 2}])

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
    s = Script([call("search_knowledge", {"reason": "a", "query": "q1"})], [call("search_knowledge", {"reason": "b", "query": "q2"}, "c2")], "ok [1]")
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


def _web_rig(monkeypatch, enabled=True):
    monkeypatch.setattr("app.engine.features.web_search_enabled", lambda: enabled)
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t.replace("王小明", "[PERSON_NAME]"))
    monkeypatch.setattr("app.engine.usage.record", lambda **k: None)


def test_web_search_is_only_offered_when_switched_on_and_runs_a_grounded_search(fs, monkeypatch):
    _web_rig(monkeypatch)
    sent = []

    def model(**kw):
        sent.append(kw)
        if kw.get("search"):  # the grounded sub-call
            return llm.Completion("台中晴，21–30°C", "gemini-3-flash", 5, 5, 0.0, 9, sources=({"title": "weather.com", "url": "https://x/1"},),
                                 search_queries=("台中 天氣",))
        if not any(m["role"] == "tool" for m in kw["messages"]):
            return llm.Completion("", "gemini-3-flash", 1, 1, 0.0, 1, tool_calls=(call("web_search", {"reason": "查即時天氣", "query": "台中天氣 王小明"}),))
        return llm.Completion("今天台中晴 [1]", "gemini-3-flash", 1, 1, 0.0, 1)

    monkeypatch.setattr(llm, "complete", model)
    off = rt.run_agent(AgentIn(name="M"), agent_id="a", user_id="u", user_message="天氣？", history=[])
    assert sent[0]["tools"] is None and off.reply  # switch off: no tool at all
    sent.clear()
    r = rt.run_agent(AgentIn(name="M"), agent_id="a", user_id="u", user_message="天氣？", history=[], web_search=True)
    assert [x["function"]["name"] for x in sent[0]["tools"]] == ["web_search"]
    step = r.trace[1]
    assert step.type == "web_search" and step.reason == "查即時天氣" and "台中 天氣" in step.summary and "1 個網頁來源" in step.summary
    assert r.citations[0].uri == "https://x/1" and r.reply == "今天台中晴 [1]"
    grounded = [k for k in sent if k.get("search")][0]
    assert "王小明" not in grounded["messages"][0]["content"] and "[PERSON_NAME]" in grounded["messages"][0]["content"]  # query is masked before leaving
    audit = [d for p, d in fs.store.items() if p.startswith("audit/") and d["action"] == "chat.web_search"]
    assert audit and audit[0]["sources"] == 1


def test_web_search_is_refused_under_sovereign_only_and_the_user_is_told(fs, monkeypatch):
    _web_rig(monkeypatch)
    sent = []
    monkeypatch.setattr(llm, "complete", lambda **kw: sent.append(kw) or llm.Completion("ok", "gpt-oss", 1, 1, 0.0, 1))
    r = rt.run_agent(AgentIn(name="M", routing={"sovereign_only": True}), agent_id="a", user_id="u", user_message="x", history=[], web_search=True)
    assert sent[0]["tools"] is None and "網路搜尋已停用" in r.trace[1].summary


def test_web_search_is_skipped_when_the_llm_node_is_sovereign(fs, monkeypatch):
    # Not the hospital-wide switch: the agent's own llm node runs on the on-prem group, so the turn must stay inside.
    _web_rig(monkeypatch)
    sent = []
    monkeypatch.setattr(llm, "complete", lambda **kw: sent.append(kw) or llm.Completion("ok", "gemma-4-12b", 1, 1, 0.0, 1))
    flow = {"nodes": [{"id": "llm", "type": "llm", "data": {"group": "sovereign"}}], "edges": []}
    r = rt.run_agent(AgentIn(name="M", flow=flow), agent_id="a", user_id="u", user_message="x", history=[], web_search=True)
    assert sent[0]["group"] == "sovereign" and sent[0]["tools"] is None
    assert r.trace[1].type == "web_search" and "院內模型" in r.trace[1].summary and "已停用" in r.trace[1].summary


def test_web_search_is_skipped_when_the_user_pins_an_onprem_model(fs, monkeypatch):
    _web_rig(monkeypatch)
    sent = []
    monkeypatch.setattr(llm, "complete", lambda **kw: sent.append(kw) or llm.Completion("ok", "gemma-4-12b", 1, 1, 0.0, 1))
    monkeypatch.setattr(llm, "is_onprem", lambda m: m == "gemma-4-12b")
    r = rt.run_agent(AgentIn(name="M"), agent_id="a", user_id="u", user_message="x", history=[], web_search=True, pin_model="gemma-4-12b")
    assert sent[0]["model"] == "gemma-4-12b" and sent[0]["tools"] is None and "已停用" in r.trace[1].summary
    sent.clear()
    r = rt.run_agent(AgentIn(name="M"), agent_id="a", user_id="u", user_message="x", history=[], web_search=True, pin_model="gemini-2.5-flash")
    assert [x["function"]["name"] for x in sent[0]["tools"]] == ["web_search"]  # a cloud pick keeps the tool


def test_is_onprem_reads_registry_then_gateway_catalog(monkeypatch):
    monkeypatch.setattr(llm, "_registry", lambda: [
        {"name": "Gemma 4 12B", "litellm_model": "ollama_chat/gemma4:12b", "deploy": "onprem", "group": "sovereign"},
        {"name": "gpt-oss", "litellm_model": "openai/gpt-oss-120b", "deploy": "onprem", "group": "sovereign"}])
    monkeypatch.setattr(llm, "model_catalog", lambda: [{"id": "nova-2-lite", "model": "bedrock/jp.amazon.nova-2-lite-v1:0"},
                                                       {"id": "local-vllm", "model": "hosted_vllm/x"},
                                                       {"id": "oss-alias", "model": "openai/gpt-oss-120b"}])
    assert llm.is_onprem("gemma-4-12b")  # registry row, matched by its rendered slug
    assert llm.is_onprem("local-vllm")  # not in the registry: on-prem provider prefix in the gateway catalog
    assert llm.is_onprem("oss-alias")  # openai-compatible on-prem server: same LiteLLM model as an onprem registry row
    assert not llm.is_onprem("nova-2-lite") and not llm.is_onprem("unknown")


def test_web_search_needs_the_admin_switch_too(fs, monkeypatch):
    _web_rig(monkeypatch, enabled=False)
    sent = []
    monkeypatch.setattr(llm, "complete", lambda **kw: sent.append(kw) or llm.Completion("ok", "gemini-3-flash", 1, 1, 0.0, 1))
    r = rt.run_agent(AgentIn(name="M"), agent_id="a", user_id="u", user_message="x", history=[], web_search=True)
    assert sent[0]["tools"] is None and r.trace[1].summary == "管理員尚未開放網路搜尋"


def test_the_model_is_told_the_current_date(rig):
    s = Script("ok")
    rig(s)
    import re

    assert re.search(r"現在時間：\d{4}-\d{2}-\d{2} \d{2}:\d{2}（Asia/Taipei）", s.sent[0]["system"])


def _chunks(*dists):
    return [{"text": f"段落{i}", "source": f"文件{i}.pdf", "uri": f"x/ragFiles/F{i}", "score": d, "page": None} for i, d in enumerate(dists)]


def test_retrieval_is_filtered_by_distance_and_borderline_passages_are_flagged(rig, monkeypatch):
    monkeypatch.setattr(rag, "retrieve", lambda *a, **k: _chunks(0.27, 0.47, 0.54, 0.59))  # smaller = more similar
    s = Script([call("search_knowledge", {"reason": "r", "query": "q"})], "答案 [1][2]")
    r, _ = rig(s, rag_files=["f"])
    assert [c.low for c in r.citations] == [False, True] and len(r.citations) == 2  # 0.54 and 0.59 never reach the model
    k = r.trace[1].summary
    assert "命中 2 段（1 段低相關）" in k and "捨棄 2 段不相關" in k
    tool = [m for m in s.sent[1]["messages"] if m["role"] == "tool"][0]["content"]
    assert "[1] 來源：文件0.pdf" in tool and "[2]（低相關） 來源：文件1.pdf" in tool and "段落2" not in tool


def test_when_everything_is_too_far_the_model_hears_there_was_nothing_and_no_citations_exist(rig, monkeypatch):
    monkeypatch.setattr(rag, "retrieve", lambda *a, **k: _chunks(0.539, 0.543))
    s = Script([call("search_knowledge", {"reason": "r", "query": "今天天氣"})], "院內文件中沒有找到相關依據，以下為一般知識")
    r, _ = rig(s, rag_files=["f"])
    assert not r.citations
    assert "命中 0 段（最近的一段距離 0.54，超過門檻 0.50，已捨棄）" in r.trace[1].summary
    assert "沒有找到足夠相關的院內文件" in [m for m in s.sent[1]["messages"] if m["role"] == "tool"][0]["content"]
    assert "非院內依據" in s.sent[0]["system"]  # the standing instruction for exactly this case


def test_thresholds_follow_the_admin_setting(rig, monkeypatch):
    monkeypatch.setattr(rag, "retrieve", lambda *a, **k: _chunks(0.47))
    monkeypatch.setattr("app.engine.features.rag_thresholds", lambda: (0.30, 0.50))  # admin loosened it
    r, _ = rig(Script([call("search_knowledge", {"reason": "r", "query": "q"})], "ok [1]"), rag_files=["f"])
    assert len(r.citations) == 1 and r.citations[0].low


def _cites(n):
    return [Citation(source=f"文件{i}.pdf", uri=f"u{i}") for i in range(1, n + 1)]


def test_cited_sources_come_first_renumbered_and_the_rest_stay_listed_as_unused():
    text, cites = rt.prune_citations("甲 [3]，乙 [1][3]，丙 [7]。", _cites(4))
    assert [(c.source, c.cited) for c in cites] == [("文件1.pdf", True), ("文件3.pdf", True), ("文件2.pdf", False), ("文件4.pdf", False)]
    assert text == "甲 [2]，乙 [1][2]，丙 。"  # 3 -> 2, 1 -> 1; [7] pointed at nothing and is removed


def test_grouped_markers_are_split_and_code_and_links_are_left_alone():
    text, cites = rt.prune_citations("見 [2, 3]。程式 `x = [1, 2]` 與\n```\ny = [1, 2, 3]\n```\n另見 [連結 1](http://a) 與 [2](http://b)", _cites(3))
    assert [c.source for c in cites if c.cited] == ["文件2.pdf", "文件3.pdf"] and [c.source for c in cites if not c.cited] == ["文件1.pdf"]
    assert text.startswith("見 [1][2]。") and "`x = [1, 2]`" in text and "y = [1, 2, 3]" in text and "[2](http://b)" in text


def test_nothing_cited_still_lists_what_was_retrieved_and_no_sources_means_untouched_text():
    text, cites = rt.prune_citations("完全沒引用", _cites(3))
    assert text == "完全沒引用" and [c.cited for c in cites] == [False, False, False]  # the tab shows what was found, marked 未引用
    assert rt.prune_citations("a [1]", []) == ("a [1]", [])
    db = Citation(source="門診統計", kind="database", text="{\"n\": 1}")
    text, cites = rt.prune_citations("共 1 筆 [2]", [*_cites(2), db])
    assert [(c.source, c.kind, c.cited) for c in cites] == [("文件2.pdf", "document", True), ("門診統計", "database", True), ("文件1.pdf", "document", False)]


def test_a_database_query_becomes_a_reference(fs, rig, monkeypatch):
    monkeypatch.setattr(rt.db_tools, "tool_specs", lambda ids, email: [{"name": "db_sql_x", "description": "查", "props": {"sql": {"type": "string"}}, "required": ["sql"],
                                                                         "label": "門診統計", "meta": {"connector_id": "x", "kind": "sql"}}])
    monkeypatch.setattr(rt.db_tools, "execute", lambda meta, args, **k: ('{"dept": "內科", "n": 12}', "門診統計 · 1 筆"))
    ag = AgentIn.model_validate({"name": "A", "capabilities": {"db_connectors": ["x"]}})
    r, ev = rig(Script([call("db_sql_x", {"reason": "r", "sql": "SELECT 1"})], "內科 12 人"), ag)
    assert [(c.kind, c.source, c.cited) for c in r.citations] == [("database", "門診統計", True)] and "內科" in r.citations[0].text
    assert "1 次資料庫查詢" in r.trace[-1].summary and "citations" in [e["event"] for e in ev]
    monkeypatch.setattr(rt.db_tools, "execute", lambda meta, args, **k: ("[資料庫] 需要授權", "門診統計 · 需要 BigQuery 授權"))
    r, _ = rig(Script([call("db_sql_x", {"reason": "r", "sql": "SELECT 1"})], "無法查詢"), ag)
    assert not r.citations  # an error is not a source


def test_retrieved_but_unused_passages_stay_listed_after_the_cited_ones(rig, monkeypatch):
    monkeypatch.setattr(rag, "retrieve", lambda *a, **k: _chunks(0.20, 0.25, 0.30))
    s = Script([call("search_knowledge", {"reason": "r", "query": "q"})], "只有第二段有用 [2]")
    r, _ = rig(s, rag_files=["f"])
    assert [(c.source, c.cited) for c in r.citations] == [("文件1.pdf", True), ("文件0.pdf", False), ("文件2.pdf", False)]
    assert r.reply == "只有第二段有用 [1]" and "引用 1/3 個來源" in r.trace[-1].summary


def test_passages_of_one_file_share_one_reference(rig, monkeypatch):
    same = lambda text, d, pg: {"text": text, "source": "辦法.pdf", "uri": "x/ragFiles/F1", "score": d, "page": pg}  # noqa: E731
    monkeypatch.setattr(rag, "retrieve", lambda *a, **k: [same("第二章 版本管理", 0.30, 2), same("第三章 審核流程", 0.25, 3),
                                                         same("第二章 版本管理", 0.30, 2),  # the same passage twice: kept once
                                                         {"text": "別份文件", "source": "另一份.pdf", "uri": "x/ragFiles/F2", "score": 0.28, "page": None}])
    s = Script([call("search_knowledge", {"reason": "r", "query": "q"})], "由副院長核定 [1]，另見 [2]")
    r, _ = rig(s, rag_files=["f"])
    assert [c.source for c in r.citations] == ["辦法.pdf", "另一份.pdf"]  # two files, not four passages
    one = r.citations[0]
    assert [p.text for p in one.passages] == ["第三章 審核流程", "第二章 版本管理"]  # best first, duplicate dropped
    assert one.text == "第三章 審核流程" and one.page == 3 and one.score == 0.25  # the top-level fields mirror the best passage
    tool = [m for m in s.sent[1]["messages"] if m["role"] == "tool"][0]["content"]
    assert tool.count("[1] 來源：辦法.pdf") == 2 and tool.count("[2] 來源：另一份.pdf") == 1  # one number per file
    assert "命中 3 段（來自 2 份文件）" in r.trace[1].summary


def test_citing_a_multi_passage_file_once_keeps_all_its_passages(rig, monkeypatch):
    monkeypatch.setattr(rag, "retrieve", lambda *a, **k: [
        {"text": "段一", "source": "辦法.pdf", "uri": "u", "score": 0.2, "page": 1}, {"text": "段二", "source": "辦法.pdf", "uri": "u", "score": 0.3, "page": 4}])
    r, _ = rig(Script([call("search_knowledge", {"reason": "r", "query": "q"})], "依辦法 [1]"), rag_files=["f"])
    assert len(r.citations) == 1 and len(r.citations[0].passages) == 2 and "引用 1/1 個來源" in r.trace[-1].summary


def test_the_model_is_told_to_answer_in_the_users_language(rig):
    s = Script("Bonjour")
    rig(s, rag_files=["f"], msg="Bonjour, quelle est la règle de versionnement ?")
    sys_prompt = s.sent[0]["system"]
    assert "language of the user's latest message" in sys_prompt and "French" in sys_prompt
    assert "USER's language" in s.sent[0]["tools"][0]["function"]["parameters"]["properties"]["reason"]["description"]


def _capability_agent(fs, require_approval=True):
    fs.put("connectors/cal1", {"type": "calendar", "label": "Google Calendar", "config": {"write_actions": ["quick_add_event"]}})
    return AgentIn.model_validate({"name": "A", "capabilities": {"connectors": [{"connector_id": "cal1", "action": "quick_add_event", "require_approval": require_approval}]}})


def test_a_capability_marked_需核准_pauses_for_the_user_even_without_an_approval_node(fs, rig, monkeypatch):
    ran = []
    monkeypatch.setattr(rt, "invoke_connector", lambda cid, action, args, **k: ran.append(args) or ("已建立", "Google Calendar · quick_add_event · 成功"))
    ag = _capability_agent(fs)
    tool = next(iter(rt.build_tools(ag, [], "x").values()))
    assert tool.write and tool.gate == "user" and tool.spec["function"]["parameters"]["required"] == ["reason", "text"]
    r, _ = rig(Script([call(tool.name, {"reason": "使用者要排會議", "text": "明天 15:00 心臟科討論"})], "好的"), ag)
    assert r.pending and r.pending["approver"] == "user" and "快速建立事件" in r.pending["preview"] and not ran
    assert r.trace[-1].type == "approval" and "使用者確認" in r.trace[-1].summary
    monkeypatch.setattr(llm, "complete", Script("已幫您建立"))
    r2 = rt.run_agent(ag, agent_id="a", user_id="u", user_message="x", history=[], resume=r.pending)
    assert ran == [{"text": "明天 15:00 心臟科討論"}] and r2.reply == "已幫您建立" and not r2.pending
    assert r2.trace[0].summary == "已由使用者核准，繼續執行"


def test_a_capability_with_approval_off_runs_straight_through(fs, rig, monkeypatch):
    ran = []
    monkeypatch.setattr(rt, "invoke_connector", lambda cid, action, args, **k: ran.append(args) or ("ok", "成功"))
    ag = _capability_agent(fs, require_approval=False)
    tool = next(iter(rt.build_tools(ag, [], "x").values()))
    assert not tool.write and not tool.gate
    r, _ = rig(Script([call(tool.name, {"reason": "r", "text": "t"})], "done"), ag)
    assert ran and not r.pending


def test_structured_arguments_reach_the_connector_as_json_not_strings(fs, rig, monkeypatch):
    seen = {}
    monkeypatch.setattr(rt, "invoke_connector", lambda cid, action, args, **k: seen.update(args) or ("ok", "成功"))
    fs.put("connectors/g1", {"type": "gateway", "label": "Cal", "config": {"service": "googlecalendar", "allowed_actions": ["googlecalendar.create_event"]}})
    monkeypatch.setattr(rt.ga, "describe", lambda cfg: [{"id": "googlecalendar.create_event", "label": "create_event", "description": "Create", "write": True, "operation": "write",
                                                         "args": [{"key": "calendarId", "label": "Calendar", "kind": "text", "required": True},
                                                                  {"key": "event", "label": "Event", "kind": "textarea", "required": True,
                                                                   "schema": {"type": "object", "properties": {"summary": {"type": "string"}}, "required": []}}]}])
    ag = AgentIn.model_validate({"name": "A", "capabilities": {"connectors": [{"connector_id": "g1", "action": "googlecalendar.create_event", "require_approval": False}]}})
    tool = next(iter(rt.build_tools(ag, [], "x").values()))
    params = tool.spec["function"]["parameters"]
    assert params["properties"]["event"]["type"] == "object" and params["properties"]["event"]["properties"] == {"summary": {"type": "string"}}
    assert params["required"] == ["reason", "calendarId", "event"] and tool.spec["function"]["description"].endswith("：Create")
    rig(Script([call(tool.name, {"reason": "r", "calendarId": "primary", "event": {"summary": "門診會議"}})], "done"), ag)
    assert seen == {"calendarId": "primary", "event": {"summary": "門診會議"}}


def test_a_source_cited_by_file_name_counts_as_cited_and_becomes_its_number():
    cites = [Citation(source="胃鏡檢查前後注意事項.pdf"), Citation(source="電腦斷層與顯影劑注意事項.pdf"), Citation(source="其他.pdf")]
    text, out = rt.prune_citations("請禁食 (資料來源：[電腦斷層與顯影劑注意事項.pdf]、[胃鏡檢查前後注意事項])。程式 `[其他.pdf]`，連結 [其他](http://x)", cites)
    assert text.startswith("請禁食 (資料來源：[2]、[1])") and "`[其他.pdf]`" in text and "[其他](http://x)" in text
    assert [(c.source, c.cited) for c in out] == [("胃鏡檢查前後注意事項.pdf", True), ("電腦斷層與顯影劑注意事項.pdf", True), ("其他.pdf", False)]
