import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Play,DotsThree,Check,CircleNotch,Warning,Copy,DownloadSimple,Export,Trash,Eye} from '@phosphor-icons/react';
import {api} from '../api';
import {ShareDialog} from '../live/ShareLive';
import {PublishTab,VersionsTab} from '../live/PublishTab';
import {canEditAgent,statusBadges,errText} from '../live/kit';
import SettingsPanel from './SettingsPanel';
import StepsPanel from './StepsPanel';
import RunDrawer from './RunDrawer';
import RunView from './RunView';
import {agentToIn,validate} from './stepkit';
import '../live/agents.css';

const TABS=['設定','步驟','執行紀錄','發布與版本'];
const download=(name,obj)=>{const u=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)};

function Runs({id,notify}){
  const [list,setList]=useState(null),[cur,setCur]=useState(null);
  useEffect(()=>{api.listStepRuns(id).then(setList).catch(e=>{setList([]);notify(errText(e))})},[id]);// eslint-disable-line
  if(cur)return <div><button className="ag-back" onClick={()=>setCur(null)}><ArrowLeft size={14}/>所有執行</button><RunView run={cur} onChange={setCur} notify={notify}/></div>;
  if(list===null)return <p className="ag-muted">載入中…</p>;
  if(!list.length)return <p className="ag-muted center">還沒有執行紀錄。按「測試執行」跑一次，結果會記錄在這裡（只有你看得到）。</p>;
  const open=async r=>{try{setCur(await api.getStepRun(r.id))}catch(e){notify(errText(e))}};
  return <div className="ag-table">{list.map(r=><button key={r.id} className="ag-trow" onClick={()=>open(r)}><b>{new Date(r.started_at).toLocaleString('zh-TW',{hour12:false})}</b>
    <span className={'ag-badge '+r.status}>{{succeeded:'完成',failed:'失敗',waiting_approval:'等待核准',cancelled:'已取消',running:'執行中'}[r.status]||r.status}</span>{r.draft&&<span className="ag-chip">草稿測試</span>}<small>{r.triggered_by}</small></button>)}</div>;
}

export default function AgentEditor({id,me,notify,onBack,onChat,onDeleted,onChanged,initialTab='設定'}){
  const [a,setA]=useState(null),[tab,setTab]=useState(initialTab),[save,setSave]=useState('saved'),[run,setRun]=useState(false),[menu,setMenu]=useState(false),[prompt,setPrompt]=useState(false),[share,setShare]=useState(false);
  const [lib,setLib]=useState({connectors:[],spaces:[],docs:[],features:null});
  const first=useRef(true),timer=useRef(null),latest=useRef(null),inflight=useRef(Promise.resolve());
  useEffect(()=>{
    api.getAgent(id).then(x=>{setA({...blankSafe(x)});latest.current=blankSafe(x)}).catch(e=>{notify(errText(e));onBack()});
    Promise.allSettled([api.listConnectors(),api.listSpaces(),api.listDocs(),api.features()]).then(([c,s,d,f])=>setLib({connectors:c.value||[],spaces:(s.value||[]).map(x=>({id:x.id,name:x.name})),docs:(d.value||[]).filter(x=>x.status!=='failed').map(x=>({id:x.id,name:x.name})),features:f.value||null}));
  },[id]);// eslint-disable-line
  const canEdit=canEditAgent(a,me)||(a&&a.my_role==='editor');
  const flush=useCallback(()=>{
    clearTimeout(timer.current);const cur=latest.current;if(!cur)return Promise.resolve();
    setSave('saving');
    inflight.current=inflight.current.then(()=>api.updateAgent(id,agentToIn(cur))).then(r=>{setSave('saved');onChanged?.(r)}).catch(e=>{setSave('error');notify('儲存失敗：'+errText(e))});
    return inflight.current;
  },[id]);// eslint-disable-line
  const edit=p=>setA(prev=>{const n={...prev,...p};latest.current=n;if(canEdit){setSave('dirty');clearTimeout(timer.current);timer.current=setTimeout(flush,1200)}return n});
  useEffect(()=>()=>{clearTimeout(timer.current)},[]);
  useEffect(()=>{const h=e=>{if(save==='dirty'||save==='saving'){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h)},[save]);
  if(!a)return <div className="ag-loading"><CircleNotch className="spin" size={20}/>載入中…</div>;
  const problems=validate(a.steps||[]),errs=problems.filter(p=>p.level==='error').length;
  const back=async()=>{await flush();onBack()};
  const duplicate=async()=>{
    try{const n=await api.createAgent({...agentToIn(a),name:(a.name+' (複本)').slice(0,50),share:undefined});notify('已複製為新草稿');onChanged?.(n);onBack(n.id)}catch(e){notify(errText(e))}
  };
  const remove=async()=>{if(!window.confirm(`刪除「${a.name}」？此動作無法復原。`))return;try{await api.deleteAgent(id);onDeleted?.(id)}catch(e){notify(errText(e))}};
  const badges=statusBadges(a);
  return <div className="ag-editor">
    <header className="ag-ehead">
      <button className="ag-back" onClick={back}><ArrowLeft size={14}/>所有 Agent</button>
      <div className="ag-title">
        <span className="ag-icon-tile">{a.icon||'✦'}</span>
        <div className="grow"><input className="ag-name" value={a.name} maxLength={50} disabled={!canEdit} aria-label="名稱" onChange={e=>edit({name:e.target.value})}/>
          <input className="ag-desc" value={a.description||''} maxLength={300} disabled={!canEdit} placeholder="新增描述（顯示在目錄與切換器）" aria-label="描述" onChange={e=>edit({description:e.target.value})}/></div>
        <div className="ag-badges">{badges.map(b=><span key={b} className={'ag-badge '+({'已發布':'ok','待審核':'warn','已退回':'bad'}[b]||'')}>{b}{b==='已發布'?` v${a.version}`:''}</span>)}</div>
        <span className={'ag-save '+save} role="status">{save==='saving'?<><CircleNotch className="spin" size={13}/>儲存中</>:save==='dirty'?'編輯中…':save==='error'?<><Warning size={13}/>未儲存</>:<><Check size={13}/>已儲存</>}</span>
        <div className="ag-actions">
          <button className="ag-btn" onClick={async()=>{await flush();setRun(true)}}><Play size={15} weight="fill"/>測試執行</button>
          {a.status==='published'&&<button className="ag-btn" onClick={()=>onChat(a)}>開始對話</button>}
          <div className="ag-menuwrap"><button className="ag-icon" aria-label="更多" aria-haspopup="menu" onClick={()=>setMenu(m=>!m)}><DotsThree size={20} weight="bold"/></button>
            {menu&&<><div className="ag-dismiss" onClick={()=>setMenu(false)}/><div className="ag-menu" role="menu" onClick={()=>setMenu(false)}>
              {a.original_prompt&&<button role="menuitem" onClick={()=>setPrompt(true)}><Eye size={16}/>查看原始提示詞</button>}
              <button role="menuitem" onClick={()=>download((a.name||'agent')+'.json',agentToIn(a))}><DownloadSimple size={16}/>匯出 JSON</button>
              <button role="menuitem" onClick={duplicate}><Copy size={16}/>複製為新草稿</button>
              {canEdit&&<button role="menuitem" onClick={()=>setShare(true)}><Export size={16}/>分享</button>}
              {canEdit&&<><hr/><button role="menuitem" className="danger" onClick={remove}><Trash size={16}/>刪除</button></>}</div></>}</div>
        </div>
      </div>
      <div className="ag-tabs" role="tablist">{TABS.map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'on':''} onClick={()=>setTab(t)}>{t}{t==='步驟'&&(a.steps?.length?<em className={errs?'bad':''}>{a.steps.length}</em>:null)}</button>)}</div>
    </header>
    <div className="ag-ebody">
      {tab==='設定'&&<SettingsPanel a={a} set={edit} canEdit={canEdit} features={lib.features} connectors={lib.connectors} spaces={lib.spaces} docs={lib.docs}/>}
      {tab==='步驟'&&<StepsPanel steps={a.steps||[]} setSteps={s=>edit({steps:s})} connectors={lib.connectors} canEdit={canEdit}/>}
      {tab==='執行紀錄'&&<Runs id={id} notify={notify}/>}
      {tab==='發布與版本'&&<div className="ag-pub"><PublishTab agent={a} me={me} editable={canEdit} dirty={save==='dirty'||save==='saving'} onSave={flush} notify={notify}
        onAgent={r=>{setA(x=>({...x,...r,steps:x.steps,capabilities:x.capabilities,opening_questions:x.opening_questions}));onChanged?.(r)}}/><VersionsTab agent={a}/></div>}
    </div>
    {run&&<RunDrawer agent={a} notify={notify} onClose={()=>setRun(false)}/>}
    {prompt&&<div className="ag-modal" onClick={()=>setPrompt(false)}><div className="ag-dialog" onClick={e=>e.stopPropagation()}><h3>原始提示詞</h3><p className="ag-muted">建立這個 Agent 時你輸入的內容（唯讀）。</p><pre>{a.original_prompt}</pre><div><button className="ag-btn" onClick={()=>setPrompt(false)}>關閉</button></div></div></div>}
    {share&&<ShareDialog title={a.name} value={a.share} owner={a.owner_email} onClose={()=>setShare(false)} onDone={async v=>{try{const r=await api.shareAgent(id,v);setA(x=>({...x,share:r?.share||v}));notify('已更新分享設定');setShare(false)}catch(e){notify(errText(e))}}}/>}
  </div>;
}
const blankSafe=x=>({...x,capabilities:{web_search:false,spaces:[],connectors:[],model_pref:'balanced',thinking:'low',...(x.capabilities||{})},steps:x.steps||[],opening_questions:x.opening_questions||[],icon:x.icon||'',original_prompt:x.original_prompt||''});
