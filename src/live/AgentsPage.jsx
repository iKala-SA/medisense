import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Cube,Plus,CaretRight,MagnifyingGlass} from '@phosphor-icons/react';
import {api} from '../api';
import {AgentCreate} from '../AgentCreate';
import {ShareButton,ShareModal} from '../ShareKit';
import AgentDetail from './AgentDetail';
import {errText,shareAgent,MODEL_GROUP_IDS,defaultFlow,defaultRouting,statusBadges,canEditAgent} from './kit';
import './agents.css';

const AUTO='自動路由';
const cls=b=>b==='待審核'?'lv-badge-warn':b==='已退回'?'lv-badge-bad':b==='已發布'?'lv-badge-ok':'';

/** Live Agent area. Props: me = GET /api/me ({uid,email,name,role,department}); notify(message) shows a toast. */
export default function AgentsPage({me,notify}){
  const [agents,setAgents]=useState(null),[err,setErr]=useState(''),[q,setQ]=useState('');
  const [view,setView]=useState({kind:'list'}),[groups,setGroups]=useState(null),[sharing,setSharing]=useState(null);
  const canBuild=me.role==='admin'||me.role==='builder';

  const load=useCallback(()=>{
    setErr('');
    return api.listAgents().then(setAgents).catch(e=>{setAgents([]);setErr(errText(e));notify('載入 Agent 失敗：'+errText(e))});
  },[]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{load()},[load]);

  const openCreate=()=>{
    setView({kind:'create'});
    if(groups===null)api.modelGroups().then(r=>setGroups((r?.groups||[]).map(g=>g.id)))
      .catch(()=>setGroups(MODEL_GROUP_IDS));
  };
  const create=async v=>{
    // "自動路由" has no backend group of its own: use the default group and let the routing keywords upgrade to reasoning.
    const model_group=v.model===AUTO?'fast':v.model;
    try{
      const a=await api.createAgent({
        name:v.name,description:v.desc,instructions:v.instr,category:'clinical',department:me.department||'',code:'',model_group,
        temperature:0.3,top_p:0.95,routing:defaultRouting(),connectors:[],flow:defaultFlow(),test_cases:[],knowledge_doc_ids:[],
        ...(v.share?{share:{access:v.share.access,role:v.share.role,members:v.share.members.map(({type,id,name,role})=>({type,id,name:name||'',role}))}}:{})
      });
      notify('已建立 Agent 草稿');
      setAgents(l=>[a,...(l||[])]);setView({kind:'detail',id:a.id,tab:'建置'});
    }catch(e){notify('建立失敗：'+errText(e))}
  };
  const patchLocal=a=>setAgents(l=>(l||[]).map(x=>x.id===a.id?{...x,...a}:x));

  if(view.kind==='create'){
    if(groups===null)return <div className="lv-state"><span className="lv-spin"/>載入模型群組…</div>;
    return <AgentCreate creator={me.name||me.email} backLabel="所有 Agent" noun="Agent" status="草稿"
      selects={[{key:'model',label:'模型群組',options:[AUTO,...groups],default:AUTO}]}
      onCancel={()=>setView({kind:'list'})} onSave={create}/>;
  }
  if(view.kind==='detail')return <AgentDetail key={view.id} id={view.id} me={me} notify={notify} initialTab={view.tab}
    onBack={()=>{setView({kind:'list'});load()}} onChanged={patchLocal}
    onDeleted={id=>{setAgents(l=>(l||[]).filter(x=>x.id!==id));setView({kind:'list'})}}/>;

  const rows=(agents||[]).filter(a=>!q.trim()||(a.name+a.description+(a.owner_email||'')).toLowerCase().includes(q.trim().toLowerCase()));
  const sharingAgent=sharing&&(agents||[]).find(a=>a.id===sharing);
  return <>
    <div className="page-heading"><h1><Cube/>Agent</h1>
      {canBuild&&<button className="btn primary" onClick={openCreate}><Plus/>建立 Agent</button>}</div>
    <p className="subtitle">{canBuild?'建立、測試並申請發布院內 Agent。':'與已發布的院內 Agent 對話。'}</p>
    <div className="toolbar"><label className="search"><MagnifyingGlass size={16}/><input aria-label="搜尋" placeholder="搜尋 Agent" value={q} onChange={e=>setQ(e.target.value)}/></label></div>
    {agents===null?<div className="lv-state"><span className="lv-spin"/>載入中…</div>
    :err&&!agents.length?<div className="lv-state">無法載入 Agent：{err}<br/><button className="text-button" onClick={()=>{setAgents(null);load()}}>重試</button></div>
    :!agents.length?<div className="lv-state">{canBuild?'還沒有 Agent。按「建立 Agent」開始。':'目前沒有已發布的 Agent。'}</div>
    :!rows.length?<div className="lv-state">找不到符合「{q}」的 Agent</div>
    :<div className="space-grid">{rows.map(a=><section className="panel agent-card" key={a.id}>
      <span className="tile large"><Cube/></span><h3>{a.name}</h3><p>{a.description||'（無說明）'}</p>
      <div className="lv-badges">{statusBadges(a).map(b=><span key={b} className={'badge '+cls(b)}>{b}</span>)}</div>
      <div className="lv-owner" style={{marginTop:8}}>負責人 {a.owner_email||'—'}</div>
      <div className="card-bottom"><span className="small muted">v{a.version} · {a.model_group}</span>
        {canEditAgent(a,me)?<ShareButton share={a.share} label={'分享 '+a.name} onClick={()=>setSharing(a.id)}/>:null}
        <button className="text-button" onClick={()=>setView({kind:'detail',id:a.id})}>{canEditAgent(a,me)?'開啟':'對話'}<CaretRight/></button></div>
    </section>)}</div>}
    {sharingAgent&&<ShareModal title={sharingAgent.name} value={sharingAgent.share} owner={me.name||me.email} onClose={()=>setSharing(null)}
      onDone={async v=>{
        try{await shareAgent(sharingAgent.id,v);patchLocal({id:sharingAgent.id,share:v});notify('已更新分享設定');setSharing(null)}
        catch(e){notify('分享設定失敗：'+errText(e))}
      }}/>}
  </>;
}
