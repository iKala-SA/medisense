import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { MODEL_GROUPS, NODE_KINDS, type ActionSpec, type ConnectorOut, type FlowNode, type ModelGroup } from "../types";
import { describeGroup, useModelGroups } from "../modelGroups";
import { Field, Icon } from "./ui";

export default function NodeInspector({ node, onChange, onDelete, knowledgeCount, effectiveGroup, defaultGroup }: {
  node: FlowNode; onChange: (n: FlowNode) => void; onDelete: () => void; knowledgeCount: number;
  /** pinned group (or undefined) -> what actually runs after sovereign_only and the cost cap. */
  effectiveGroup: (pinned?: ModelGroup) => ModelGroup; defaultGroup: ModelGroup;
}) {
  const groups = useModelGroups();
  const set = (k: string, v: unknown) => onChange({ ...node, data: { ...node.data, [k]: v } });
  // Several keys in ONE update: calling set() repeatedly would each start from the same stale node, so the last call wins.
  const setMany = (patch: Record<string, unknown>) => onChange({ ...node, data: { ...node.data, ...patch } });
  const s = (k: string, d = "") => String(node.data[k] ?? d);
  const meta = NODE_KINDS.find((k) => k.type === node.type);
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Icon name={meta?.icon ?? "login"} className="text-primary" />
        <p className="text-sm font-bold">節點設定 <span className="chip ml-1">{node.type}</span></p>
        <span className="flex-1" />
        {node.type !== "input" && <button className="btn-danger px-2 py-1 text-xs" onClick={onDelete}><Icon name="delete" className="text-[14px]" />移除</button>}
      </div>
      <p className="mono mt-1">{node.id} · {meta?.hint}</p>
      <Field label="顯示名稱"><input value={s("label")} onChange={(e) => set("label", e.target.value)} /></Field>

      {node.type === "knowledge" && (<>
        <Field label="檢索查詢（模板）" hint="可用 {{input}}、{{last}}、{{節點id}}。結果可在後續 LLM 提示詞以 {{此節點id}} 引用；若未引用會自動附加到系統提示。">
          <input value={s("query", "{{input}}")} onChange={(e) => set("query", e.target.value)} /></Field>
        <Field label="取回段落數 top_k"><input type="number" min={1} max={20} value={Number(node.data.top_k ?? 5)} onChange={(e) => set("top_k", Number(e.target.value))} /></Field>
        <p className={`mt-2 flex items-center gap-1 text-xs ${knowledgeCount ? "text-primary" : "text-warning"}`}><Icon name={knowledgeCount ? "check_circle" : "warning"} className="text-[16px]" />
          {knowledgeCount ? `已掛載 ${knowledgeCount} 份知識文件` : "此 Agent 尚未掛載知識文件（左側「臨床知識庫與規範掛載」）"}</p>
      </>)}
      {(node.type === "llm" || node.type === "structured_output") && (<>
        <Field label="提示詞" hint="可用 {{input}}、{{last}}、{{節點id}}"><textarea rows={4} className="font-mono text-xs" value={s("prompt", "{{input}}")} onChange={(e) => set("prompt", e.target.value)} /></Field>
        {node.type === "structured_output" && (
          <Field label="JSON Schema" hint="模型以 JSON 模式輸出並解析；解析失敗則原文通過。"><textarea rows={6} className="font-mono text-xs" value={s("schema", "{}")} onChange={(e) => set("schema", e.target.value)} /></Field>
        )}
      </>)}
      {(node.type === "llm" || node.type === "structured_output" || node.type === "condition") && (() => {
        const pinned = (s("group") || undefined) as ModelGroup | undefined;
        const runs = effectiveGroup(pinned);
        return (<>
          <Field label="此步驟指定模型群組" hint={`留空 = 使用預設群組 ${defaultGroup}（提問含關鍵字時升級 reasoning）。${describeGroup(groups, runs)}`}>
            <select value={s("group")} onChange={(e) => set("group", e.target.value || undefined)}>
              <option value="">（依預設群組與路由策略）</option>{MODEL_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select></Field>
          {pinned && runs !== pinned && <p className="mt-1 flex items-start gap-1 text-[11px] text-warning"><Icon name="info" className="text-[14px]" />執行時改用 {runs}（{runs === "sovereign" ? "已勾選「僅限院內模型」" : "超過成本上限"}）。</p>}
        </>);
      })()}
      {node.type === "condition" && (
        <Field label="判斷問題" hint="LLM 回答 YES/NO，分別走 true / false 分支"><textarea rows={3} value={s("question")} onChange={(e) => set("question", e.target.value)} /></Field>
      )}
      {node.type === "his_emr" && (
        <Field label="查詢條件（模板）" hint="院內 FHIR 閘道尚未串接；此節點目前回傳 stub 標記。"><input value={s("query", "{{input}}")} onChange={(e) => set("query", e.target.value)} /></Field>
      )}
      {node.type === "pii_mask" && <p className="mt-3 text-xs text-on-surface-variant">此節點已停用。平台會自動對所有輸入、知識文件與檢索段落執行 Sensitive Data Protection 去識別化，不需在流程中加入；可直接刪除。</p>}
      {node.type === "tool" && <ToolConfig node={node} set={set} setMany={setMany} />}
      {node.type === "approval" && <>
        <Field label="核准訊息"><input value={s("message")} onChange={(e) => set("message", e.target.value)} /></Field>
        <p className="mt-2 text-xs text-on-surface-variant">此節點已不再提供新增（全院發布改由管理員核可）。既有節點仍會在每次執行時暫停，等待 Agent 負責人核准後才繼續下一步。</p>
      </>}
      {node.type === "output" && <Field label="回覆模板"><textarea rows={3} className="font-mono text-xs" value={s("template", "{{last}}")} onChange={(e) => set("template", e.target.value)} /></Field>}
    </div>
  );
}

/** Tool node: pick a shared connector, then one of its actions (MCP tools come from the last successful test). */
function ToolConfig({ node, set, setMany }: { node: FlowNode; set: (k: string, v: unknown) => void; setMany: (p: Record<string, unknown>) => void }) {
  const nav = useNavigate();
  const [connectors, setConnectors] = useState<ConnectorOut[]>([]);
  const [actions, setActions] = useState<ActionSpec[]>([]);
  const cid = String(node.data.connector_id ?? "");
  const action = String(node.data.action ?? "");
  const args = (node.data.args && typeof node.data.args === "object" ? node.data.args : {}) as Record<string, string>;
  useEffect(() => { api.listConnectors().then(setConnectors).catch(() => setConnectors([])); }, []);
  useEffect(() => { if (cid) api.connectorActions(cid).then(setActions).catch(() => setActions([])); else setActions([]); }, [cid]);
  const conn = connectors.find((c) => c.id === cid);
  const spec = actions.find((a) => a.id === action);
  return (<>
    <Field label="連接器（Connectors 連接器中心）" right={<button className="text-xs text-primary hover:underline" onClick={() => nav("/connectors")}>管理連接器</button>}>
      <select value={cid} onChange={(e) => setMany({ connector_id: e.target.value || undefined, action: undefined, args: {} })}>
        <option value="">（選擇連接器）</option>
        {connectors.map((c) => <option key={c.id} value={c.id} disabled={c.status !== "active"}>{c.label}{c.status !== "active" ? "（未通過連線測試）" : ""}</option>)}
      </select></Field>
    {conn && <p className="mono mt-1">{conn.type} · {conn.status === "active" ? "已連線" : conn.status} · PII 遮蔽 {conn.redact_pii ? "開" : "關"}</p>}
    {cid && (
      <Field label="動作 / 工具" hint={actions.length === 0 ? "此連接器尚無可用動作：MCP 伺服器需先通過連線測試以取得工具清單。" : spec?.description}>
        <select value={action} onChange={(e) => setMany({ action: e.target.value || undefined, args: {} })}>
          <option value="">（選擇動作）</option>{actions.map((a) => <option key={a.id} value={a.id}>{a.label}{a.write ? "" : "（唯讀）"}</option>)}
        </select></Field>
    )}
    {spec && spec.args.map((a) => (
      <Field key={a.key} label={`${a.label}${a.required ? " *" : ""}`} hint="可用 {{input}}、{{last}}、{{節點id}} 模板變數">
        {a.kind === "textarea" ? <textarea rows={3} className="font-mono text-xs" value={args[a.key] ?? ""} onChange={(e) => set("args", { ...args, [a.key]: e.target.value })} />
          : <input className="font-mono text-xs" value={args[a.key] ?? ""} onChange={(e) => set("args", { ...args, [a.key]: e.target.value })} />}
      </Field>))}
    {spec?.write && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><Icon name="info" className="text-[14px]" />寫入動作建議在前面放一個「人工核准」節點。</p>}
  </>);
}

