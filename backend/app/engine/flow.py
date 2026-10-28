"""The no-code flow interpreter (diagram: 'Agent Runtime').

A canvas is a DAG of node types. We walk it from the `input` node following edges:

  input             -> the user message (already de-identified) becomes {{input}}
  his_emr           -> data: {query}      ; STUB until the FHIR gateway exists; returns a marker
  pii_mask          -> DEPRECATED no-op kept so older canvases still run; the platform de-identifies
                       every message, knowledge file and retrieved chunk itself
  knowledge         -> data: {query?} ; retrieves RAG_TOP_K chunks chunks from the agent's attached library documents -> {{<id>}} (de-identified)
  llm               -> one LiteLLM call; data: {prompt, group?} ; prompt may use {{input}}, {{last}}, {{<nodeId>}}
  condition         -> data: {question} ; an LLM yes/no decides which outgoing edge (sourceHandle "true"/"false")
  tool              -> data: {connector_id, action, args{}} ; runs one connector action (engine.connectors)
  approval          -> pauses the run and returns pending_approval (human-in-the-loop)
  structured_output -> data: {prompt, schema} ; JSON-mode LLM call, parsed object returned as `structured`
  output            -> data: {template} ; final reply, default {{last}}

Routing: the agent's RoutingPolicy picks the model group per llm step unless the node pins one.
`sovereign_only` forces the on-prem-only group and never falls back (LiteLLM has no cloud member).
See pick_group for the full order; condition nodes route the same way as llm nodes.

Knowledge convention: when a knowledge node precedes an llm node, the llm prompt can reference
{{<knowledgeNodeId>}}; if it does not, the retrieved chunks are appended to the system prompt so a
plain "{{input}}" prompt still gets grounded answers.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

from ..config import settings
from ..schemas import AgentIn, Citation, Flow, FlowNode, StepTrace
from . import deid, llm, routing, usage

MAX_STEPS = 40
_VAR = re.compile(r"{{\s*([\w\-]+)\s*}}")


@dataclass
class RunResult:
    reply: str
    trace: list[StepTrace]
    citations: list[Citation] = field(default_factory=list)
    structured: dict | None = None
    pending: dict | None = None


def _render(template: str, ctx: dict[str, str]) -> str:
    return _VAR.sub(lambda m: ctx.get(m.group(1), ""), template)


COST_TIER = {"budget": 0, "fast": 1, "reasoning": 2}  # sovereign is a data-residency choice, not a cost tier


def pick_group(agent: AgentIn, node: FlowNode, user_text: str) -> tuple[str, str]:
    """Model group for one llm / structured_output / condition step, plus a note for the trace.

    1. sovereign_only (the hospital-wide 僅院內模型 switch in config/routing, or the agent's own): every step
       on-prem, nothing overrides it, and there is no cloud fallback.
    2. the node's own group, else
    3. (agent/node group "auto" is resolved through config/routing rules, see engine/routing.py)
       reasoning if the USER's message (not the rendered prompt, which may carry retrieved text)
       contains a reasoning keyword, else
    4. the agent's default group (model_group).
    Then the cost cap is a ceiling: anything above max_cost_tier is lowered to it.
    """
    if agent.routing.sovereign_only:
        return "sovereign", ""
    if routing.sovereign_only():
        return "sovereign", routing.SOVEREIGN_REASON
    text = user_text.lower()
    want = str(node.data.get("group") or "") or (
        "reasoning" if agent.model_group != "auto" and any(k.lower() in text for k in agent.routing.reasoning_keywords)
        else agent.model_group)
    auto_note = ""
    if want == "auto":  # resolved by the admin's routing rules (config/routing)
        res = routing.resolve_auto(user_text)
        want, auto_note = res.group, f"auto：{res.reason}"
    cap = agent.routing.max_cost_tier
    if want in COST_TIER and COST_TIER[want] > COST_TIER[cap]:
        return cap, (f"{auto_note}；" if auto_note else "") + f"{want} 超過成本上限，改用 {cap}"
    return want, auto_note


def _default_flow() -> Flow:
    """An agent with an empty canvas behaves as a single-LLM chat: input -> llm -> output."""
    return Flow.model_validate({
        "nodes": [
            {"id": "in", "type": "input", "data": {}},
            {"id": "llm", "type": "llm", "data": {"prompt": "{{input}}"}},
            {"id": "out", "type": "output", "data": {"template": "{{last}}"}},
        ],
        "edges": [{"id": "e1", "source": "in", "target": "llm"}, {"id": "e2", "source": "llm", "target": "out"}],
    })


def validate_flow(flow: Flow) -> list[str]:
    """Static checks surfaced in the studio banner. Empty list == valid."""
    problems: list[str] = []
    if not flow.nodes:
        return problems  # empty canvas falls back to the default chat flow
    ids = {n.id for n in flow.nodes}
    inputs = [n for n in flow.nodes if n.type == "input"]
    if len(inputs) != 1:
        problems.append("需要恰好一個「輸入」節點")
    if not any(n.type == "output" for n in flow.nodes):
        problems.append("缺少「回覆」節點")
    for e in flow.edges:
        if e.source not in ids or e.target not in ids:
            problems.append(f"連線 {e.id} 指向不存在的節點")
    linked = {e.source for e in flow.edges} | {e.target for e in flow.edges}
    for n in flow.nodes:
        if n.id not in linked and len(flow.nodes) > 1:
            problems.append(f"節點「{n.data.get('label') or n.id}」未連線")
    for n in flow.nodes:
        if n.type == "condition":
            handles = {e.sourceHandle for e in flow.edges if e.source == n.id}
            if not {"true", "false"} <= handles:
                problems.append(f"條件節點「{n.data.get('label') or n.id}」需要 true 與 false 兩條分支")
        if n.type == "structured_output":
            try:
                json.loads(str(n.data.get("schema") or "{}"))
            except json.JSONDecodeError:
                problems.append(f"結構化輸出節點「{n.data.get('label') or n.id}」的 JSON schema 不合法")
    return problems


def invoke_connector(connector_id: str, action: str, args: dict, *, agent_id: str, user_id: str) -> tuple[str, str]:
    """Load the shared connector, pull its secrets, run the action. Returns (result_text, trace_summary)."""
    from .. import db
    from . import connectors, secrets

    snap = db.client().collection("connectors").document(connector_id).get()
    if not snap.exists:
        return f"[連接器 {connector_id} 不存在]", "連接器不存在"
    data = snap.to_dict() or {}
    try:
        secret_values = {k: secrets.get(name) for k, name in (data.get("secrets") or {}).items()}
        result = connectors.invoke(data["type"], data.get("config") or {}, secret_values, action, args,
                                   redact_pii=bool(data.get("redact_pii", True)), user_id=user_id, connector_id=connector_id)
        ok, err = True, ""
    except Exception as exc:  # noqa: BLE001 - any driver/network failure becomes a visible step result
        result, ok, err = f"[連接器錯誤] {exc.__class__.__name__}: {exc}"[:1000], False, str(exc)[:300]
    # `connector_action`, not `action`: audit() already has a parameter called action.
    db.audit(user_id, "connector.invoke", agent_id=agent_id, connector_id=connector_id, type=data.get("type"),
             connector_action=action, ok=ok, error=err, **({"args": args} if data.get("audit_payloads", True) else {}))
    return result, f"{data.get('label', data.get('type'))} · {action} · {'成功' if ok else '失敗'}"


def _complete(agent: AgentIn, agent_id: str, user_id: str, group: str, **kw) -> llm.Completion:
    """LLM call + usage ledger. Failures are recorded (ok=false) and re-raised so the run still errors."""
    try:
        c = llm.complete(group=group, agent_id=agent_id, user_id=user_id, **kw)
    except Exception:
        usage.record(agent=agent, agent_id=agent_id, user_id=user_id, group=group, model=group, prompt_tokens=0,
                     completion_tokens=0, cost_usd=0.0, ms=0, ok=False, fallback=False)
        raise
    usage.record(agent=agent, agent_id=agent_id, user_id=user_id, group=group, model=c.model,
                 prompt_tokens=c.prompt_tokens, completion_tokens=c.completion_tokens, cost_usd=c.cost_usd, ms=c.ms,
                 ok=True, fallback=llm.is_fallback(group, c.model))
    return c


def _grounding_block(chunks: list[dict]) -> str:
    return "\n\n".join(f"[{i + 1}] 來源：{c['source']}\n{c['text']}" for i, c in enumerate(chunks))


def run_flow(agent: AgentIn, *, agent_id: str, user_id: str, user_message: str,
             history: list[dict], rag_files: list[str] | None = None, resume: dict | None = None,
             skill_prefix: str = "", extra_context: str = "") -> RunResult:
    """Walk the flow. `resume` = the `pending` dict a previous run returned at an approval node
    ({node_id, ctx, grounding}); execution continues from the edge after that node with the saved ctx.
    `skill_prefix` (enabled, viewable skill instructions, see engine/skills.py) is prepended to the system prompt of
    llm / structured_output steps; `extra_context` (de-identified chat attachments) is appended to it."""
    flow = agent.flow if agent.flow.nodes else _default_flow()
    nodes = {n.id: n for n in flow.nodes}
    out_edges: dict[str, list] = {}
    for e in flow.edges:
        out_edges.setdefault(e.source, []).append(e)

    start = next((n for n in flow.nodes if n.type == "input"), None)
    if start is None:
        raise ValueError("flow has no input node")

    ctx: dict[str, str] = {"input": user_message, "last": user_message}
    res = RunResult(reply="", trace=[])
    base_system = agent.instructions or f"You are {agent.name}. {agent.description}".strip()
    if extra_context:
        base_system = f"{base_system}\n\n{extra_context}"
    grounding: list[dict] = []  # chunks retrieved so far (appended to system prompt if unreferenced)
    s = settings()
    if resume:
        approved = nodes.get(str(resume.get("node_id")))
        if approved is None:
            raise ValueError("approval node no longer exists in this flow")
        ctx = {**ctx, **{k: str(v) for k, v in (resume.get("ctx") or {}).items()}}
        grounding = list(resume.get("grounding") or [])
        res.trace.append(StepTrace(node_id=approved.id, type="approval", summary="已由 Agent 負責人核准，繼續執行"))
        nxt = out_edges.get(approved.id, [])
        start = nodes.get(nxt[0].target) if nxt else None
        if start is None:  # approval was the last node: nothing left to do
            res.reply = ctx["last"]
            return res

    def tick() -> float:
        return time.perf_counter()

    def ms(t0: float) -> int:
        return int((tick() - t0) * 1000)

    node: FlowNode | None = start
    steps = 0
    while node is not None and steps < MAX_STEPS:
        steps += 1
        nxt_handle: str | None = None
        t0 = tick()

        if node.type == "input":
            res.trace.append(StepTrace(node_id=node.id, type="input", summary="收到使用者輸入"))

        elif node.type == "his_emr":
            # Stub: the FHIR / HIS gateway is not connected (design-notes v0.3, PHI stays on-prem).
            q = _render(str(node.data.get("query") or "{{input}}"), ctx)
            result = f"[HIS/EMR 尚未串接] 查詢條件：{q}"
            ctx[node.id] = ctx["last"] = result
            res.trace.append(StepTrace(node_id=node.id, type="his_emr", summary="HIS/EMR 閘道未啟用（stub）", ms=ms(t0)))

        elif node.type == "pii_mask":  # deprecated: de-identification is a platform guarantee, not a node
            ctx[node.id] = ctx["last"]
            res.trace.append(StepTrace(node_id=node.id, type="pii_mask", summary="已停用：平台已自動去識別化（可刪除此節點）", ms=ms(t0)))

        elif node.type == "knowledge":
            if not rag_files:
                ctx[node.id] = ""
                res.trace.append(StepTrace(node_id=node.id, type="knowledge", summary="此 Agent 尚未掛載知識文件", ms=ms(t0)))
            else:
                from . import rag  # lazy: only agents with knowledge pay the import cost

                query = _render(str(node.data.get("query") or "{{input}}"), ctx)
                top_k = s.rag_top_k  # platform-wide; the builder no longer offers a per-node top_k (old values ignored)
                chunks = rag.retrieve(rag.hospital_corpus(), rag_files, query, top_k=top_k)
                # Safety net: files indexed before upload de-id (or with it off) may still hold PHI.
                for c, masked in zip(chunks, deid.deidentify_many([c["text"] for c in chunks]), strict=True):
                    c["text"] = masked
                grounding.extend(chunks)
                ctx[node.id] = _grounding_block(chunks)
                seen: set[tuple[str, str]] = set()
                for c in chunks:
                    key = (c["source"], c["text"][:80])
                    if key not in seen:
                        seen.add(key)
                        res.citations.append(Citation(source=c["source"], uri=c["uri"], score=c["score"], text=c["text"][:300]))
                res.trace.append(StepTrace(node_id=node.id, type="knowledge",
                                           summary=f"檢索 {len(chunks)} 段落（top_k={top_k}），已去識別化", ms=ms(t0)))

        elif node.type in ("llm", "structured_output"):
            structured = node.type == "structured_output"
            prompt_tpl = str(node.data.get("prompt") or "{{input}}")
            prompt = _render(prompt_tpl, ctx)
            system = f"{skill_prefix}\n\n{base_system}" if skill_prefix else base_system
            # Ground the call if the prompt did not already pull the chunks in by variable.
            refs = set(_VAR.findall(prompt_tpl))
            if grounding and not any(nodes.get(r) and nodes[r].type == "knowledge" for r in refs):
                system = f"{system}\n\n以下為院內知識庫檢索結果，回答時請引用來源編號：\n{_grounding_block(grounding)}"
            if structured:
                schema = str(node.data.get("schema") or "{}")
                system = f"{system}\n\n只輸出符合下列 JSON Schema 的 JSON 物件，不要加任何說明文字：\n{schema}"
            group, note = pick_group(agent, node, ctx["input"])
            c = _complete(agent, agent_id, user_id, group, system=system,
                          messages=[*history, {"role": "user", "content": prompt}],
                          json_mode=structured)  # platform temperature (llm.complete default); no top_p: each model's default
            reply = c.text
            if structured:
                try:
                    res.structured = json.loads(reply)
                    reply = json.dumps(res.structured, ensure_ascii=False, indent=2)
                except json.JSONDecodeError:
                    res.trace.append(StepTrace(node_id=node.id, type="structured_output", summary="模型輸出非合法 JSON，原文通過"))
            ctx[node.id] = ctx["last"] = reply
            res.trace.append(StepTrace(node_id=node.id, type=node.type, model=c.model, group=group,
                                       summary=f"{len(reply)} 字" + (f"（{note}）" if note else ""),
                                       ms=ms(t0), prompt_tokens=c.prompt_tokens, completion_tokens=c.completion_tokens,
                                       cost_usd=c.cost_usd))

        elif node.type == "condition":
            question = _render(str(node.data.get("question") or "Is the request urgent?"), ctx)
            # Same routing as llm steps (it used to be hard-wired to "fast", bypassing sovereign_only).
            group, note = pick_group(agent, node, ctx["input"])
            c = _complete(agent, agent_id, user_id, group, system="Answer strictly YES or NO.",
                          messages=[{"role": "user", "content": f"{question}\n\nContext:\n{ctx['last']}"}], temperature=0)
            nxt_handle = "true" if c.text.strip().upper().startswith("Y") else "false"
            res.trace.append(StepTrace(node_id=node.id, type="condition", model=c.model, group=group,
                                       summary=f"{question} -> {nxt_handle}" + (f"（{note}）" if note else ""), ms=ms(t0), prompt_tokens=c.prompt_tokens,
                                       completion_tokens=c.completion_tokens, cost_usd=c.cost_usd))

        elif node.type == "tool":
            cid, action = str(node.data.get("connector_id") or ""), str(node.data.get("action") or "")
            if not cid or not action:
                result = "[工具節點未設定連接器或動作]"
                res.trace.append(StepTrace(node_id=node.id, type="tool", summary="未設定連接器（略過）", ms=ms(t0)))
            else:
                raw_args = node.data.get("args") or {}
                if isinstance(raw_args, str):
                    try:
                        raw_args = json.loads(raw_args) if raw_args.strip() else {}
                    except json.JSONDecodeError:
                        raw_args = {"payload": raw_args}
                args = {k: _render(str(v), ctx) if isinstance(v, str) else v for k, v in raw_args.items()}
                result, summary = invoke_connector(cid, action, args, agent_id=agent_id, user_id=user_id)
                res.trace.append(StepTrace(node_id=node.id, type="tool", summary=summary, ms=ms(t0)))
            ctx[node.id] = ctx["last"] = result

        elif node.type == "approval":
            # ctx + grounding ride along so the router can persist them and resume after approval.
            res.pending = {"node_id": node.id, "message": _render(str(node.data.get("message") or "Approve this action?"), ctx),
                           "preview": ctx["last"], "ctx": dict(ctx), "grounding": grounding}
            res.trace.append(StepTrace(node_id=node.id, type="approval", summary="等待人工核准"))
            res.reply = ctx["last"]
            return res

        elif node.type == "output":
            res.reply = _render(str(node.data.get("template") or "{{last}}"), ctx)
            res.trace.append(StepTrace(node_id=node.id, type="output", summary="回覆組裝完成"))
            return res

        edges = out_edges.get(node.id, [])
        if nxt_handle is not None:
            edges = [e for e in edges if (e.sourceHandle or "true") == nxt_handle] or edges
        node = nodes.get(edges[0].target) if edges else None

    res.reply = ctx["last"]
    return res
