import React,{useEffect,useState} from 'react';
import {Plus,Trash,Play,ArrowLeft,PencilSimple} from '@phosphor-icons/react';
import {api} from '../api';
import {Toggle,ListToolbar,Field,Empty} from '../ListKit';
import {ShareDialog,ShareChip} from './ShareLive';
import {errText} from './kit';
import {canEdit,canOwn,fmtDate,match,useLoad,State,ROLE_LABEL} from './workkit';
import './work.css';

export const FREQ={daily:'每日',weekdays:'每個工作日',weekly_mon:'每週一',monthly_1:'每月 1 日'};

function Editor({initial,agents,onCancel,onSave,busy,readOnly}){
  const [f,setF]=useState(()=>initial?{name:initial.name,agent_id:initial.agent_id,frequency:initial.frequency,time:initial.time,prompt:initial.prompt}:{name:'',agent_id:agents[0]?.id||'',frequency:'daily',time:'09:00',prompt:''});
  const set=k=>e=>setF(a=>({...a,[k]:e.target.value}));
  const known=agents.some(a=>a.id===f.agent_id);
  const valid=f.name.trim()&&f.agent_id&&f.time&&f.prompt.trim();
  return <>
    <div className="lv-w-bar"><button className="lv-w-back" onClick={onCancel}><ArrowLeft size={18}/>排程</button></div>
    <form className="lv-w-form" onSubmit={e=>{e.preventDefault();if(valid&&!readOnly)onSave({...f,name:f.name.trim(),prompt:f.prompt.trim()})}}>
      <h2 style={{margin:0}}>{initial?(readOnly?'檢視排程':'編輯排程'):'新增排程'}</h2>
      <Field label="排程名稱"><input required maxLength={80} disabled={readOnly} value={f.name} onChange={set('name')} placeholder="例如：每週交班重點彙整"/></Field>
      <Field label="執行 Agent"><select required disabled={readOnly} value={f.agent_id} onChange={set('agent_id')}>
        {!known&&f.agent_id&&<option value={f.agent_id}>{f.agent_id}（無法存取的 Agent）</option>}
        {agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <div className="inline"><Field label="頻率"><select disabled={readOnly} value={f.frequency} onChange={set('frequency')}>{Object.entries(FREQ).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="時間（Asia/Taipei，台北時間）"><input type="time" required disabled={readOnly} value={f.time} onChange={set('time')}/></Field></div>
      <Field label="任務指示"><textarea rows={5} required maxLength={20000} disabled={readOnly} value={f.prompt} onChange={set('prompt')} placeholder="描述 Agent 每次要完成的工作"/></Field>
      <p className="lv-w-note">排程會以擁有者的身分執行，對話紀錄會出現在擁有者的對話中，標題為「[排程] 名稱」。</p>
      <div className="modal-actions"><button type="button" className="btn" onClick={onCancel}>{readOnly?'返回':'取消'}</button>{!readOnly&&<button className="btn primary" disabled={!valid||busy}>{busy?'儲存中…':'儲存'}</button>}</div>
    </form></>;
}

/** 排程 (live). Props: me = GET /api/me; notify(message). */
export default function SchedulesPage({me,notify}){
  const [items,setItems,reload,err]=useLoad(api.listSchedules,'排程',notify);
  const [agents,setAgents]=useState(null);
  const [q,setQ]=useState(''),[tab,setTab]=useState('全部'),[view,setView]=useState(null),[sharing,setSharing]=useState(null),[busy,setBusy]=useState(false),[running,setRunning]=useState(null);
  useEffect(()=>{api.listAgents().then(a=>setAgents(a||[])).catch(e=>{setAgents([]);notify('載入 Agent 失敗：'+errText(e))})},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const agentName=id=>(agents||[]).find(a=>a.id===id)?.name||(agents===null?'…':id);
  const put=s=>setItems(a=>(a||[]).map(x=>x.id===s.id?{...x,...s}:x));

  const save=async f=>{
    if(busy)return;setBusy(true);
    try{
      if(view==='new'){const s=await api.createSchedule({...f,enabled:true});setItems(a=>[s,...(a||[])]);notify('已建立排程')}
      else{put(await api.updateSchedule(view.id,{...f,enabled:view.enabled}));notify('已更新排程')}
      setView(null);
    }catch(e){notify('儲存失敗：'+errText(e))}finally{setBusy(false)}
  };
  const toggle=async(s,on)=>{put({id:s.id,enabled:on});try{put(await api.setScheduleEnabled(s.id,on))}catch(e){put({id:s.id,enabled:!on});notify('切換失敗：'+errText(e))}};
  const run=async s=>{
    setRunning(s.id);
    try{
      const r=await api.runScheduleNow(s.id);
      put({id:s.id,last_run:{at:new Date().toISOString(),status:r.status,session_id:r.session_id,error:r.error}});
      notify(r.status==='ok'?`「${s.name}」執行完成，對話已出現在你的對話紀錄中`:`「${s.name}」執行失敗：${r.error||'未知錯誤'}`);
    }catch(e){notify('執行失敗：'+errText(e))}finally{setRunning(null)}
  };
  const del=async s=>{
    if(!window.confirm(`刪除排程「${s.name}」？此動作無法復原。`))return;
    try{await api.deleteSchedule(s.id);setItems(a=>a.filter(x=>x.id!==s.id));notify('已刪除排程')}catch(e){notify('刪除失敗：'+errText(e))}
  };

  if(view){
    if(agents===null)return <State text="載入 Agent…"/>;
    return <Editor key={view==='new'?'new':view.id} initial={view==='new'?null:view} agents={agents} busy={busy} readOnly={view!=='new'&&!canEdit(view)} onCancel={()=>setView(null)} onSave={save}/>;
  }
  const rows=(items||[]).filter(s=>(tab==='全部'||(tab==='執行中')===!!s.enabled)&&match(s.name+agentName(s.agent_id),q));
  const sharingItem=sharing&&(items||[]).find(x=>x.id===sharing);
  return <>
    <div className="page-heading"><h1>排程</h1><button className="btn primary" onClick={()=>setView('new')}><Plus/>新增排程</button></div>
    <p className="subtitle">讓 Agent 依排程自動執行例行工作（台北時間）。</p>
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋排程或 Agent" tabs={['全部','執行中','已暫停']} tab={tab} onTab={setTab}/>
    {items===null?<State/>:err&&!items.length?<State err={err} onRetry={reload}/>:
    <div className="lt" style={{'--cols':'minmax(150px,1.4fr) minmax(120px,1fr) 140px 150px 140px 70px 110px'}}>
      <div className="lt-head"><span>名稱</span><span>Agent</span><span>頻率</span><span>最近執行</span><span>分享對象</span><span>啟用</span><span/></div>
      {rows.map(s=><div className="lt-row" key={s.id}>
        <span><button className="text-button" onClick={()=>setView(s)}><b>{s.name}</b></button> <span className="lv-w-role">{ROLE_LABEL[s.my_role]||s.my_role}</span></span>
        <span>{agentName(s.agent_id)}</span>
        <span>{FREQ[s.frequency]||s.frequency} {s.time}</span>
        <span className="small">{s.last_run?<><span className={s.last_run.status==='ok'?'lv-w-ok':'lv-w-bad'}>{s.last_run.status==='ok'?'成功':'失敗'}</span> <span className="muted">{fmtDate(s.last_run.at)}</span>{s.last_run.status!=='ok'&&s.last_run.error&&<div className="lv-w-bad" title={s.last_run.error}>{s.last_run.error.slice(0,40)}</div>}</>:<span className="muted">尚未執行</span>}</span>
        <ShareChip share={s.share} label={'分享 '+s.name} onClick={()=>setSharing(s.id)}/>
        {canEdit(s)?<Toggle on={!!s.enabled} label={'啟用 '+s.name} onChange={v=>toggle(s,v)}/>:<span className="muted small">{s.enabled?'執行中':'已暫停'}</span>}
        <span className="lt-actions">
          {canEdit(s)&&<><button className="icon-btn" aria-label={'立即執行 '+s.name} title="立即執行（以擁有者身分）" disabled={running===s.id} onClick={()=>run(s)}><Play/></button>
          <button className="icon-btn" aria-label={'編輯 '+s.name} onClick={()=>setView(s)}><PencilSimple/></button></>}
          {canOwn(s)&&<button className="icon-btn" aria-label={'刪除 '+s.name} onClick={()=>del(s)}><Trash/></button>}
        </span>
      </div>)}
      {!rows.length&&<Empty text={items.length?'沒有符合的排程':'還沒有排程'}/>}
    </div>}
    {sharingItem&&<ShareDialog title={sharingItem.name} value={sharingItem.share} owner={sharingItem.owner_email||me.email}
      onClose={()=>setSharing(null)} onDone={async v=>{
        if(!canOwn(sharingItem)){notify('只有擁有者或管理員可以變更分享設定');setSharing(null);return}
        try{put(await api.shareSchedule(sharingItem.id,v));notify('已更新分享設定');setSharing(null)}catch(e){notify('分享設定失敗：'+errText(e))}
      }}/>}
  </>;
}
