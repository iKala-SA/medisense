import React,{useCallback,useEffect,useMemo,useRef} from 'react';
import {ReactFlow,Background,Controls,Handle,Position,addEdge,applyNodeChanges,applyEdgeChanges} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {SignIn,Stethoscope,BookOpenText,Brain,GitBranch,BracketsCurly,PuzzlePiece,UserCheck,ShieldCheck,ArrowBendUpLeft} from '@phosphor-icons/react';
import {NODE_KINDS} from './kit';

export const KIND_ICON={input:SignIn,his_emr:Stethoscope,knowledge:BookOpenText,llm:Brain,condition:GitBranch,structured_output:BracketsCurly,tool:PuzzlePiece,approval:UserCheck,pii_mask:ShieldCheck,output:ArrowBendUpLeft};
const KIND=Object.fromEntries(NODE_KINDS.map(k=>[k.type,k]));

function summary(type,d){
  switch(type){
    case 'input':return '使用者訊息（已去識別化）→ {{input}}';
    case 'his_emr':return `查詢：${d.query??'{{input}}'}`;
    case 'knowledge':return `查詢 ${d.query??'{{input}}'} · top_k ${d.top_k??5}`;
    case 'llm':return String(d.prompt??'{{input}}');
    case 'structured_output':return `JSON Schema · ${String(d.schema??'{}').slice(0,40)}`;
    case 'condition':return String(d.question||'（未設定判斷問題）');
    case 'tool':return d.connector_id?`${d.action??'（未選動作）'}`:'（未選擇連接器）';
    case 'approval':return String(d.message??'需由負責人核准');
    case 'pii_mask':return '已停用，可刪除此節點';
    case 'output':return String(d.template??'{{last}}');
    default:return '';
  }
}

function FlowNodeView({data,type,selected}){
  const Ico=KIND_ICON[type]||SignIn;
  const idx=data.__index;
  return <div className={`lv-node ${type} ${selected?'selected':''}`}>
    {type!=='input'&&<Handle type="target" position={Position.Left}/>}
    <div className="head"><Ico size={15}/><span className="t">{idx!=null?`${idx}. `:''}{String(data.label??KIND[type]?.label??type)}</span><span className="kind">{type==='llm'?'LLM':type.replace('_',' ')}</span></div>
    <div className="body">{summary(type,data)}</div>
    {type==='condition'?<>
      <Handle type="source" id="true" position={Position.Right} style={{top:'35%'}}/>
      <Handle type="source" id="false" position={Position.Right} style={{top:'72%'}}/>
      <div className="cond"><span>true ↗</span><span>false ↘</span></div>
    </>:type!=='output'?<Handle type="source" position={Position.Right}/>:null}
  </div>;
}

const DEFAULTS={
  knowledge:{query:'{{input}}',top_k:5},llm:{prompt:'{{input}}'},output:{template:'{{last}}'},
  structured_output:{prompt:'{{input}}',schema:'{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}'},
  his_emr:{query:'{{input}}'},tool:{args:{}},approval:{message:'需由負責人核准後繼續'},condition:{question:''},pii_mask:{}
};

/** Drag-and-drop canvas. Nodes/edges are stored exactly as the backend interpreter reads them. */
export default function Canvas({flow,onChange,onSelect,selectedId,readOnly}){
  const nodeTypes=useMemo(()=>Object.fromEntries(['input',...NODE_KINDS.map(k=>k.type)].map(t=>[t,FlowNodeView])),[]);
  const nodes=useMemo(()=>flow.nodes.map((n,i)=>({...n,selected:n.id===selectedId,data:{...n.data,__index:i+1}})),[flow.nodes,selectedId]);
  const clean=ns=>ns.map(n=>{const {__index,...data}=n.data;void __index;return {id:n.id,type:n.type,position:n.position,data}});

  // React Flow fires node and edge changes in the same tick (e.g. deleting a node): both must build on the latest flow.
  const latest=useRef(flow);latest.current=flow;
  const emit=useCallback(next=>{
    const ids=new Set(next.nodes.map(n=>n.id));
    const ok=next.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
    const fixed=ok.length===next.edges.length?next:{...next,edges:ok};
    latest.current=fixed;onChange(fixed);
  },[onChange]);
  const onNodesChange=useCallback(c=>{
    if(c.every(ch=>ch.type==='dimensions'||ch.type==='select'))return;
    emit({...latest.current,nodes:clean(applyNodeChanges(c,latest.current.nodes))});
  },[emit]);
  const onEdgesChange=useCallback(c=>emit({...latest.current,edges:applyEdgeChanges(c,latest.current.edges)}),[emit]);
  const onConnect=useCallback(c=>emit({...latest.current,edges:addEdge({...c,id:`e-${c.source}-${c.target}-${c.sourceHandle??''}`},latest.current.edges)}),[emit]);

  // Heal flows already saved with dangling edges.
  useEffect(()=>{
    if(readOnly)return;
    const ids=new Set(flow.nodes.map(n=>n.id));
    if(flow.edges.some(e=>!ids.has(e.source)||!ids.has(e.target)))emit(flow);
  },[flow,emit,readOnly]);

  const add=type=>{
    const id=`${type}-${Math.random().toString(36).slice(2,7)}`;
    const last=flow.nodes[flow.nodes.length-1];
    const node={id,type,position:{x:(last?.position.x??0)+260,y:(last?.position.y??160)+(Math.random()*100-50)},data:{label:KIND[type].label,...DEFAULTS[type]}};
    emit({...latest.current,nodes:[...latest.current.nodes,node]});
    onSelect(node);
  };

  return <div className="lv-canvas">
    {!readOnly&&<div className="lv-palette"><span className="small muted" style={{alignSelf:'center'}}>新增節點：</span>
      {NODE_KINDS.filter(k=>!k.retired).map(k=>{const I=KIND_ICON[k.type];return <button type="button" key={k.type} title={k.hint} onClick={()=>add(k.type)}><I size={14}/>{k.label}</button>})}</div>}
    <ReactFlow nodes={nodes} edges={flow.edges} nodeTypes={nodeTypes}
      nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable
      onNodesChange={readOnly?undefined:onNodesChange} onEdgesChange={readOnly?undefined:onEdgesChange} onConnect={readOnly?undefined:onConnect}
      onNodeClick={(_,n)=>onSelect(flow.nodes.find(x=>x.id===n.id)||null)} onPaneClick={()=>onSelect(null)}
      fitView fitViewOptions={{padding:0.3,maxZoom:1}} deleteKeyCode={readOnly?null:['Backspace','Delete']} proOptions={{hideAttribution:true}}>
      <Background gap={18} color="#e1eee8"/><Controls position="bottom-right" showInteractive={false}/>
    </ReactFlow>
  </div>;
}
