import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges
} from "@xyflow/react";
import { NODE_KINDS } from "../types";
import { Icon } from "./ui";
const KIND = Object.fromEntries(NODE_KINDS.map((k) => [k.type, k]));
function summary(type, d) {
  switch (type) {
    case "input":
      return "\u4F7F\u7528\u8005\u8A0A\u606F\uFF08\u5DF2\u53BB\u8B58\u5225\u5316\uFF09\u2192 {{input}}";
    case "his_emr":
      return `\u67E5\u8A62\uFF1A${d.query ?? "{{input}}"}`;
    case "knowledge":
      return `\u67E5\u8A62 ${d.query ?? "{{input}}"}`;
    case "llm":
      return String(d.prompt ?? "{{input}}");
    case "structured_output":
      return `JSON Schema \xB7 ${String(d.schema ?? "{}").slice(0, 40)}`;
    case "condition":
      return String(d.question ?? "\uFF08\u672A\u8A2D\u5B9A\u5224\u65B7\u554F\u984C\uFF09");
    case "tool":
      return d.connector_id ? `${d.action ?? "\uFF08\u672A\u9078\u52D5\u4F5C\uFF09"}` : "\uFF08\u672A\u9078\u64C7\u9023\u63A5\u5668\uFF09";
    case "approval":
      return String(d.message ?? "\u9700\u7531\u4E3B\u6CBB\u91AB\u5E2B\u6838\u51C6");
    case "pii_mask":
      return "\u5DF2\u505C\u7528\uFF1A\u5E73\u53F0\u5DF2\u81EA\u52D5\u53BB\u8B58\u5225\u5316\uFF0C\u53EF\u522A\u9664\u6B64\u7BC0\u9EDE";
    case "output":
      return String(d.template ?? "{{last}}");
    default:
      return "";
  }
}
function FlowNodeView({ data, type, selected }) {
  const kind = String(type);
  const d = data;
  const meta = KIND[kind] ?? { icon: "input", label: kind };
  const idx = d.__index;
  return <div className={`flow-node ${kind} ${selected ? "selected" : ""}`}>
      {kind !== "input" && <Handle type="target" position={Position.Left} />}
      <div className="head">
        <Icon name={kind === "input" ? "login" : meta.icon} className="text-[16px]" />
        <span className="truncate">{idx != null ? `${idx}. ` : ""}{String(d.label ?? meta.label)}</span>
        <span className="kind">{kind === "pii_mask" ? "HIPAA" : kind === "llm" ? "LLM" : kind.replace("_", " ")}</span>
      </div>
      <div className="body"><p className="line-clamp-2 font-mono text-[11px]">{summary(kind, d)}</p></div>
      {kind === "condition" ? <>
          <Handle type="source" id="true" position={Position.Right} style={{ top: "35%" }} />
          <Handle type="source" id="false" position={Position.Right} style={{ top: "72%" }} />
          <div className="flex justify-end gap-3 px-3 pb-1 font-mono text-[10px] text-tertiary"><span>true ↗</span><span>false ↘</span></div>
        </> : kind !== "output" ? <Handle type="source" position={Position.Right} /> : null}
    </div>;
}
function Canvas({ flow, onChange, onSelect, selectedId }) {
  const nodeTypes = useMemo(() => Object.fromEntries(["input", ...NODE_KINDS.map((k) => k.type)].map((t) => [t, FlowNodeView])), []);
  const nodes = useMemo(
    () => flow.nodes.map((n, i) => ({ ...n, selected: n.id === selectedId, data: { ...n.data, __index: i + 1 } })),
    [flow.nodes, selectedId]
  );
  const edges = flow.edges;
  const clean = (ns) => ns.map((n) => {
    const { __index: _i, ...data } = n.data;
    void _i;
    return { id: n.id, type: n.type, position: n.position, data };
  });
  const latest = useRef(flow);
  latest.current = flow;
  const emit = useCallback((next) => {
    const ids = new Set(next.nodes.map((n) => n.id));
    const edgesOk = next.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const fixed = edgesOk.length === next.edges.length ? next : { ...next, edges: edgesOk };
    latest.current = fixed;
    onChange(fixed);
  }, [onChange]);
  const onNodesChange = useCallback((c) => {
    if (c.every((ch) => ch.type === "dimensions" || ch.type === "select")) return;
    emit({ ...latest.current, nodes: clean(applyNodeChanges(c, latest.current.nodes)) });
  }, [emit]);
  const onEdgesChange = useCallback((c) => emit({ ...latest.current, edges: applyEdgeChanges(c, latest.current.edges) }), [emit]);
  const onConnect = useCallback((c) => emit({ ...latest.current, edges: addEdge({ ...c, id: `e-${c.source}-${c.target}-${c.sourceHandle ?? ""}` }, latest.current.edges) }), [emit]);
  useEffect(() => {
    const ids = new Set(flow.nodes.map((n) => n.id));
    if (flow.edges.some((e) => !ids.has(e.source) || !ids.has(e.target))) emit(flow);
  }, [flow, emit]);
  const add = (type) => {
    const id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
    const last = flow.nodes[flow.nodes.length - 1];
    const defaults = {
      knowledge: { query: "{{input}}" },
      llm: { prompt: "{{input}}" },
      output: { template: "{{last}}" },
      structured_output: { prompt: "{{input}}", schema: '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' },
      his_emr: { query: "{{input}}" },
      tool: { args: {} },
      approval: { message: "\u9700\u7531\u4E3B\u6CBB\u91AB\u5E2B\u6838\u51C6\u5F8C\u6B78\u6A94" },
      condition: { question: "" },
      pii_mask: {}
    };
    const node = { id, type, position: { x: (last?.position.x ?? 0) + 300, y: (last?.position.y ?? 200) + (Math.random() * 120 - 60) }, data: { label: KIND[type].label, ...defaults[type] } };
    emit({ ...latest.current, nodes: [...latest.current.nodes, node] });
    onSelect(node);
  };
  return <div className="relative h-full">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border border-hairline bg-white/95 p-1.5 shadow-float">
        <span className="px-1 font-mono text-[10px] text-outline">可拖曳節點庫：</span>
        {NODE_KINDS.filter((k) => !k.retired).map((k) => <button key={k.type} title={k.hint} onClick={() => add(k.type)} className="btn-soft gap-1 px-2 py-1 text-[11px]"><Icon name={k.icon} className="text-[16px]" />{k.label}</button>)}
      </div>
      <ReactFlow
    nodes={nodes}
    edges={edges}
    nodeTypes={nodeTypes}
    onNodesChange={onNodesChange}
    onEdgesChange={onEdgesChange}
    onConnect={onConnect}
    onNodeClick={(_, n) => onSelect(flow.nodes.find((x) => x.id === n.id) ?? null)}
    onPaneClick={() => onSelect(null)}
    fitView
    fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
    deleteKeyCode={["Backspace", "Delete"]}
    proOptions={{ hideAttribution: true }}
  >
        <Background gap={18} color="#dce4e0" />
        <Controls position="bottom-right" />
      </ReactFlow>
    </div>;
}
export {
  Canvas as default
};
