import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { MODEL_GROUPS, NODE_KINDS } from "../types";
import { describeGroup, useModelGroups } from "../modelGroups";
import { Field, Icon } from "./ui";
function NodeInspector({ node, onChange, onDelete, knowledgeCount, effectiveGroup, defaultGroup }) {
  const groups = useModelGroups();
  const set = (k, v) => onChange({ ...node, data: { ...node.data, [k]: v } });
  const setMany = (patch) => onChange({ ...node, data: { ...node.data, ...patch } });
  const s = (k, d = "") => String(node.data[k] ?? d);
  const meta = NODE_KINDS.find((k) => k.type === node.type);
  return <div className="card p-4">
      <div className="flex items-center gap-2">
        <Icon name={meta?.icon ?? "login"} className="text-primary" />
        <p className="text-sm font-bold">節點設定 <span className="chip ml-1">{node.type}</span></p>
        <span className="flex-1" />
        {node.type !== "input" && <button className="btn-danger px-2 py-1 text-xs" onClick={onDelete}><Icon name="delete" className="text-[14px]" />移除</button>}
      </div>
      <p className="mono mt-1">{node.id} · {meta?.hint}</p>
      <Field label="顯示名稱"><input value={s("label")} onChange={(e) => set("label", e.target.value)} /></Field>

      {node.type === "knowledge" && <>
        <Field label="檢索查詢（模板）" hint="可用 {{input}}、{{last}}、{{節點id}}。結果可在後續 LLM 提示詞以 {{此節點id}} 引用；若未引用會自動附加到系統提示。">
          <input value={s("query", "{{input}}")} onChange={(e) => set("query", e.target.value)} /></Field>
        <Field label="取回段落數 top_k"><input type="number" min={1} max={20} value={Number(node.data.top_k ?? 5)} onChange={(e) => set("top_k", Number(e.target.value))} /></Field>
        <p className={`mt-2 flex items-center gap-1 text-xs ${knowledgeCount ? "text-primary" : "text-warning"}`}><Icon name={knowledgeCount ? "check_circle" : "warning"} className="text-[16px]" />
          {knowledgeCount ? `\u5DF2\u639B\u8F09 ${knowledgeCount} \u4EFD\u77E5\u8B58\u6587\u4EF6` : "\u6B64 Agent \u5C1A\u672A\u639B\u8F09\u77E5\u8B58\u6587\u4EF6\uFF08\u5DE6\u5074\u300C\u81E8\u5E8A\u77E5\u8B58\u5EAB\u8207\u898F\u7BC4\u639B\u8F09\u300D\uFF09"}</p>
      </>}
      {(node.type === "llm" || node.type === "structured_output") && <>
        <Field label="提示詞" hint="可用 {{input}}、{{last}}、{{節點id}}"><textarea rows={4} className="font-mono text-xs" value={s("prompt", "{{input}}")} onChange={(e) => set("prompt", e.target.value)} /></Field>
        {node.type === "structured_output" && <Field label="JSON Schema" hint="模型以 JSON 模式輸出並解析；解析失敗則原文通過。"><textarea rows={6} className="font-mono text-xs" value={s("schema", "{}")} onChange={(e) => set("schema", e.target.value)} /></Field>}
      </>}
      {(node.type === "llm" || node.type === "structured_output" || node.type === "condition") && (() => {
    const pinned = s("group") || void 0;
    const runs = effectiveGroup(pinned);
    return <>
          <Field label="此步驟指定模型群組" hint={`\u7559\u7A7A = \u4F7F\u7528\u9810\u8A2D\u7FA4\u7D44 ${defaultGroup}\uFF08\u63D0\u554F\u542B\u95DC\u9375\u5B57\u6642\u5347\u7D1A reasoning\uFF09\u3002${describeGroup(groups, runs)}`}>
            <select value={s("group")} onChange={(e) => set("group", e.target.value || void 0)}>
              <option value="">（依預設群組與路由策略）</option>{MODEL_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select></Field>
          {pinned && runs !== pinned && <p className="mt-1 flex items-start gap-1 text-[11px] text-warning"><Icon name="info" className="text-[14px]" />執行時改用 {runs}（{runs === "sovereign" ? "\u5DF2\u52FE\u9078\u300C\u50C5\u9650\u9662\u5167\u6A21\u578B\u300D" : "\u8D85\u904E\u6210\u672C\u4E0A\u9650"}）。</p>}
        </>;
  })()}
      {node.type === "condition" && <Field label="判斷問題" hint="LLM 回答 YES/NO，分別走 true / false 分支"><textarea rows={3} value={s("question")} onChange={(e) => set("question", e.target.value)} /></Field>}
      {node.type === "his_emr" && <Field label="查詢條件（模板）" hint="院內 FHIR 閘道尚未串接；此節點目前回傳 stub 標記。"><input value={s("query", "{{input}}")} onChange={(e) => set("query", e.target.value)} /></Field>}
      {node.type === "pii_mask" && <p className="mt-3 text-xs text-on-surface-variant">此節點已停用。平台會自動對所有輸入、知識文件與檢索段落執行 Sensitive Data Protection 去識別化，不需在流程中加入；可直接刪除。</p>}
      {node.type === "tool" && <ToolConfig node={node} set={set} setMany={setMany} />}
      {node.type === "approval" && <>
        <Field label="核准訊息"><input value={s("message")} onChange={(e) => set("message", e.target.value)} /></Field>
        <p className="mt-2 text-xs text-on-surface-variant">此節點已不再提供新增（全院發布改由管理員核可）。既有節點仍會在每次執行時暫停，等待 Agent 負責人核准後才繼續下一步。</p>
      </>}
      {node.type === "output" && <Field label="回覆模板"><textarea rows={3} className="font-mono text-xs" value={s("template", "{{last}}")} onChange={(e) => set("template", e.target.value)} /></Field>}
    </div>;
}
function ToolConfig({ node, set, setMany }) {
  const nav = useNavigate();
  const [connectors, setConnectors] = useState([]);
  const [actions, setActions] = useState([]);
  const cid = String(node.data.connector_id ?? "");
  const action = String(node.data.action ?? "");
  const args = node.data.args && typeof node.data.args === "object" ? node.data.args : {};
  useEffect(() => {
    api.listConnectors().then(setConnectors).catch(() => setConnectors([]));
  }, []);
  useEffect(() => {
    if (cid) api.connectorActions(cid).then(setActions).catch(() => setActions([]));
    else setActions([]);
  }, [cid]);
  const conn = connectors.find((c) => c.id === cid);
  const spec = actions.find((a) => a.id === action);
  return <>
    <Field label="連接器（Connectors 連接器中心）" right={<button className="text-xs text-primary hover:underline" onClick={() => nav("/connectors")}>管理連接器</button>}>
      <select value={cid} onChange={(e) => setMany({ connector_id: e.target.value || void 0, action: void 0, args: {} })}>
        <option value="">（選擇連接器）</option>
        {connectors.map((c) => <option key={c.id} value={c.id} disabled={c.status !== "active"}>{c.label}{c.status !== "active" ? "\uFF08\u672A\u901A\u904E\u9023\u7DDA\u6E2C\u8A66\uFF09" : ""}</option>)}
      </select></Field>
    {conn && <p className="mono mt-1">{conn.type} · {conn.status === "active" ? "\u5DF2\u9023\u7DDA" : conn.status} · PII 遮蔽 {conn.redact_pii ? "\u958B" : "\u95DC"}</p>}
    {cid && <Field label="動作 / 工具" hint={actions.length === 0 ? "\u6B64\u9023\u63A5\u5668\u5C1A\u7121\u53EF\u7528\u52D5\u4F5C\uFF1AMCP \u4F3A\u670D\u5668\u9700\u5148\u901A\u904E\u9023\u7DDA\u6E2C\u8A66\u4EE5\u53D6\u5F97\u5DE5\u5177\u6E05\u55AE\u3002" : spec?.description}>
        <select value={action} onChange={(e) => setMany({ action: e.target.value || void 0, args: {} })}>
          <option value="">（選擇動作）</option>{actions.map((a) => <option key={a.id} value={a.id}>{a.label}{a.write ? "" : "\uFF08\u552F\u8B80\uFF09"}</option>)}
        </select></Field>}
    {spec && spec.args.map((a) => <Field key={a.key} label={`${a.label}${a.required ? " *" : ""}`} hint="可用 {{input}}、{{last}}、{{節點id}} 模板變數">
        {a.kind === "textarea" ? <textarea rows={3} className="font-mono text-xs" value={args[a.key] ?? ""} onChange={(e) => set("args", { ...args, [a.key]: e.target.value })} /> : <input className="font-mono text-xs" value={args[a.key] ?? ""} onChange={(e) => set("args", { ...args, [a.key]: e.target.value })} />}
      </Field>)}
    {spec?.write && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><Icon name="info" className="text-[14px]" />寫入動作建議在前面放一個「人工核准」節點。</p>}
  </>;
}
export {
  NodeInspector as default
};
