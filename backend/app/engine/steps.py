"""Step flows (PRD §5-§7): validation here, execution further down (run_steps).

References: a prompt may contain {{step_id}} or {{step_id.field}}; it resolves to the output of an EARLIER, enabled step."""
from __future__ import annotations

import re
from typing import Any

from ..schemas import Step

REF = re.compile(r"{{\s*([A-Za-z0-9_-]+)(?:\.([\w.-]+))?\s*}}")
SUPPORTED = ("text_input", "file_upload", "llm_generate", "web_search", "knowledge_query", "action")  # phase 1
LATER = {"research": "深度研究", "agent_call": "呼叫 Agent", "browser_agent": "UI Agent", "image_generate": "產生圖片",
         "data_insight": "儀表板／資料主題", "reasoning_group": "Reasoning Group"}
PROMPT_TYPES = ("llm_generate", "web_search", "knowledge_query", "action")
MAX_STEPS_WARN = 30


def flatten(steps: list[Step]) -> list[Step]:
    out: list[Step] = []
    for s in steps:
        out.append(s)
        out.extend(flatten(s.children))
    return out


def _strings(v: Any):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)


def refs_of(step: Step) -> list[str]:
    return [m.group(1) for t in _strings(step.config) for m in REF.finditer(t)]


def validate_steps(steps: list[Step], *, publishing: bool = False) -> list[dict]:
    """[{level: error|warning, step_id, message}]. Errors block publishing; warnings never do."""
    out: list[dict] = []
    add = lambda level, sid, msg: out.append({"level": level, "step_id": sid, "message": msg})  # noqa: E731
    flat = flatten(steps)
    seen_titles: dict[str, str] = {}
    before: dict[str, bool] = {}  # id -> enabled, for steps already walked
    for st in flat:
        t = st.title.strip()
        if t.lower() in seen_titles:
            add("error", st.id, f"Step 標題「{t}」重複")
        seen_titles[t.lower()] = st.id
        if st.type in LATER:
            add("error", st.id, f"「{LATER[st.type]}」Step 尚未開放")
        if st.children:
            add("error", st.id, "目前不支援群組內的子 Step")
        c = st.config
        need = {"llm_generate": ["prompt"], "web_search": ["prompt"], "knowledge_query": ["prompt"],
                "action": ["connector_id", "action", "prompt"]}.get(st.type, [])
        for k in need:
            if not str(c.get(k) or "").strip():
                add("error", st.id, f"「{t}」尚未填寫{ {'prompt': '提示詞', 'connector_id': '連接器', 'action': '動作'}[k] }")
        for r in refs_of(st):
            if r == st.id or r not in before and r in {x.id for x in flat}:
                add("error", st.id, f"「{t}」引用了後面或自己的 Step")
            elif r not in before:
                add("error", st.id, f"「{t}」引用了不存在的 Step")
            elif not before[r]:
                add("warning", st.id, f"「{t}」引用了已停用的 Step")
        before[st.id] = st.enabled
    ids = [s.id for s in flat]
    if len(ids) != len(set(ids)):
        add("error", "", "Step ID 重複")
    if len(flat) > MAX_STEPS_WARN:
        add("warning", "", f"Step 數量超過 {MAX_STEPS_WARN}")
    return out


def has_errors(problems: list[dict]) -> bool:
    return any(p["level"] == "error" for p in problems)


# ---------------------------------------------------------------- execution (PRD §7) -----------------------------------
import json  # noqa: E402
import logging  # noqa: E402
import time  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

from ..schemas import AgentIn, FlowNode  # noqa: E402
from . import deid, features, flow, llm  # noqa: E402

log = logging.getLogger(__name__)
MAX_OUT = 100_000  # PRD §7.4: a step output above 100 KB is cut
RETRIES = 2
PREF_GROUP = {"fast": "fast", "balanced": "auto", "quality": "reasoning"}
STEP_SYSTEM = {
    "llm_generate": "你是流程中的一個步驟。只依「提示詞」完成任務並輸出結果，不要寒暄，不要重述提示詞。",
    "web_search": "你是流程中的網路搜尋步驟。請搜尋並整理成摘要，並保留來源。",
    "knowledge_query": "你是流程中的院內知識查詢步驟。只根據提供的資料片段回答，並以 [1]、[2] 標註引用；資料不足就明說。",
    "action": "你是流程中的動作步驟，負責把提示詞轉成連接器動作的參數。只輸出 JSON 物件。",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def render(text: str, ctx: dict[str, str]) -> str:
    """{{id}} -> that step's output; {{id.field}} -> a field of its JSON output. Unknown / empty -> （無資料）."""
    def one(m):
        out = ctx.get(m.group(1), "")
        if m.group(2) and out:
            try:
                v = json.loads(out)
                for part in m.group(2).split("."):
                    v = v[part] if isinstance(v, dict) else v[int(part)]
                return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
            except (ValueError, KeyError, IndexError, TypeError):
                return "（無資料）"
        return out or "（無資料）"
    return REF.sub(one, text or "")


def _render_config(config: Any, ctx: dict[str, str]) -> Any:
    if isinstance(config, str):
        return render(config, ctx)
    if isinstance(config, dict):
        return {k: _render_config(v, ctx) for k, v in config.items()}
    if isinstance(config, list):
        return [_render_config(v, ctx) for v in config]
    return config


def _clip(s: str) -> str:
    return s if len(s) <= MAX_OUT else s[:MAX_OUT] + "\n…（輸出過長已截斷）"


def _group(agent: AgentIn, step: Step, text: str) -> tuple[str, str]:
    node = FlowNode(id=step.id, type="llm", data={"group": PREF_GROUP[agent.capabilities.model_pref]})
    return flow.pick_group(agent, node, text)


def _think(agent: AgentIn, group: str):
    t = agent.capabilities.thinking
    return None if t == "off" else (t if t != "low" or flow.THINK.get(group) else None)


def _system(agent: AgentIn, kind: str) -> str:
    base = agent.instructions or f"你是 {agent.name}。{agent.description}".strip()
    return f"{base}\n\n{STEP_SYSTEM[kind]}\n{flow_lang()}"


def flow_lang() -> str:
    from .agent import LANG_GUIDE
    return LANG_GUIDE  # not FORMAT_GUIDE: its ~~~document blocks are for the chat view, a step output is plain text for the next step


class StepFailed(Exception):
    pass


class NeedsApproval(Exception):
    def __init__(self, payload: dict):
        self.payload = payload


def _do_step(st: Step, cfg: dict, ctx: dict[str, str], *, agent: AgentIn, agent_id: str, user, inputs: dict, rag_files: list[str],
             approved: dict | None) -> tuple[str, list[dict], str]:
    """-> (output, sources, resolved input shown in the run view)."""
    if st.type == "text_input":
        v = str(inputs.get(st.id, "") or "").strip()
        if not v or cfg.get("allow_override") is False:
            v = str(cfg.get("default") or "").strip() or v
        if not v and cfg.get("required", True):
            raise StepFailed(f"請填寫「{st.title}」")
        return deid.deidentify(v) if v else "", [], v and "（使用者輸入，已去識別化）"
    if st.type == "file_upload":
        fid = str(inputs.get(st.id, "") or "")
        if not fid:
            if cfg.get("required", True):
                raise StepFailed(f"請上傳「{st.title}」的檔案")
            return "", [], ""
        from .. import db
        snap = db.client().collection("run_files").document(fid).get()
        d = snap.to_dict() if snap.exists else None
        if not d or d.get("uid") != user.uid:
            raise StepFailed("找不到上傳的檔案，請重新上傳")
        return _clip(d.get("text", "")), [{"title": d.get("name", ""), "url": ""}], f"檔案：{d.get('name', '')}（{d.get('chars', 0)} 字，已去識別化）"
    prompt = str(cfg.get("prompt") or "")
    if st.type == "llm_generate":
        group, _note = _group(agent, st, prompt)
        kw = {"system": _system(agent, "llm_generate"), "messages": [{"role": "user", "content": prompt}],
              "temperature": float(cfg.get("creativity", 0.3)), "think": _think(agent, group)}
        c = flow._complete(agent, agent_id, user.uid, group, **kw)
        return _clip(c.text), [], prompt
    if st.type == "web_search":
        if not features.web_search_enabled():
            raise StepFailed("管理員尚未開放網路搜尋")
        group, _ = _group(agent, st, prompt)
        c = flow._complete(agent, agent_id, user.uid, group, system=_system(agent, "web_search"),
                           messages=[{"role": "user", "content": deid.deidentify(prompt)}], search=True)
        return _clip(c.text), [{"title": s.get("title", ""), "url": s.get("url", "")} for s in c.sources], prompt
    if st.type == "knowledge_query":
        from . import rag
        if not rag_files:
            return "（此 Agent 沒有設定知識來源）", [], prompt
        chunks = rag.retrieve(rag.hospital_corpus(), rag_files, prompt, top_k=5)
        texts = deid.deidentify_many([c["text"] for c in chunks])
        if not chunks:
            return "（在你有權限的知識來源中找不到相關內容）", [], prompt
        srcs = [{"title": c["source"], "url": ""} for c in chunks]
        body = "\n\n".join(f"[{i + 1}] ({c['source']})\n{t}" for i, (c, t) in enumerate(zip(chunks, texts, strict=True)))
        group, _ = _group(agent, st, prompt)
        c = flow._complete(agent, agent_id, user.uid, group, system=_system(agent, "knowledge_query"),
                           messages=[{"role": "user", "content": f"問題：{prompt}\n\n資料片段：\n{body}"}])
        return _clip(c.text), srcs, prompt
    if st.type == "action":
        return _do_action(st, cfg, prompt, agent=agent, agent_id=agent_id, user=user, approved=approved)
    raise StepFailed(f"「{st.type}」Step 尚未開放")


def _do_action(st: Step, cfg: dict, prompt: str, *, agent: AgentIn, agent_id: str, user, approved: dict | None):
    from . import connectors
    from .. import db
    cid, action = str(cfg.get("connector_id") or ""), str(cfg.get("action") or "")
    snap = db.client().collection("connectors").document(cid).get()
    if not snap.exists:
        raise StepFailed("連接器不存在")
    ctype = (snap.to_dict() or {}).get("type", "")
    acts = connectors.TYPES.get(ctype, {}).get("actions")
    act = next((a for a in acts if a["id"] == action), None) if isinstance(acts, list) else None
    if approved is not None:
        args = approved["args"]
    else:
        keys = [a["key"] for a in (act or {}).get("args", [])]
        group, _ = _group(agent, st, prompt)
        ask = (f"依下列說明產生連接器動作「{(act or {}).get('label') or action}」的參數，輸出 JSON 物件，鍵為 {keys}。\n說明：{prompt}"
               if keys else f"依下列說明產生動作參數，輸出 JSON 物件。\n說明：{prompt}")
        c = flow._complete(agent, agent_id, user.uid, group, system=_system(agent, "action"),
                           messages=[{"role": "user", "content": ask}], json_mode=True)
        try:
            args = json.loads(c.text)
            assert isinstance(args, dict)
        except (ValueError, AssertionError):
            raise StepFailed("無法產生有效的動作參數") from None
        write = bool((act or {}).get("write", True))
        if cfg.get("require_approval", write):
            raise NeedsApproval({"connector_id": cid, "action": action, "args": args, "label": (act or {}).get("label") or action})
    result, summary = flow.invoke_connector(cid, action, args, agent_id=agent_id, user_id=user.uid)
    return _clip(result), [], f"{summary}\n參數：{json.dumps(args, ensure_ascii=False)}"


def run_steps(agent: AgentIn, *, agent_id: str, user, run: dict, rag_files: list[str], save=lambda r: None, approved: dict | None = None) -> dict:
    """Run (or resume) `run` over the agent's enabled steps. `run` = {steps: [StepRun...], inputs, status, ...} and is saved after every
    step. Statuses per PRD §7.2. A step needing approval pauses the run (status waiting_approval, run['pending'])."""
    todo = [s for s in flatten(agent.steps)]
    runs_by_id = {r["step_id"]: r for r in run["steps"]}
    ctx = {r["step_id"]: r.get("output", "") for r in run["steps"] if r["status"] == "succeeded"}
    run["status"] = "running"
    for st in todo:
        rec = runs_by_id.get(st.id)
        if rec and rec["status"] in ("succeeded", "skipped"):
            continue
        rec = rec or {"step_id": st.id, "title": st.title, "type": st.type, "status": "pending", "input": "", "output": "", "sources": [], "error": "", "duration_ms": 0}
        if rec["step_id"] not in runs_by_id:
            run["steps"].append(rec)
            runs_by_id[st.id] = rec
        if not st.enabled:
            rec["status"] = "skipped"
            save(run)
            continue
        rec["status"] = "running"
        save(run)
        cfg = _render_config(st.config, ctx)
        t0 = time.perf_counter()
        attempts = RETRIES + 1 if st.on_error == "retry" else 1
        for attempt in range(attempts):
            try:
                out, srcs, shown = _do_step(st, cfg, ctx, agent=agent, agent_id=agent_id, user=user, inputs=run.get("inputs") or {},
                                            rag_files=rag_files, approved=approved if run.get("pending", {}).get("step_id") == st.id else None)
                rec.update(status="succeeded", output=out, sources=srcs, input=shown, error="")
                ctx[st.id] = out
                break
            except NeedsApproval as na:
                rec.update(status="waiting_approval", input=json.dumps(na.payload["args"], ensure_ascii=False))
                run.update(status="waiting_approval", pending={"step_id": st.id, **na.payload})
                rec["duration_ms"] += int((time.perf_counter() - t0) * 1000)
                save(run)
                return run
            except Exception as exc:  # noqa: BLE001 - a failing step is a visible result, not a crash
                rec.update(status="failed", error=str(exc)[:500] or exc.__class__.__name__)
                log.warning("step %s failed (attempt %d): %s", st.id, attempt + 1, exc)
                if attempt + 1 < attempts:
                    time.sleep(min(2 ** attempt, 4))
        rec["duration_ms"] += int((time.perf_counter() - t0) * 1000)
        if rec["status"] == "failed":
            if st.on_error == "skip":
                rec["status"] = "skipped"
                ctx[st.id] = ""
            else:
                run.update(status="failed", error=f"「{st.title}」失敗：{rec['error']}", pending=None)
                save(run)
                return run
        run.pop("pending", None)
        approved = None
        save(run)
    last = next((r for r in reversed(run["steps"]) if r["status"] == "succeeded" and r["type"] not in ("text_input", "file_upload")), None)
    run.update(status="succeeded", result=(last or {}).get("output", ""), pending=None)
    save(run)
    return run
