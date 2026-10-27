import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ShareDialog, { ShareChip } from "../../live/ShareLive";
import SkillsPanel from "../components/SkillsPanel";
import { api } from "../api";
import { CATEGORIES, DEPARTMENTS, MODEL_GROUPS, clampToCap, toAgentIn } from "../types";
import Canvas from "../components/Canvas";
import NodeInspector from "../components/NodeInspector";
import KnowledgePanel from "../components/KnowledgePanel";
import { ErrorBox, Field, Icon, Spinner, StatusPill } from "../components/ui";
import { currentUid } from "../mock";
import { describeGroup, useModelGroups } from "../modelGroups";
const estTokens = (s) => Math.ceil([...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 1.3 : 0.25), 0));
function Studio() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [agent, setAgent] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState(null);
  const [problems, setProblems] = useState([]);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const timer = useRef();
  useEffect(() => {
    if (!id) return;
    setAgent(null);
    setSelected(null);
    setDirty(false);
    api.getAgent(id).then(setAgent).catch((e) => setErr(String(e)));
  }, [id]);
  useEffect(() => {
    if (!agent) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => api.validate(agent.flow).then((r) => setProblems(r.problems)).catch(() => void 0), 500);
    return () => window.clearTimeout(timer.current);
  }, [agent?.flow, agent]);
  const patch = useCallback((p) => {
    setAgent((a) => a ? { ...a, ...p } : a);
    setDirty(true);
  }, []);
  const setFlow = useCallback((flow) => patch({ flow }), [patch]);
  const editable = !!agent && agent.owner_uid === currentUid();
  const save = async () => {
    if (!agent || !id) return null;
    setSaving(true);
    setErr("");
    try {
      const saved = await api.updateAgent(id, toAgentIn(agent));
      setAgent(saved);
      setDirty(false);
      setStatus(`\u4E0A\u6B21\u5132\u5B58\uFF1A${(/* @__PURE__ */ new Date()).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`);
      return saved;
    } catch (e) {
      setErr(String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };
  const toSandbox = async () => {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    nav(`/sandbox/${id}`);
  };
  const remove = async () => {
    if (!agent || !confirm(`\u522A\u9664\u300C${agent.name}\u300D\uFF1F\u6B64\u52D5\u4F5C\u6703\u4E00\u4F75\u522A\u9664\u77E5\u8B58\u5EAB\u5411\u91CF\u7D22\u5F15\uFF0C\u4E14\u7121\u6CD5\u5FA9\u539F\u3002`)) return;
    await api.deleteAgent(agent.id);
    nav("/hub");
  };
  const groups = useModelGroups();
  const effective = useCallback((pinned) => {
    if (!agent) return "fast";
    return agent.routing.sovereign_only ? "sovereign" : clampToCap(pinned || agent.model_group, agent.routing.max_cost_tier);
  }, [agent]);
  const stats = useMemo(() => {
    if (!agent) return null;
    const steps = agent.flow.nodes.filter((n) => n.type === "llm" || n.type === "structured_output" || n.type === "condition").map((n) => effective(n.data.group));
    const kb = agent.flow.nodes.filter((n) => n.type === "knowledge").length;
    const ms = 250 + steps.reduce((t, g) => t + (g === "reasoning" ? 2200 : 900), 0) + kb * 350;
    const usd = steps.reduce((t, g) => t + (g === "reasoning" ? 4e-3 : 6e-4), 0) + kb * 2e-4;
    return { nodes: agent.flow.nodes.length, edges: agent.flow.edges.length, ms, usd };
  }, [agent, effective]);
  if (!agent) return <div className="grid h-full place-items-center">{err ? <ErrorBox msg={err} /> : <Spinner />}</div>;
  const tokens = estTokens(agent.instructions);
  return <div className="flex h-full flex-col">
      <section className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline bg-white px-5 py-2.5">
        <nav className="flex items-center gap-1 text-sm text-on-surface-variant">
          <button className="flex items-center gap-1 hover:text-primary" onClick={() => loc.key !== "default" ? nav(-1) : nav("/hub")}><Icon name="hub" className="text-[16px]" />Agent Hub</button>
          <Icon name="chevron_right" className="text-[14px] text-outline-variant" />
          <span className="text-base font-bold text-on-surface">{agent.name}</span>
        </nav>
        <StatusPill status={agent.status} version={agent.version} />
        {dirty && <span className="pill bg-warning-container text-warning"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />未儲存變更</span>}
        <span className="flex-1" />
        <span className="hidden font-mono text-[11px] text-outline lg:flex lg:items-center lg:gap-1"><Icon name="cloud_done" className="text-[16px]" />{status || "\u5C1A\u672A\u5132\u5B58"}</span>
        {editable && <ShareChip share={agent.share} label="分享" onClick={() => setSharing(true)} />}
        {editable && <button className="btn-danger" onClick={remove}><Icon name="delete" className="text-[18px]" />刪除</button>}
        <button className="btn-soft" onClick={save} disabled={!dirty || saving || !editable}>{saving ? <Spinner /> : <Icon name="save" className="text-[18px]" />}儲存草稿</button>
        <button className="btn-primary" onClick={toSandbox} disabled={!editable && dirty}><Icon name="rocket_launch" className="text-[18px]" />建立並進入測試</button>
      </section>
      {sharing && createPortal(<ShareDialog title={agent.name} value={agent.share} owner={agent.owner_email} onClose={() => setSharing(false)} onDone={async (s) => { try { await api.shareAgent(agent.id, s); setAgent((a) => ({ ...a, share: s })); setSharing(false); } catch (e) { setErr(String(e)); } }} />, document.body)}
      {!editable && <div className="bg-warning-container px-5 py-1.5 text-xs text-warning">此 Agent 由 {agent.owner_email} 負責，您僅能檢視；請至沙盒與已發布版本對話。</div>}
      <ErrorBox msg={err} />

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-4 p-4">
        <aside className="col-span-12 space-y-4 overflow-auto xl:col-span-4 2xl:col-span-3">
          <div className="card p-4">
            <div className="flex items-center justify-between"><p className="section-title text-sm"><Icon name="tune" className="text-primary" />Agent 核心屬性</p><span className="chip" title={agent.id}>ID: {agent.id.length > 14 ? `${agent.id.slice(0, 12)}\u2026` : agent.id}</span></div>
            <Field label="Agent 名稱與標誌圖標"><input value={agent.name} onChange={(e) => patch({ name: e.target.value })} disabled={!editable} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="分類"><select value={agent.category} onChange={(e) => patch({ category: e.target.value })} disabled={!editable}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
              <Field label="專科代碼"><input value={agent.code} placeholder="CARD-801" onChange={(e) => patch({ code: e.target.value })} disabled={!editable} /></Field>
            </div>
            <Field label="負責科別 / 單位" hint="監控與成本儀表板依此分科統計"><select value={agent.department} onChange={(e) => patch({ department: e.target.value })} disabled={!editable}><option value="">（未指定）</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
            <Field label="臨床業務說明 (Description)"><textarea rows={3} value={agent.description} onChange={(e) => patch({ description: e.target.value })} disabled={!editable} /></Field>
            <Field label="預設模型群組（LiteLLM 路由）" hint={`\u672A\u5728\u7BC0\u9EDE\u6307\u5B9A\u7FA4\u7D44\u7684\u6A21\u578B\u6B65\u9A5F\uFF08\u542B\u689D\u4EF6\u5224\u65B7\uFF09\u4F7F\u7528\u6B64\u7FA4\u7D44\u3002${describeGroup(groups, agent.model_group)}`}>
              <select value={agent.model_group} onChange={(e) => patch({ model_group: e.target.value })} disabled={!editable}>
                {MODEL_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
            </Field>
            {effective() !== agent.model_group && <p className="mt-1 flex items-start gap-1 text-[11px] text-warning"><Icon name="info" className="text-[14px]" />
                目前實際使用 {effective()}：{agent.routing.sovereign_only ? "\u5DF2\u52FE\u9078\u300C\u50C5\u9650\u9662\u5167\u6A21\u578B\u300D" : `\u9AD8\u65BC\u6210\u672C\u4E0A\u9650 ${agent.routing.max_cost_tier}`}。</p>}
            <div className="mt-3 rounded-lg bg-surface-container-low p-3">
              <div className="flex items-center justify-between text-xs"><span className="font-semibold">隨機發散性 (Temperature)</span><span className="font-mono text-primary">{agent.temperature.toFixed(2)}</span></div>
              <input type="range" min={0} max={1} step={0.05} value={agent.temperature} onChange={(e) => patch({ temperature: Number(e.target.value) })} disabled={!editable} className="mt-1 accent-primary" />
              <div className="mt-2 flex items-center justify-between text-xs"><span className="font-semibold">採樣多樣性 (Top-P)</span><span className="font-mono text-primary">{agent.top_p.toFixed(2)}</span></div>
              <input type="range" min={0} max={1} step={0.05} value={agent.top_p} onChange={(e) => patch({ top_p: Number(e.target.value) })} disabled={!editable} className="mt-1 accent-primary" />
            </div>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-semibold text-on-surface-variant">模型路由與成本上限</summary>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" className="w-auto" checked={agent.routing.sovereign_only} onChange={(e) => patch({ routing: { ...agent.routing, sovereign_only: e.target.checked } })} disabled={!editable} />僅限院內模型（sovereign，不回退雲端）</label>
              <Field label="升級到 reasoning 的關鍵字" hint="只比對使用者的提問（不含檢索內容或前一步輸出）；節點已指定群組時不套用。"><input value={agent.routing.reasoning_keywords.join(", ")} onChange={(e) => patch({ routing: { ...agent.routing, reasoning_keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} disabled={!editable} /></Field>
              <Field label="成本上限" hint="上限，不只是門檻：預設群組、關鍵字升級與節點指定的群組若高於此等級，執行時一律降為此等級。sovereign 不受影響。"><select value={agent.routing.max_cost_tier} onChange={(e) => patch({ routing: { ...agent.routing, max_cost_tier: e.target.value } })} disabled={!editable}><option value="budget">budget</option><option value="fast">fast</option><option value="reasoning">reasoning</option></select></Field>
            </details>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between"><p className="section-title text-sm"><Icon name="terminal" className="text-primary" />醫療指引提示詞 (Instructions)</p><span className="chip">{tokens.toLocaleString()} / 8,192 tokens</span></div>
            <p className="mono mt-1">system_instruction.clinical</p>
            <textarea rows={12} className="mt-2 font-mono text-xs leading-5" value={agent.instructions} onChange={(e) => patch({ instructions: e.target.value })} disabled={!editable} />
          </div>

          <KnowledgePanel
    docIds={agent.knowledge_doc_ids ?? []}
    editable={editable}
    department={agent.department}
    onChange={(ids) => patch({ knowledge_doc_ids: ids, knowledge_count: ids.length })}
  />

          <SkillsPanel ids={agent.skill_ids ?? []} editable={editable} onChange={(ids) => patch({ skill_ids: ids })} />

          <details className="card p-4 text-xs">
            <summary className="cursor-pointer font-semibold">沙盒預載個案（{agent.test_cases.length}）</summary>
            {agent.test_cases.map((t, i) => <div key={i} className="mt-2 rounded border border-hairline p-2">
                <input className="mb-1" value={t.title} placeholder="案例標題" onChange={(e) => patch({ test_cases: agent.test_cases.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} disabled={!editable} />
                <textarea rows={2} value={t.message} placeholder="測試提問" onChange={(e) => patch({ test_cases: agent.test_cases.map((x, j) => j === i ? { ...x, message: e.target.value } : x) })} disabled={!editable} />
                {editable && <button className="btn-ghost mt-1 px-2 py-0.5 text-[11px]" onClick={() => patch({ test_cases: agent.test_cases.filter((_, j) => j !== i) })}>移除</button>}
              </div>)}
            {editable && <button className="btn-secondary mt-2 w-full" onClick={() => patch({ test_cases: [...agent.test_cases, { title: `\u6848\u4F8B ${agent.test_cases.length + 1}`, message: "" }] })}>＋ 新增測試個案</button>}
          </details>
        </aside>

        <section className="col-span-12 flex min-h-[520px] flex-col gap-3 xl:col-span-8 2xl:col-span-9">
          <div className="flex items-center gap-3">
            <span className={`pill px-3 py-1 ${problems.length ? "bg-error-container text-on-error-container" : "bg-primary-tint text-primary"}`}>
              <Icon name={problems.length ? "error" : "check_circle"} className="text-[14px]" />{problems.length ? `\u6D41\u7A0B\u6709 ${problems.length} \u500B\u554F\u984C` : "\u6D41\u7A0B\u908F\u8F2F\u9A57\u8B49\u7121\u8AA4 (Flow Validated - Ready to Test)"}</span>
            <span className="pill bg-surface-container-low text-on-surface-variant"><Icon name="swap_horiz" className="text-[14px]" />拓撲節點：{stats?.nodes} 個 / {stats?.edges} 條鏈結</span>
          </div>
          {problems.length > 0 && <ul className="list-disc rounded-lg border border-error/30 bg-error-container/30 px-8 py-2 text-xs text-on-error-container">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <div className="card h-[640px] flex-none overflow-hidden">
            <Canvas flow={agent.flow} onChange={setFlow} onSelect={setSelected} selectedId={selected?.id} />
          </div>
          {selected && editable && <NodeInspector
    node={agent.flow.nodes.find((n) => n.id === selected.id) ?? selected}
    knowledgeCount={agent.knowledge_doc_ids?.length ?? 0}
    effectiveGroup={effective}
    defaultGroup={agent.model_group}
    onChange={(n) => {
      setFlow({ ...agent.flow, nodes: agent.flow.nodes.map((x) => x.id === n.id ? n : x) });
      setSelected(n);
    }}
    onDelete={() => {
      setFlow({ nodes: agent.flow.nodes.filter((x) => x.id !== selected.id), edges: agent.flow.edges.filter((e) => e.source !== selected.id && e.target !== selected.id) });
      setSelected(null);
    }}
  />}
          <div className="card flex flex-wrap items-center gap-4 px-4 py-2 font-mono text-[11px] text-on-surface-variant">
            <span>畫布物件：{stats?.nodes} 個節點 · {stats?.edges} 條鏈結</span><span>|</span>
            <span>端點延遲預估：~{stats?.ms.toLocaleString()} ms</span><span>|</span>
            <span>單次成本預估：${stats?.usd.toFixed(4)} USD</span>
            <span className="flex-1" />
            <span className="text-outline">預估值依節點數與模型群組推算，實際以 LiteLLM 計量為準</span>
          </div>
        </section>
      </div>
    </div>;
}
export {
  Studio as default
};
