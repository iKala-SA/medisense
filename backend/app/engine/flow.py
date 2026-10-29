"""Flow helpers shared by the agent runtime (engine/agent.py): model-group routing, canvas validation and connector calls.

The canvas used to be walked node by node here. It now only declares what an agent MAY do (tools, approval, output
shape) and the model decides what to do; see engine/agent.py. What stays here:

  pick_group        which model group answers: sovereign_only > the llm node's group > the user's reasoning keywords >
                    the agent default, "auto" resolved by the admin routing rules, all capped by max_cost_tier
  validate_flow     the studio banner's structural checks
  invoke_connector  run one connector action with its secrets (used by tool calls)
"""
from __future__ import annotations

import json
import logging
import re
import time

from ..config import settings
from ..schemas import AgentIn, Flow, FlowNode
from . import deid, llm, routing, usage

log = logging.getLogger(__name__)
MAX_STEPS = 40
_VAR = re.compile(r"{{\s*([\w\-]+)\s*}}")


def _render(template: str, ctx: dict[str, str]) -> str:
    return _VAR.sub(lambda m: ctx.get(m.group(1), ""), template)


THINK = {"fast": "low", "budget": "low", "reasoning": "medium", "sovereign": None}  # reasoning_effort asked per group
# sovereign is a data-residency choice, not a cost tier. smart-router may pick the reasoning tier's model, so an agent
# capped below reasoning gets its cap group instead.
COST_TIER = {"budget": 0, "fast": 1, "reasoning": 2, routing.SMART_ROUTER: 2}


def pick_group(agent: AgentIn, node: FlowNode, user_text: str) -> tuple[str, str]:
    """Model group for one llm / structured_output / condition step, plus a note for the trace.

    1. sovereign_only (the hospital-wide 僅本地模型 switch in config/routing, or the agent's own): every step
       on-prem, nothing overrides it, and there is no cloud fallback.
    2. the node's own group, else
    3. (agent/node group "auto" = smart-router when the gateway serves it, else fast; see engine/routing.py)
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
    if want == "auto":
        res = routing.resolve_auto()
        want, auto_note = res.group, f"auto：{res.reason}"
    cap = agent.routing.max_cost_tier
    if want in COST_TIER and COST_TIER[want] > COST_TIER[cap]:
        return cap, (f"{auto_note}；" if auto_note else "") + f"{want} 超過成本上限，改用 {cap}"
    return want, auto_note


def validate_flow(flow: Flow) -> list[str]:
    """Static checks surfaced in the studio banner. Empty list == valid."""
    problems: list[str] = []
    if not flow.nodes:
        return problems  # empty canvas falls back to the default chat flow
    ids = {n.id for n in flow.nodes}
    for e in flow.edges:
        if e.source not in ids or e.target not in ids:
            problems.append(f"連線 {e.id} 指向不存在的節點")
    linked = {e.source for e in flow.edges} | {e.target for e in flow.edges}
    for n in flow.nodes:
        if n.id not in linked and len(flow.nodes) > 1:
            problems.append(f"節點「{n.data.get('label') or n.id}」未連線")
    for n in flow.nodes:
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
    db.audit(user_id, "connector.invoke", agent_id=agent_id, connector_id=connector_id, type=data.get("type"), redacted=bool(data.get("redact_pii", True)),
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
