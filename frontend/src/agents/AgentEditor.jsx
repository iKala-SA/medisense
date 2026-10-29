import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Play,PencilSimple,DotsThree,Check,CircleNotch,Warning,Copy,DownloadSimple,Trash,Eye,CaretDown,ClockCounterClockwise} from '@phosphor-icons/react';
import {api} from '../api';
import {ShareDialog} from '../live/ShareLive';
import {PublishTab,VersionsTab} from '../live/PublishTab';
import {canEditAgent,statusBadges,errText} from '../live/kit';
import SettingsPanel from './SettingsPanel';
import StepCanvas,{StepEditPanel,Tile} from './StepsPanel';
import RunDrawer from './RunDrawer';
import RunView from './RunView';
import {agentToIn,validate,TONE} from './stepkit';
import '../live/agents.css';

const download=(name,obj)=>{const u=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)};
const clock=d=>d?new Date(d).toLocaleTimeString('zh-TW',{hour:'numeric',minute:'2-digit',hour12:true}):'';

function Runs({id,notify}){
  const [list,setList]=useState(null),[cur,setCur]=useState(null);
  useEffect(()=>{api.listStepRuns(id).then(setList).catch(e=>{setList([]);notify(errText(e))})},[id]);// eslint-disable-line
  if(cur)return <div><button className="ag-back" onClick={()=>setCur(null)}><ArrowLeft size={14}/>所有執行</button><RunView run={cur} onChange={setCur} notify={notify}/></div>;
  if(list===null)return <p className="ag-muted">載入中…</p>;
  if(!list.length)return <p className="ag-muted">還沒有執行紀錄。執行一次後會記錄在這裡（只有你看得到）。</p>;
  const open=async r=>{try{setCur(await api.getStepRun(r.id))}catch(e){notify(errText(e))}};
  return <div className="ag-table">{list.map(r=><button key={r.id} className="ag-trow" onClick={()=>open(r)}><b>{new Date(r.started_at).toLocaleString('zh-TW',{hour12:false})}</b>
    <span className={'ag-badge '+r.status}>{{succeeded:'完成',failed:'失敗',waiting_approval:'等待核准',cancelled:'已取消',running:'執行中'}[r.status]||r.status}</span>{r.draft&&<span className="ag-chip">草稿測試</span>}<small>{r.triggered_by}</small></button>)}</div>;
}

export default function AgentEditor({id,me,notify,onBack,onChat,onDeleted,onChanged,initialTab='設定'}){
  const [a,setA]=useState(null),[mode,setMode]=useState('edit'),[sel,setSel]=useState(initialTab==='步驟'?null:'agent'),[save,setSave]=useState('saved'),[savedAt,setSavedAt]=useState(null);
  const [menu,setMenu]=useState(false),[prompt,setPrompt]=useState(false),[share,setShare]=useState(false),[pub,setPub]=useState(false),[hist,setHist]=useState(false);
  const [lib,setLib]=useState({connectors:[],spaces:[],docs:[],features:null});
  const timer=useRef(null),latest=useRef(null),inflight=useRef(Promise.resolve());
  useEffect(()=>{
    api.getAgent(id).then(x=>{const v=blankSafe(x);setA(v);latest.current=v;setSavedAt(x.updated_at);if(initialTab==='步驟'&&v.steps[0])setSel(v.steps[0].id)}).catch(e=>{notify(errText(e));onBack()});
    Promise.allSettled([api.listConnectors(),api.listSpaces(),api.listDocs(),api.features()]).then(([c,s,d,f])=>setLib({connectors:c.value||[],spaces:(s.value||[]).map(x=>({id:x.id,name:x.name})),docs:(d.value||[]).filter(x=>x.status!=='failed').map(x=>({id:x.id,name:x.name})),features:f.value||null}));
  },[id]);// eslint-disable-line
  const canEdit=canEditAgent(a,me);
  const flush=useCallback(()=>{
    clearTimeout(timer.current);const cur=latest.current;if(!cur)return Promise.resolve();
    setSave('saving');
    inflight.current=inflight.current.then(()=>api.updateAgent(id,agentToIn(cur))).then(r=>{setSave('saved');setSavedAt(new Date().toISOString());onChanged?.(r)}).catch(e=>{setSave('error');notify('儲存失敗：'+errText(e))});
    return inflight.current;
  },[id]);// eslint-disable-line
  const edit=p=>setA(prev=>{const n={...prev,...p};latest.current=n;if(canEdit){setSave('dirty');clearTimeout(timer.current);timer.current=setTimeout(flush,1200)}return n});
  useEffect(()=>()=>{clearTimeout(timer.current)},[]);
  useEffect(()=>{const h=e=>{if(save==='dirty'||save==='saving'){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h)},[save]);
  if(!a)return <div className="ag-loading"><CircleNotch className="spin" size={20}/>載入中…</div>;
  const problems=validate(a.steps||[]),errs=problems.filter(p=>p.level==='error').length;
  const back=async()=>{await flush();onBack()};
  const duplicate=async()=>{try{const n=await api.createAgent({...agentToIn(a),name:(a.name+' (複本)').slice(0,50),share:undefined});notify('已複製為新草稿');onChanged?.(n);onBack(n.id)}catch(e){notify(errText(e))}};
  const remove=async()=>{if(!window.confirm(`刪除「${a.name}」？此動作無法復原。`))return;try{await api.deleteAgent(id);onDeleted?.(id)}catch(e){notify(errText(e))}};
  const badges=statusBadges(a),status=badges.includes('待審核')?['待審核','warn']:badges.includes('已退回')?['已退回','bad']:a.status==='published'?['已發布 v'+a.version,'ok']:['草稿',''];
  const tools=<>
    <div className="ag-modes" role="tablist"><button role="tab" aria-selected={mode==='edit'} className={mode==='edit'?'on':''} onClick={()=>setMode('edit')}><PencilSimple size={16}/>編輯器</button>
      <button role="tab" aria-selected={mode==='run'} className={mode==='run'?'on':''} onClick={async()=>{await flush();setMode('run')}}><Play size={16}/>執行模式</button></div>
    <button className="ag-icon bordered" title="執行紀錄" aria-label="執行紀錄" onClick={()=>setHist(true)}><ClockCounterClockwise size={18}/></button>
    <button className="ag-btn big" onClick={()=>setShare(true)} disabled={!canEdit}>分享</button>
    <button className="ag-btn big primary" onClick={async()=>{await flush();setPub(true)}}>發布</button>
    <div className="ag-menuwrap"><button className="ag-icon" aria-label="更多" aria-haspopup="menu" onClick={()=>setMenu(m=>!m)}><DotsThree size={22} weight="bold"/></button>
      {menu&&<><div className="ag-dismiss" onClick={()=>setMenu(false)}/><div className="ag-menu" role="menu" onClick={()=>setMenu(false)}>
        {a.status==='published'&&<button role="menuitem" onClick={()=>onChat(a)}><Eye size={16}/>開始對話</button>}
        {a.original_prompt&&<button role="menuitem" onClick={()=>setPrompt(true)}><Eye size={16}/>查看原始提示詞</button>}
        <button role="menuitem" onClick={()=>download((a.name||'agent')+'.json',agentToIn(a))}><DownloadSimple size={16}/>匯出 JSON</button>
        <button role="menuitem" onClick={duplicate}><Copy size={16}/>複製為新草稿</button>
        {canEdit&&<><hr/><button role="menuitem" className="danger" onClick={remove}><Trash size={16}/>刪除</button></>}</div></>}</div>
  </>;
  return <div className="ag-editor v2">
    <header className="ag-top">
      <button className="ag-back" onClick={back}><ArrowLeft size={14}/>所有 Agent</button>
      <div className="ag-toprow">
        <div className="ag-titlebox">
          <div className="ag-line"><input className="ag-name big" value={a.name} maxLength={50} disabled={!canEdit} aria-label="名稱" onChange={e=>edit({name:e.target.value})}/>
            <button className={'ag-status '+status[1]} onClick={async()=>{await flush();setPub(true)}} title="發布狀態">{status[0]}<CaretDown size={13} weight="bold"/></button>
            <span className={'ag-save '+save} role="status">{save==='saving'?<><CircleNotch className="spin" size={14}/>儲存中</>:save==='dirty'?'編輯中…':save==='error'?<><Warning size={14}/>未儲存</>:<><Check size={14}/>儲存於 {clock(savedAt)}</>}</span></div>
          <input className="ag-desc" value={a.description||''} maxLength={300} disabled={!canEdit} placeholder="新增描述（顯示在目錄與切換器）" aria-label="描述" onChange={e=>edit({description:e.target.value})}/></div>
        <div className="ag-tools">{tools}</div>
      </div>
    </header>
    {mode==='edit'?<div className="ag-canvas">
      <div className="ag-left">
        {sel==='agent'||!sel||!a.steps.some(s=>s.id===sel)
          ?<div className="ag-editcard"><h3><Tile tone="agent" size={40}><span className="em">{a.icon||'✦'}</span></Tile>編輯 Agent</h3>
            <SettingsPanel a={a} set={edit} canEdit={canEdit} features={lib.features} connectors={lib.connectors} spaces={lib.spaces} docs={lib.docs}/></div>
          :<StepEditPanel steps={a.steps} setSteps={s=>edit({steps:s})} sel={sel} setSel={setSel} connectors={lib.connectors} canEdit={canEdit}/>}
      </div>
      <StepCanvas steps={a.steps} setSteps={s=>edit({steps:s})} sel={sel||'agent'} setSel={setSel} connectors={lib.connectors} canEdit={canEdit} agent={a}/>
    </div>
    :<div className="ag-canvas run"><RunDrawer inline agent={a} notify={notify} onClose={()=>setMode('edit')}/></div>}
    {hist&&<div className="ag-modal" onClick={()=>setHist(false)}><div className="ag-dialog wide" onClick={e=>e.stopPropagation()}><h3>執行紀錄</h3><Runs id={id} notify={notify}/><div><button className="ag-btn" onClick={()=>setHist(false)}>關閉</button></div></div></div>}
    {pub&&<div className="ag-modal" onClick={()=>setPub(false)}><div className="ag-dialog wide" onClick={e=>e.stopPropagation()}><h3>發布與版本</h3>
      {errs>0&&<div className="ag-banner err"><Warning size={16}/><div>步驟有 {errs} 個錯誤，修正後才能發布。</div></div>}
      <PublishTab agent={a} me={me} editable={canEdit} dirty={save==='dirty'||save==='saving'} onSave={flush} notify={notify}
        onAgent={r=>{setA(x=>({...x,...r,steps:x.steps,capabilities:x.capabilities,opening_questions:x.opening_questions}));onChanged?.(r)}}/><VersionsTab agent={a}/>
      <div><button className="ag-btn" onClick={()=>setPub(false)}>關閉</button></div></div></div>}
    {prompt&&<div className="ag-modal" onClick={()=>setPrompt(false)}><div className="ag-dialog" onClick={e=>e.stopPropagation()}><h3>原始提示詞</h3><p className="ag-muted">建立這個 Agent 時你輸入的內容（唯讀）。</p><pre>{a.original_prompt}</pre><div><button className="ag-btn" onClick={()=>setPrompt(false)}>關閉</button></div></div></div>}
    {share&&<ShareDialog title={a.name} value={a.share} owner={a.owner_email} onClose={()=>setShare(false)} onDone={async v=>{try{const r=await api.shareAgent(id,v);setA(x=>({...x,share:r?.share||v}));notify('已更新分享設定');setShare(false)}catch(e){notify(errText(e))}}}/>}
  </div>;
}
const blankSafe=x=>({...x,capabilities:{web_search:false,spaces:[],connectors:[],model_pref:'balanced',thinking:'low',...(x.capabilities||{})},steps:x.steps||[],opening_questions:x.opening_questions||[],icon:x.icon||'',original_prompt:x.original_prompt||''});
