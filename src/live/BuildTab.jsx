import React,{useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle,WarningCircle} from '@phosphor-icons/react';
import {api} from '../api';
import Canvas from './Canvas';
import NodeInspector from './NodeInspector';
import {clampToCap} from './kit';

export default function BuildTab({agent,patch,editable}){
  const [selected,setSelected]=useState(null),[problems,setProblems]=useState(null),[vErr,setVErr]=useState('');
  const timer=useRef();
  const flow=agent.flow;
  useEffect(()=>{
    if(!editable)return;// validate is builder-only on the backend
    window.clearTimeout(timer.current);
    timer.current=window.setTimeout(()=>api.validate(flow).then(r=>{setProblems(r.problems||[]);setVErr('')}).catch(e=>setVErr(String(e.message||e))),500);
    return()=>window.clearTimeout(timer.current);
  },[flow,editable]);
  const setFlow=useCallback(f=>patch({flow:f}),[patch]);
  const effective=useCallback(pinned=>agent.routing?.sovereign_only?'sovereign':clampToCap(pinned||agent.model_group,agent.routing?.max_cost_tier||'reasoning'),[agent.routing,agent.model_group]);
  const node=selected&&flow.nodes.find(n=>n.id===selected.id);
  return <div className="lv-wrap">
    {editable&&(vErr?<div className="lv-banner warn"><WarningCircle size={18}/>無法驗證流程：{vErr}</div>
      :problems===null?<div className="lv-banner info"><span className="lv-spin"/>驗證流程中…</div>
      :problems.length?<div className="lv-banner bad"><WarningCircle size={18}/><div>流程有 {problems.length} 個問題<ul>{problems.map(p=><li key={p}>{p}</li>)}</ul></div></div>
      :<div className="lv-banner ok"><CheckCircle size={18}/>流程驗證無誤，可以測試。</div>)}
    {!editable&&<div className="lv-banner info">你沒有此 Agent 的編輯權限，畫布為唯讀。</div>}
    <div className="lv-build">
      <Canvas flow={flow} onChange={setFlow} onSelect={setSelected} selectedId={selected?.id} readOnly={!editable}/>
      <div>
        {node&&editable?<NodeInspector node={node} knowledgeCount={(agent.knowledge_doc_ids||[]).length} effectiveGroup={effective} defaultGroup={agent.model_group}
          onChange={n=>{setFlow({...flow,nodes:flow.nodes.map(x=>x.id===n.id?n:x)});setSelected(n)}}
          onDelete={()=>{setFlow({nodes:flow.nodes.filter(x=>x.id!==node.id),edges:flow.edges.filter(e=>e.source!==node.id&&e.target!==node.id)});setSelected(null)}}/>
        :<div className="lv-card"><p className="lv-hint" style={{margin:0}}>{flow.nodes.length} 個節點 · {flow.edges.length} 條連線。{editable?'點選節點以編輯；拖曳圓點連線；按 Delete 刪除。':'點選節點可檢視位置。'}</p></div>}
      </div>
    </div>
  </div>;
}
