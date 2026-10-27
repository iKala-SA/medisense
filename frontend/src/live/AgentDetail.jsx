import React,{useCallback,useEffect,useState} from 'react';
import {ArrowLeft,FloppyDisk,Trash} from '@phosphor-icons/react';
import {api} from '../api';
import {errText,toAgentIn,canEditAgent,statusBadges} from './kit';
import SettingsTab from './SettingsTab';
import BuildTab from './BuildTab';
import SandboxTab from './SandboxTab';
import {PublishTab,VersionsTab} from './PublishTab';

const cls=b=>b==='待審核'?'lv-badge-warn':b==='已退回'?'lv-badge-bad':b==='已發布'?'lv-badge-ok':'';

export default function AgentDetail({id,me,notify,onBack,onChanged,onDeleted,initialTab}){
  const [agent,setAgent]=useState(null),[err,setErr]=useState(''),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false);
  const editable=canEditAgent(agent,me);
  const tabs=editable?['設定','建置','沙盒測試','發布流程','版本記錄']:['沙盒測試','版本記錄'];
  const [tab,setTab]=useState(initialTab||'設定'),[visited,setVisited]=useState({});
  useEffect(()=>{
    let live=true;setAgent(null);setErr('');setDirty(false);
    api.getAgent(id).then(a=>{if(live)setAgent(a)}).catch(e=>{if(live){setErr(errText(e));notify('載入 Agent 失敗：'+errText(e))}});
    return()=>{live=false};
  },[id]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(agent&&!tabs.includes(tab))setTab(tabs[0])},[agent]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{setVisited(v=>({...v,[tab]:true}))},[tab]);
  const patch=useCallback(p=>{setAgent(a=>a?{...a,...p}:a);setDirty(true)},[]);
  const applyServer=a=>{setAgent(a);setDirty(false);onChanged?.(a)};
  const save=async()=>{
    if(!agent||saving)return;
    if(!agent.name.trim()){notify('名稱不可為空');return}
    setSaving(true);
    try{applyServer(await api.updateAgent(agent.id,toAgentIn(agent)));notify('已儲存草稿')}
    catch(e){notify('儲存失敗：'+errText(e))}finally{setSaving(false)}
  };
  const remove=async()=>{
    if(!window.confirm(`刪除「${agent.name}」？此動作無法復原。`))return;
    try{await api.deleteAgent(agent.id);notify('已刪除 Agent');onDeleted?.(agent.id)}catch(e){notify('刪除失敗：'+errText(e))}
  };
  if(!agent)return <><button className="text-button muted" onClick={onBack}><ArrowLeft/>所有 Agent</button>
    <div className="lv-state">{err?<>無法載入：{err}</>:<><span className="lv-spin"/>載入中…</>}</div></>;
  const badges=statusBadges(agent);
  return <>
    <button className="text-button muted" onClick={onBack}><ArrowLeft/>所有 Agent</button>
    <div className="page-heading"><h1 className="report-title">{agent.name}</h1>
      <div className="lv-badges">{badges.map(b=><span key={b} className={'badge '+cls(b)}>{b}</span>)}<span className="badge">v{agent.version}</span></div></div>
    <div className="tabline"><div className="tabs">{tabs.map(t=><button key={t} className={tab===t?'selected':''} onClick={()=>setTab(t)}>{t}</button>)}</div>
      {editable&&<div className="lv-badges">{dirty&&<span className="badge lv-badge-warn">未儲存變更</span>}
        <button className="btn" onClick={remove}><Trash/>刪除</button>
        <button className="btn primary" disabled={!dirty||saving} onClick={save}><FloppyDisk/>{saving?'儲存中…':'儲存'}</button></div>}</div>
    {!editable&&<div className="lv-banner info" style={{marginBottom:14}}>此 Agent 由 {agent.owner_email} 負責；你可以與已發布版本對話。</div>}
    {tab==='設定'&&<SettingsTab agent={agent} patch={patch} editable={editable} notify={notify}/>}
    {tab==='建置'&&<BuildTab agent={agent} patch={patch} editable={editable}/>}
    {visited['沙盒測試']&&<div style={{display:tab==='沙盒測試'?'block':'none'}}><SandboxTab agent={agent} editable={editable} dirty={dirty} onSave={save} notify={notify}/></div>}
    {tab==='發布流程'&&<PublishTab agent={agent} me={me} editable={editable} dirty={dirty} onSave={save} onAgent={a=>{setAgent(x=>({...a,...(dirty?{...x,review:a.review,status:a.status,version:a.version,published_at:a.published_at,approved_by_email:a.approved_by_email,updated_at:a.updated_at}:{})}));onChanged?.(a)}} notify={notify}/>}
    {tab==='版本記錄'&&<VersionsTab agent={agent}/>}
  </>;
}
