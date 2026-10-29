import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,PaperPlaneRight,CircleNotch,Sparkle,ListChecks,Globe,Plugs,BookOpen,Warning} from '@phosphor-icons/react';
import {api} from '../api';
import {errText} from '../live/kit';
import {STEP_TYPES,blankAgent} from './stepkit';

const IDEAS=['每週一自動彙整急診科的客訴信，分類後寄給護理長','幫藥劑部做一個查詢院內藥品規範的助理，只能查院內文件','上傳合約後比對內部規範，標出風險條款'];

/* Build an agent by conversation (PRD §4.1): chat on the left, the settings it produced on the right. Nothing is saved until 「建立草稿」. */
export default function CreateChat({notify,onBack,onCreated}){
  const [msgs,setMsgs]=useState([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[draft,setDraft]=useState(null),[problems,setProblems]=useState([]),[saving,setSaving]=useState(false);
  const end=useRef(null),said=useRef([]);
  useEffect(()=>{end.current?.scrollIntoView({block:'end'})},[msgs,busy]);
  const send=async(t=text)=>{
    t=t.trim();if(!t||busy)return;setText('');setMsgs(m=>[...m,{role:'user',content:t}]);said.current.push(t);setBusy(true);
    try{const r=await api.draftAgent(t,draft,msgs.map(m=>({role:m.role,content:m.content})));setDraft(r.agent);setProblems(r.problems||[]);setMsgs(m=>[...m,{role:'assistant',content:r.reply}])}
    catch(e){setMsgs(m=>[...m,{role:'error',content:'這次沒有成功產生設定：'+errText(e)+'。可以換個說法再試一次。'}])}finally{setBusy(false)}
  };
  const create=async()=>{
    setSaving(true);
    try{const a=await api.createAgent({...blankAgent(),...draft,original_prompt:said.current.join('\n\n').slice(0,4000)});notify('已建立草稿，可以繼續調整');onCreated(a.id)}
    catch(e){notify(errText(e));setSaving(false)}
  };
  const errs=problems.filter(p=>p.level==='error');
  return <div className="ag-create">
    <header className="ag-ehead slim"><button className="ag-back" onClick={onBack}><ArrowLeft size={14}/>所有 Agent</button><h2>用對話建立 Agent</h2></header>
    <div className="ag-cgrid">
      <section className="ag-cchat">
        <div className="ag-cmsgs">
          {!msgs.length&&<div className="ag-cempty"><Sparkle size={26} weight="fill"/><h3>你想建立什麼樣的助理？</h3><p>用一兩句話描述目標，我會產生角色指令、能力與步驟流程，右邊可以即時看到，也能繼續用對話修改。</p>
            <div>{IDEAS.map(i=><button key={i} onClick={()=>send(i)}>{i}</button>)}</div></div>}
          {msgs.map((m,i)=><div key={i} className={'ag-msg '+m.role}>{m.content}</div>)}
          {busy&&<div className="ag-msg assistant"><CircleNotch className="spin" size={14}/> 正在產生設定…</div>}
          <div ref={end}/>
        </div>
        <div className="ag-cinput"><textarea rows={2} value={text} placeholder={draft?'繼續描述想修改的地方…':'描述你想建立的 Agent…'} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/>
          <button className="ag-icon primary" aria-label="送出" disabled={busy||!text.trim()} onClick={()=>send()}><PaperPlaneRight size={17} weight="fill"/></button></div>
        <small className="ag-muted">請勿輸入病人姓名或證號；內容會先去識別化再送給模型。</small>
      </section>
      <section className="ag-cpreview">
        {!draft?<p className="ag-muted center">設定草稿會顯示在這裡。</p>:<>
          <div className="ag-pv-head"><span className="ag-icon-tile">{draft.icon||'✦'}</span><div><h3>{draft.name}</h3><p>{draft.description}</p></div></div>
          <h5>角色指令</h5><pre className="ag-pv-ins">{draft.instructions}</pre>
          {draft.opening_questions?.length>0&&<><h5>範例問題</h5><ul>{draft.opening_questions.map((q,i)=><li key={i}>{q}</li>)}</ul></>}
          <h5>能力</h5><div className="ag-chips">{draft.capabilities.web_search&&<span className="ag-chip big"><Globe size={13}/>網路搜尋</span>}
            {draft.capabilities.connectors.map((c,i)=><span key={i} className="ag-chip big"><Plugs size={13}/>{c.action}</span>)}{draft.capabilities.spaces.map(s=><span key={s} className="ag-chip big"><BookOpen size={13}/>知識空間</span>)}
            {!draft.capabilities.web_search&&!draft.capabilities.connectors.length&&!draft.capabilities.spaces.length&&<span className="ag-muted">純對話，沒有額外能力</span>}</div>
          <h5>步驟流程 {draft.steps.length?`（${draft.steps.length}）`:''}</h5>
          {draft.steps.length?<ol className="ag-pv-steps">{draft.steps.map(s=>{const I=(STEP_TYPES[s.type]||{}).icon||ListChecks;return <li key={s.id}><I size={15}/><b>{s.title}</b><small>{(STEP_TYPES[s.type]||{}).label}</small></li>})}</ol>:<p className="ag-muted">沒有固定流程，這是一個對話型 Agent。</p>}
          {errs.length>0&&<div className="ag-banner warn"><Warning size={15}/><div>草稿還有 {errs.length} 個地方需要在編輯器補上：<ul>{errs.slice(0,4).map((p,i)=><li key={i}>{p.message}</li>)}</ul></div></div>}
          <button className="ag-btn primary wide" disabled={saving} onClick={create}>{saving?<CircleNotch className="spin" size={15}/>:null}建立草稿並繼續編輯</button></>}
      </section>
    </div>
  </div>;
}
