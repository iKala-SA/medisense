"""The agent runtime (diagram: 'Agent Runtime'): a tool-calling loop. The MODEL decides what to do.

Instead of walking a fixed canvas, the model is handed tools and chooses which to call, with what arguments, and
how many times, before it answers. Every call becomes one step shown to the user. A step has two kinds of text:
  reason   written by the model ("why I am doing this"), displayed as the model's own words
  summary  written by the platform from what really happened (query, passages found, duration, result), never by
           the model, so a figure on screen cannot be invented
The canvas no longer sequences anything; it declares what the agent MAY do:

  knowledge node       -> tool search_knowledge: search the agent's / the user's library documents
  tool node            -> one tool per node: that connector action (the model fills the arguments)
  his_emr node         -> tool query_his (stub until the FHIR gateway exists)
  approval node        -> write-capable connector actions pause for a human decision before they run
  structured_output    -> after the answer, one JSON-mode call shapes it to the node's schema
  llm node `group`     -> the model group for this agent (else the agent's model_group / auto routing)
  input / output / condition / pii_mask / llm prompts -> no longer used; instructions + the model do that work

Governance is unchanged: messages, retrieved passages and connector results are de-identified before the model sees
them, routing is picked by flow.pick_group (僅院內模型 wins over everything), a pinned model is ignored under it, and
every model call goes to the usage ledger. A model that cannot call tools (e.g. on-prem) simply answers directly.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field

from ..config import settings
from ..schemas import AgentIn, Citation, FlowNode, StepTrace
from . import connectors, deid, routing
from .flow import THINK, _complete, _render, invoke_connector, pick_group

log = logging.getLogger(__name__)
MAX_ROUNDS = 5  # model turns that may end in tool calls; after that the model must answer with what it has
MAX_TOOL_CHARS = 8000
REASON = {"type": "string", "description": "一句話（繁體中文）說明你為什麼要做這一步；會原文顯示給使用者看。"}
GUIDE = ("你可以呼叫工具來完成任務。只有在確實需要時才呼叫：寒暄、一般常識或不需要院內資料的問題請直接回答，不要搜尋。"
         "搜尋結果若與問題無關，請忽略它、不要引用。引用搜尋結果時請在句尾標註來源編號，例如 [1]。"
         "呼叫工具時務必填寫 reason。")


class _Trace(list):
    """The step trace; each appended step is also pushed to the live listener (chat streaming)."""

    def __init__(self, emit=None):
        super().__init__()
        self._emit = emit

    def append(self, step) -> None:
        super().append(step)
        if self._emit:
            self._emit({"event": "step_done", "step": step.model_dump()})


@dataclass
class RunResult:
    reply: str
    trace: list[StepTrace]
    citations: list[Citation] = field(default_factory=list)
    structured: dict | None = None
    pending: dict | None = None


@dataclass
class Tool:
    name: str
    kind: str  # knowledge | tool | his_emr: also the StepTrace type, so the UI labels need nothing new
    spec: dict
    label: str
    write: bool = False
    connector_id: str = ""
    action: str = ""
    fixed: dict = field(default_factory=dict)  # arguments the canvas node pins; the model cannot change them
    raw_args: bool = False  # dynamic (MCP) tool: the model sends a JSON object as `arguments`


def _fn(name: str, description: str, props: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": {"reason": REASON, **props},
                                                            "required": ["reason", *required]}}}


def _connector_tool(node: FlowNode, user_message: str) -> Tool | None:
    from .. import db

    cid, action = str(node.data.get("connector_id") or ""), str(node.data.get("action") or "")
    if not cid or not action:
        return None
    snap = db.client().collection("connectors").document(cid).get()
    if not snap.exists:
        log.warning("agent tool: connector %s does not exist", cid)
        return None
    data = snap.to_dict() or {}
    ctype = data.get("type", "")
    spec = connectors.TYPES.get(ctype, {})
    acts = spec.get("actions")
    act = next((a for a in acts if a["id"] == action), None) if isinstance(acts, list) else None
    raw = node.data.get("args") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            raw = {"payload": raw}
    fixed = {k: _render(str(v), {"input": user_message, "last": user_message}) for k, v in raw.items() if str(v).strip()}
    name = re.sub(r"[^A-Za-z0-9_-]", "_", f"{ctype}_{node.id}")[:60]
    label = f"{data.get('name') or spec.get('label') or ctype} · {(act or {}).get('label') or action}"
    if act:
        props = {a["key"]: {"type": "string", "description": a.get("label", a["key"])} for a in act["args"] if a["key"] not in fixed}
        tool = Tool(name, "tool", _fn(name, label, props, []), label, write=bool(act.get("write", True)), connector_id=cid, action=action, fixed=fixed)
    else:  # MCP tools are discovered at runtime, so their argument shape is free-form JSON
        props = {"arguments": {"type": "string", "description": "傳給工具的參數，JSON 物件字串"}}
        tool = Tool(name, "tool", _fn(name, label, props, []), label, write=True, connector_id=cid, action=action, fixed=fixed, raw_args=True)
    return tool


def build_tools(agent: AgentIn, rag_files: list[str], user_message: str) -> dict[str, Tool]:
    tools: dict[str, Tool] = {}
    if rag_files:
        tools["search_knowledge"] = Tool(
            "search_knowledge", "knowledge",
            _fn("search_knowledge", "搜尋院內知識庫（指引、辦法、醫學文件）。只在問題需要院內資料時使用；一次一個主題，關鍵字要具體。",
                {"query": {"type": "string", "description": "搜尋關鍵字或完整問句"}}, ["query"]), "檢索院內文件")
    for n in agent.flow.nodes:
        if n.type == "tool" and (t := _connector_tool(n, user_message)):
            tools[t.name] = t
        elif n.type == "his_emr" and "query_his" not in tools:
            tools["query_his"] = Tool("query_his", "his_emr", _fn("query_his", "查詢 HIS/EMR（尚未串接）。",
                                                                  {"query": {"type": "string", "description": "查詢條件"}}, ["query"]), "HIS/EMR")
    return tools


def _clip(s: str) -> str:
    return s if len(s) <= MAX_TOOL_CHARS else s[:MAX_TOOL_CHARS] + "\n…（內容過長已截斷）"


def run_agent(agent: AgentIn, *, agent_id: str, user_id: str, user_message: str, history: list[dict],
              rag_files: list[str] | None = None, resume: dict | None = None, skill_prefix: str = "",
              extra_context: str = "", pin_model: str | None = None, emit=None) -> RunResult:
    """One conversation turn. `resume` = the `pending` dict a previous run returned at an approval: the paused
    tool call is executed (approved) and the loop continues. `emit(event)` feeds the chat stream:
    step_start, step_skip, step_done, delta, citations."""
    flow = agent.flow
    rag_files = rag_files or []
    res = RunResult(reply="", trace=_Trace(emit))
    if pin_model and (agent.routing.sovereign_only or routing.sovereign_only()):
        pin_model = None  # data-residency policy outranks a model pick
    base = agent.instructions or f"You are {agent.name}. {agent.description}".strip()
    if extra_context:
        base = f"{base}\n\n{extra_context}"
    system = f"{skill_prefix}\n\n{base}" if skill_prefix else base

    tools = build_tools(agent, rag_files, user_message)
    specs = [t.spec for t in tools.values()]
    if specs:
        system = f"{system}\n\n{GUIDE}"
    llm_node = next((n for n in flow.nodes if n.type == "llm"), FlowNode(id="llm", type="llm", data={}))
    group, note = pick_group(agent, llm_node, user_message)
    think = THINK.get(group)
    if pin_model:
        group, note, think = pin_model, "使用者指定模型", ("medium" if "pro" in pin_model else None)
    approval = next((n for n in flow.nodes if n.type == "approval"), None)
    structured_node = next((n for n in flow.nodes if n.type == "structured_output"), None)

    seen: dict[tuple[str, str], int] = {}  # passage -> its [n]

    def number(chunk: dict) -> int:
        key = (chunk["source"], chunk["text"][:80])
        if key not in seen:
            seen[key] = len(res.citations) + 1
            res.citations.append(Citation(source=chunk["source"], uri=chunk["uri"], score=chunk["score"], text=chunk["text"][:600],
                                          doc_id=chunk.get("doc_id", ""), page=chunk.get("page")))
        return seen[key]

    def search(query: str) -> tuple[str, str]:
        from . import rag  # lazy: only runs that search pay the import cost

        t0 = time.perf_counter()
        try:
            chunks = rag.retrieve(rag.hospital_corpus(), rag_files, query, top_k=settings().rag_top_k)
        except Exception as exc:  # noqa: BLE001 - a retrieval outage must not take the answer down
            log.warning("knowledge retrieval failed: %s", exc)
            return "檢索服務暫時無法使用，請改用一般知識回答並告知使用者。", "檢索暫時失敗，改以模型一般知識回答"
        for c, masked in zip(chunks, deid.deidentify_many([c["text"] for c in chunks]), strict=True):
            c["text"] = masked  # safety net: files indexed before upload de-id may still hold PHI
        try:
            index = rag.library_index() if chunks else {}
        except Exception:  # noqa: BLE001 - the viewer link is a nicety, never a reason to fail the answer
            index = {}
        for c in chunks:
            c["doc_id"] = index.get(rag.file_id(c["uri"]), "") or index.get("name:" + c["source"], "")
        if not chunks:
            return "沒有找到相關文件。", f"搜尋「{query}」：沒有找到相關文件"
        body = "\n\n".join(f"[{number(c)}] 來源：{c['source']}\n{c['text']}" for c in chunks)
        if emit:  # the 參考文件 tab fills in as soon as retrieval returns
            emit({"event": "citations", "citations": [c.model_dump() for c in res.citations]})
        return body, f"搜尋「{query}」：命中 {len(chunks)} 段，已去識別化（{int((time.perf_counter() - t0) * 1000)} ms）"

    def execute(tool: Tool, args: dict) -> tuple[str, str]:
        """-> (text the model reads, factual summary for the step). Never raises."""
        try:
            if tool.kind == "knowledge":
                return search(str(args.get("query", "")).strip() or user_message)
            if tool.kind == "his_emr":
                q = str(args.get("query", ""))
                return f"[HIS/EMR 尚未串接] 查詢條件：{q}", "HIS/EMR 閘道未啟用（stub）"
            call_args = {**tool.fixed}
            if tool.raw_args:
                try:
                    call_args |= json.loads(str(args.get("arguments") or "{}"))
                except json.JSONDecodeError:
                    return "參數不是合法 JSON，未執行。", "參數不是合法 JSON，未執行"
            else:
                call_args |= {k: str(v) for k, v in args.items() if v not in (None, "")}
            return invoke_connector(tool.connector_id, tool.action, call_args, agent_id=agent_id, user_id=user_id)
        except Exception as exc:  # noqa: BLE001 - any driver failure becomes a visible step result the model can react to
            return f"[工具錯誤] {exc.__class__.__name__}: {exc}"[:500], f"執行失敗：{exc.__class__.__name__}"

    # ---- state: the conversation the model sees (OpenAI message format)
    if resume:
        messages = list(resume["messages"])
        res.citations = [Citation(**c) for c in resume.get("citations", [])]
        seen.update({(c.source, c.text[:80]): i + 1 for i, c in enumerate(res.citations)})
        queue = [resume["call"], *resume.get("rest", [])]
        approved_id = resume["call"]["id"]
        res.trace.append(StepTrace(node_id=resume.get("node_id", "approval"), type="approval", summary="已由 Agent 負責人核准，繼續執行"))
    else:
        messages = [*history, {"role": "user", "content": user_message}]
        queue, approved_id = [], ""
        res.trace.append(StepTrace(node_id="input", type="input", summary="收到使用者輸入（已去識別化）"))

    first_of_round: dict = {}  # model-call stats, attached to the first tool step of that call

    def run_calls(calls: list[dict]) -> bool:
        """Execute tool calls in order. True = paused for approval (res.pending is set)."""
        for i, call in enumerate(calls):
            tool = tools.get(call["name"])
            args = call["args"]
            reason = str(args.pop("reason", "")).strip() or None
            if tool is None:
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": "未知的工具，未執行。"})
                continue
            if tool.write and approval is not None and call["id"] != approved_id:
                preview = f"{tool.label}\n{json.dumps({**tool.fixed, **args}, ensure_ascii=False, indent=2)}"
                res.pending = {"node_id": approval.id, "message": _render(str(approval.data.get("message") or "核准這個動作？"), {"input": user_message}),
                               "preview": preview, "messages": messages, "citations": [c.model_dump() for c in res.citations],
                               "call": {**call, "args": {**args, **({"reason": reason} if reason else {})}},
                               "rest": [{**c, "args": c["args"]} for c in calls[i + 1:]], "input": user_message}
                res.trace.append(StepTrace(node_id=call["id"], type="approval", reason=reason, summary=f"等待人工核准：{tool.label}"))
                return True
            if emit:
                emit({"event": "step_start", "node_id": call["id"], "type": tool.kind})
            t0 = time.perf_counter()
            text, facts = execute(tool, args)
            stats = first_of_round.pop("stats", {}) if i == 0 else {}
            res.trace.append(StepTrace(node_id=call["id"], type=tool.kind, reason=reason, summary=facts,
                                       ms=int((time.perf_counter() - t0) * 1000) + stats.get("ms", 0), **{k: v for k, v in stats.items() if k != "ms"}))
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": _clip(text)})
        return False

    if queue and run_calls(queue):  # resumed: finish the approved call (and any left in that round)
        res.reply = f"需要核准：{res.pending['message']}"
        return res

    for turn in range(MAX_ROUNDS + 1):
        node_id = f"turn-{turn}"
        offer = specs if turn < MAX_ROUNDS else []  # out of rounds: no more tools, answer with what we have
        if emit:
            emit({"event": "step_start", "node_id": node_id, "type": "turn"})
        c = _complete(agent, agent_id, user_id, group, system=system, messages=messages, think=think, model=pin_model,
                      tools=offer or None,
                      on_delta=(lambda kind, text, nid=node_id: emit({"event": "delta", "node_id": nid, "kind": kind, "text": text})) if emit else None)
        if c.tool_calls and offer:
            if emit:
                emit({"event": "step_skip", "node_id": node_id})  # this turn was a decision, not an answer: its steps are the calls
            calls = []
            for tc in c.tool_calls:
                try:
                    args = json.loads(tc["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                calls.append({"id": tc["id"], "name": tc["name"], "args": args if isinstance(args, dict) else {}})
            messages.append({"role": "assistant", "content": c.text or None,
                             "tool_calls": [{"id": x["id"], "type": "function", "function": {"name": x["name"], "arguments": json.dumps(x["args"], ensure_ascii=False)}}
                                            for x in calls]})
            first_of_round["stats"] = dict(model=c.model, group=group, ms=c.ms, prompt_tokens=c.prompt_tokens, completion_tokens=c.completion_tokens,
                                           cost_usd=c.cost_usd, thinking=c.reasoning or None)
            if run_calls(calls):
                res.reply = f"需要核准：{res.pending['message']}"
                return res
            continue
        text = c.text.strip()
        if not text:  # some models return nothing after a tool result: ask once more without tools
            c2 = _complete(agent, agent_id, user_id, group, system=system, messages=messages, think=think, model=pin_model)
            text = c2.text.strip() or "（模型沒有產生回覆，請重新提問。）"
        res.trace.append(StepTrace(node_id=node_id, type="llm", model=c.model, group=group, ms=c.ms, prompt_tokens=c.prompt_tokens,
                                   completion_tokens=c.completion_tokens, cost_usd=c.cost_usd, thinking=c.reasoning or None,
                                   summary=f"{len(text)} 字" + (f"（{note}）" if note else "") + ("（已達工具呼叫上限）" if turn == MAX_ROUNDS else "")))
        res.reply = text
        break

    if structured_node is not None:
        schema = str(structured_node.data.get("schema") or "{}")
        t0 = time.perf_counter()
        c = _complete(agent, agent_id, user_id, group, json_mode=True,
                      system=f"{system}\n\n只輸出符合下列 JSON Schema 的 JSON 物件，不要加任何說明文字：\n{schema}",
                      messages=[*messages, {"role": "assistant", "content": res.reply}, {"role": "user", "content": "請把上面的回答整理成 JSON。"}],
                      model=pin_model)
        try:
            res.structured = json.loads(c.text)
            res.reply = json.dumps(res.structured, ensure_ascii=False, indent=2)
            summary = "已整理成結構化輸出"
        except json.JSONDecodeError:
            summary = "模型輸出非合法 JSON，保留原回答"
        res.trace.append(StepTrace(node_id=structured_node.id, type="structured_output", model=c.model, group=group, summary=summary,
                                   ms=int((time.perf_counter() - t0) * 1000), prompt_tokens=c.prompt_tokens,
                                   completion_tokens=c.completion_tokens, cost_usd=c.cost_usd))
    return res
