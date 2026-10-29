"""Build an agent by conversation (PRD §4.1): the creator describes a goal, a model drafts the agent (name, instructions,
capabilities, steps); each further message edits that draft. Only the creator's own request and the draft go to the model;
the list of connectors / spaces offered is limited to what the creator may use."""
from __future__ import annotations

import json
import re

from ..schemas import AgentIn, Capabilities, Step
from . import deid, flow, llm, steps as step_engine, usage

_BUILDER = AgentIn(name="Agent 建立助手")
SYSTEM_FLOW = """你是 Medisense 的 Agent 建立助手。使用者用自然語言描述想要的 AI 助理或自動化流程，你負責產生或修改 Agent 設定。
只輸出一個 JSON 物件：{"reply": "給使用者看的簡短說明（繁體中文，說明你做了什麼、還缺什麼）", "agent": {...完整的 Agent 設定...}}

agent 欄位：
- name（50 字內）、description（300 字內）、instructions（角色指令：目標、語氣、工作方式、禁止事項）、icon（一個 emoji）、
  opening_questions（最多 4 個範例問題，可為空陣列）
- capabilities：{"web_search": bool, "spaces": [知識空間 id], "connectors": [{"connector_id","action","require_approval"}], "model_pref": "fast"|"balanced"|"quality", "thinking": "off"|"low"|"medium"|"high"}
  只開啟需要的能力。spaces 與 connectors 只能使用下方「可用資源」列出的 id，不可自己編造。
- steps：流程步驟陣列。沒有固定流程（純問答）就給空陣列。每個 step：{"id": "s1","type": ...,"title": "唯一標題","description": "","enabled": true,"on_error": "stop"|"retry"|"skip","config": {...}}
  可用類型與 config：
  text_input {"placeholder","default","allow_override"}；file_upload {}；
  llm_generate {"prompt","creativity"(0-1)}；web_search {"prompt"}；knowledge_query {"prompt"}；
  action {"connector_id","action","prompt","require_approval"}（寫入類動作預設 true）
  提示詞中引用前面步驟的輸出，寫成 {{step_id}}（只能引用前面的步驟）。不要使用其他類型。
規則：使用者的需求不需要流程時 steps 留空；每個 step 的 title 不可重複；不要輸出 JSON 以外的文字；修改時保留使用者沒提到要改的部分。
不得在 instructions 或步驟中放入任何個人識別資訊。"""


SYSTEM_AGENT = """你是 Medisense 的 Agent 建立助手。使用者描述想要的「聊天代理程式」（有固定角色的對話助理），你負責產生或修改它的設定。
只輸出一個 JSON 物件：{"reply": "給使用者看的簡短說明（繁體中文，說明你做了什麼、還缺什麼）", "agent": {...}}
agent 欄位：name（50 字內）、description（300 字內，一兩句介紹，會顯示在對話起始畫面）、instructions（角色指令：這個助理的身分、語氣、工作方式、一步一步怎麼引導使用者、禁止事項，寫得具體完整）、
icon（一個 emoji）、opening_questions（最多 4 個範例問題）、
capabilities：{"web_search": bool, "spaces": [知識空間 id], "connectors": [{"connector_id","action","require_approval"}], "model_pref": "fast"|"balanced"|"quality", "thinking": "off"|"low"|"medium"|"high"}
只開啟需要的能力；spaces 與 connectors 只能使用下方「可用資源」列出的 id，不可編造。steps 一律輸出空陣列（這不是流程）。
修改時保留使用者沒提到要改的部分；不要輸出 JSON 以外的文字；不得放入任何個人識別資訊。"""


def _resources(connector_rows: list[dict], space_rows: list[dict]) -> str:
    cons = [f'- {c["id"]}｜{c["label"]}｜動作：' + "、".join(f'{a["id"]}({a["label"]})' for a in c["actions"]) for c in connector_rows]
    sps = [f'- {s["id"]}｜{s["name"]}' for s in space_rows]
    return "可用資源\n連接器：\n" + ("\n".join(cons) or "（無）") + "\n知識空間：\n" + ("\n".join(sps) or "（無）")


def _json(text: str) -> dict:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    return json.loads(t)


def clean_agent(raw: dict, allowed_connectors: set[str], allowed_spaces: set[str]) -> dict:
    """Keep only fields the platform understands, drop ids the model invented, and make sure the steps parse."""
    out = {k: raw[k] for k in ("name", "description", "instructions", "icon", "opening_questions") if k in raw}
    out["name"] = str(out.get("name") or "新 Agent")[:50]
    out["description"] = str(out.get("description") or "")[:300]
    out["instructions"] = str(out.get("instructions") or "")[:8000]
    out["icon"] = str(out.get("icon") or "")[:8]
    oq = out.get("opening_questions") or []
    out["opening_questions"] = [str(q)[:120] for q in oq if isinstance(oq, list) and str(q).strip()][:4]
    cap = raw.get("capabilities") or {}
    cap["spaces"] = [s for s in (cap.get("spaces") or []) if s in allowed_spaces]
    cap["connectors"] = [c for c in (cap.get("connectors") or []) if isinstance(c, dict) and c.get("connector_id") in allowed_connectors]
    out["capabilities"] = Capabilities.model_validate({k: v for k, v in cap.items() if k in Capabilities.model_fields}).model_dump()
    steps = []
    for i, s in enumerate(raw.get("steps") or []):
        if not isinstance(s, dict) or s.get("type") not in step_engine.SUPPORTED:
            continue
        s = {**s, "id": re.sub(r"[^A-Za-z0-9_-]", "", str(s.get("id") or f"s{i + 1}")) or f"s{i + 1}"}
        if s["type"] == "action" and (s.get("config") or {}).get("connector_id") not in allowed_connectors:
            continue
        try:
            steps.append(Step.model_validate(s).model_dump())
        except Exception:  # noqa: BLE001 - one malformed step must not lose the rest of the draft
            continue
    out["steps"] = steps
    return out


def draft(message: str, *, current: dict | None, history: list[dict], connector_rows: list[dict], space_rows: list[dict], user_id: str, kind: str = "flow") -> dict:
    """-> {reply, agent, problems}. Raises ValueError when the model's answer cannot be used."""
    safe = deid.deidentify(message)
    ctx = _resources(connector_rows, space_rows)
    cur = json.dumps(current, ensure_ascii=False) if current else "（尚未建立，請從頭產生）"
    msgs = [*[{"role": h["role"], "content": h["content"]} for h in history[-8:] if h.get("role") in ("user", "assistant")],
            {"role": "user", "content": f"{ctx}\n\n目前的 Agent 設定：\n{cur}\n\n使用者說：{safe}"}]
    try:
        c = llm.complete(group="fast", system=SYSTEM_AGENT if kind == "agent" else SYSTEM_FLOW, messages=msgs, agent_id="agent-builder", user_id=user_id, temperature=0.4, json_mode=True)
    except Exception:
        usage.record(agent=_BUILDER, agent_id="agent-builder", user_id=user_id, group="fast", model="fast", prompt_tokens=0, completion_tokens=0,
                     cost_usd=0.0, ms=0, ok=False, fallback=False)
        raise
    usage.record(agent=_BUILDER, agent_id="agent-builder", user_id=user_id, group="fast", model=c.model, prompt_tokens=c.prompt_tokens,
                 completion_tokens=c.completion_tokens, cost_usd=c.cost_usd, ms=c.ms, ok=True, fallback=False)
    try:
        data = _json(c.text)
        agent = clean_agent(data["agent"], {x["id"] for x in connector_rows}, {x["id"] for x in space_rows})
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError("無法解析模型產生的 Agent 設定") from exc
    problems = step_engine.validate_steps([Step.model_validate(s) for s in agent["steps"]])
    return {"reply": str(data.get("reply") or "已更新設定。")[:1000], "agent": agent, "problems": problems}


IMPROVE_SYSTEM = ("你是提示詞編輯。把使用者給的「聊天代理程式角色指令」改寫得更清楚、完整、可執行：明確身分與目標、語氣、逐步的工作方式、需要時一次只問一個問題、輸出格式、禁止事項。"
                  "保留原本的意圖與語言（繁體中文就維持繁體中文），不要加入個人識別資訊。只輸出改寫後的指令本文，不要任何說明、標題或程式碼框。")


def improve(instructions: str, *, name: str, description: str, user_id: str) -> str:
    safe = deid.deidentify(instructions)
    c = llm.complete(group="fast", system=IMPROVE_SYSTEM, agent_id="agent-builder", user_id=user_id, temperature=0.4,
                     messages=[{"role": "user", "content": f"Agent 名稱：{name}\n說明：{description}\n\n目前的角色指令：\n{safe}"}])
    usage.record(agent=_BUILDER, agent_id="agent-builder", user_id=user_id, group="fast", model=c.model, prompt_tokens=c.prompt_tokens,
                 completion_tokens=c.completion_tokens, cost_usd=c.cost_usd, ms=c.ms, ok=True, fallback=False)
    return re.sub(r"^```\w*\s*|\s*```$", "", c.text.strip())[:8000]
