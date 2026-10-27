import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position, addEdge,
  applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange, type NodeProps,
} from "@xyflow/react";
import { NODE_KINDS, type Flow, type FlowEdge, type FlowNode, type NodeType } from "../types";
import { Icon } from "./ui";

const KIND = Object.fromEntries(NODE_KINDS.map((k) => [k.type, k])) as Record<NodeType, (typeof NODE_KINDS)[number]>;

function summary(type: string, d: Record<string, unknown>): string {
  switch (type) {
    case "input": return "使用者訊息（已去識別化）→ {{input}}";
    case "his_emr": return `查詢：${d.query ?? "{{input}}"}`;
    case "knowledge": return `查詢 ${d.query ?? "{{input}}"} · top_k ${d.top_k ?? 5}`;
    case "llm": return String(d.prompt ?? "{{input}}");
    case "structured_output": return `JSON Schema · ${String(d.schema ?? "{}").slice(0, 40)}`;
    case "condition": return String(d.question ?? "（未設定判斷問題）");
    case "tool": return d.connector_id ? `${d.action ?? "（未選動作）"}` : "（未選擇連接器）";
    case "approval": return String(d.message ?? "需由主治醫師核准");
    case "pii_mask": return "已停用：平台已自動去識別化，可刪除此節點";
    case "output": return String(d.template ?? "{{last}}");
    default: return "";
  }
}

function FlowNodeView({ data, type, selected }: NodeProps) {
  const kind = String(type) as NodeType;
  const d = data as Record<string, unknown>;
  const meta = KIND[kind] ?? { icon: "input", label: kind };
  const idx = d.__index as number | undefined;
  return (
    <div className={`flow-node ${kind} ${selected ? "selected" : ""}`}>
      {kind !== "input" && <Handle type="target" position={Position.Left} />}
      <div className="head">
        <Icon name={kind === "input" ? "login" : meta.icon} className="text-[16px]" />
        <span className="truncate">{idx != null ? `${idx}. ` : ""}{String(d.label ?? meta.label)}</span>
        <span className="kind">{kind === "pii_mask" ? "HIPAA" : kind === "llm" ? "LLM" : kind.replace("_", " ")}</span>
      </div>
      <div className="body"><p className="line-clamp-2 font-mono text-[11px]">{summary(kind, d)}</p></div>
      {kind === "condition" ? (
        <>
          <Handle type="source" id="true" position={Position.Right} style={{ top: "35%" }} />
          <Handle type="source" id="false" position={Position.Right} style={{ top: "72%" }} />
          <div className="flex justify-end gap-3 px-3 pb-1 font-mono text-[10px] text-tertiary"><span>true ↗</span><span>false ↘</span></div>
        </>
      ) : kind !== "output" ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

interface Props { flow: Flow; onChange: (flow: Flow) => void; onSelect: (n: FlowNode | null) => void; selectedId?: string | null }

/** Drag & drop canvas. Nodes/edges are stored exactly as the backend interpreter reads them. */
export default function Canvas({ flow, onChange, onSelect, selectedId }: Props) {
  const nodeTypes = useMemo(() => Object.fromEntries(["input", ...NODE_KINDS.map((k) => k.type)].map((t) => [t, FlowNodeView])), []);
  const nodes = useMemo(
    () => flow.nodes.map((n, i) => ({ ...n, selected: n.id === selectedId, data: { ...n.data, __index: i + 1 } })) as unknown as Node[],
    [flow.nodes, selectedId],
  );
  const edges = flow.edges as unknown as Edge[];
  const clean = (ns: Node[]): FlowNode[] =>
    ns.map((n) => { const { __index: _i, ...data } = n.data as Record<string, unknown>; void _i; return { id: n.id, type: n.type as NodeType, position: n.position, data }; });

  // React Flow fires onNodesChange and onEdgesChange in the same tick (e.g. deleting a node). Each handler
  // must build on the LATEST flow, not the render-time copy, or one change overwrites the other and leaves
  // edges pointing at deleted nodes. `latest` is updated synchronously on every emit.
  const latest = useRef(flow);
  latest.current = flow;
  const emit = useCallback((next: Flow) => {
    const ids = new Set(next.nodes.map((n) => n.id));
    const edgesOk = next.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const fixed = edgesOk.length === next.edges.length ? next : { ...next, edges: edgesOk };
    latest.current = fixed;
    onChange(fixed);
  }, [onChange]);

  const onNodesChange = useCallback((c: NodeChange[]) => {
    // Measurement and selection events are not edits: width/height are never stored and selection is tracked by the page.
    if (c.every((ch) => ch.type === "dimensions" || ch.type === "select")) return;
    emit({ ...latest.current, nodes: clean(applyNodeChanges(c, latest.current.nodes as unknown as Node[])) });
  }, [emit]);
  const onEdgesChange = useCallback((c: EdgeChange[]) => emit({ ...latest.current, edges: applyEdgeChanges(c, latest.current.edges as unknown as Edge[]) as unknown as FlowEdge[] }), [emit]);
  const onConnect = useCallback((c: Connection) => emit({ ...latest.current, edges: addEdge({ ...c, id: `e-${c.source}-${c.target}-${c.sourceHandle ?? ""}` }, latest.current.edges as unknown as Edge[]) as unknown as FlowEdge[] }), [emit]);

  // Heal flows already saved with dangling edges (they fail validation and are invisible on the canvas).
  useEffect(() => {
    const ids = new Set(flow.nodes.map((n) => n.id));
    if (flow.edges.some((e) => !ids.has(e.source) || !ids.has(e.target))) emit(flow);
  }, [flow, emit]);

  const add = (type: NodeType) => {
    const id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
    const last = flow.nodes[flow.nodes.length - 1];
    const defaults: Record<string, Record<string, unknown>> = {
      knowledge: { query: "{{input}}", top_k: 5 }, llm: { prompt: "{{input}}" }, output: { template: "{{last}}" },
      structured_output: { prompt: "{{input}}", schema: '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' },
      his_emr: { query: "{{input}}" }, tool: { args: {} }, approval: { message: "需由主治醫師核准後歸檔" },
      condition: { question: "" }, pii_mask: {},
    };
    const node: FlowNode = { id, type, position: { x: (last?.position.x ?? 0) + 300, y: (last?.position.y ?? 200) + (Math.random() * 120 - 60) }, data: { label: KIND[type].label, ...defaults[type] } };
    emit({ ...latest.current, nodes: [...latest.current.nodes, node] });
    onSelect(node);
  };

  return (
    <div className="relative h-full">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border border-hairline bg-white/95 p-1.5 shadow-float">
        <span className="px-1 font-mono text-[10px] text-outline">可拖曳節點庫：</span>
        {NODE_KINDS.filter((k) => !k.retired).map((k) => (
          <button key={k.type} title={k.hint} onClick={() => add(k.type)} className="btn-soft gap-1 px-2 py-1 text-[11px]"><Icon name={k.icon} className="text-[16px]" />{k.label}</button>
        ))}
      </div>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onNodeClick={(_, n) => onSelect(flow.nodes.find((x) => x.id === n.id) ?? null)} onPaneClick={() => onSelect(null)}
        fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} deleteKeyCode={["Backspace", "Delete"]} proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} color="#c9d4d1" />
        <Controls position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
