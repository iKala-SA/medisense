import React,{Suspense,lazy,useCallback,useEffect,useState} from 'react';
import {ArrowClockwise,Sparkle,WarningCircle,CalendarBlank,EnvelopeSimple,Plus,Trash,ListChecks,Check,X,ArrowSquareOut,MapPin,Lightbulb} from '@phosphor-icons/react';
import {Icon} from '@iconify/react';
import calendarIcon from '@iconify-icons/logos/google-calendar';
import gmailIcon from '@iconify-icons/logos/google-gmail';
import {api} from '../api';
import {errText} from './pkit';
import {connectAccount} from './connectFlow';
import './workbench.css';

const LiveCalendar=lazy(()=>import('./LiveCalendar'));
const WD=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
const hm=s=>{const d=new Date(s);return isNaN(d)?'':d.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false})};
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
/* The browser's local time with its UTC offset, so the backend's "today" and "tomorrow" are the user's own. */
function localIso(d=new Date()){
  const off=-d.getTimezoneOffset(),sign=off>=0?'+':'-',a=Math.abs(off);
  return `${ymd(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:00${sign}${String(Math.floor(a/60)).padStart(2,'0')}:${String(a%60).padStart(2,'0')}`;
}

/* 早安 / 午安 / 下午好 / 晚安, with a gentle nudge that fits the hour. */
function greeting(h){
  if(h>=5&&h<11)return ['早安','新的一天，先看看今天有哪些重點。'];
  if(h>=11&&h<13)return ['午安','記得吃午餐，休息一下再繼續。'];
  if(h>=13&&h<18)return ['下午好','忙了一陣子，起來走走、喝杯水吧。'];
  if(h>=18&&h<23)return ['晚上好','辛苦了，看看明天要準備什麼，就早點休息吧。'];
  return ['夜深了','別忘了休息，明天的事明天再處理。'];
}
const eventTime=e=>e.all_day?'全天':`${hm(e.start)}${e.end?` – ${hm(e.end)}`:''}`;
const isTomorrow=e=>{const t=ymd(addDays(new Date(),1));return e.all_day?e.start.slice(0,10)===t:ymd(new Date(e.start))===t};
const mailTime=s=>{const d=new Date(s);if(isNaN(d))return '';return ymd(d)===ymd(new Date())?hm(s):`${d.getMonth()+1}/${d.getDate()} ${hm(s)}`};
const sender=f=>(f||'').replace(/\s*<[^>]+>\s*$/,'').replace(/^"|"$/g,'')||f;
const gmailLink=m=>m.thread_id?`https://mail.google.com/mail/u/0/#inbox/${m.thread_id}`:'https://mail.google.com/';
const SRC_ICON={gmail:gmailIcon,googlecalendar:calendarIcon};
const CACHE='medisense-workbench-brief';

/* ------------------------------------------------------------------ 動態: the AI brief */
function Sources({sources,onConnect,busy}){
  return <div className="wb-sources">{sources.map(s=><span key={s.service} className={'wb-src '+s.state}>
    <Icon icon={SRC_ICON[s.service]} width={16} height={16}/>{s.label}
    {s.state==='connected'?<small>{s.account_label}{s.count!=null&&` · ${s.count} ${s.service==='gmail'?'封郵件':'個行程'}`}</small>
      :<small>{s.reason}</small>}
    {(s.state==='not_connected'||s.state==='reauth_required')&&s.connector_id&&<button className="wb-link" disabled={busy} onClick={()=>onConnect(s)}>{s.state==='reauth_required'?'重新連線':'連線'}</button>}
  </span>)}</div>;
}

function Brief({brief,loading,err,onConnect,busy,go}){
  if(!brief)return loading?<div className="wb-card wb-loading"><span className="lv-spin"/>正在同步 Gmail 與 Google 日曆，並請 AI 整理重點…</div>
    :<div className="wb-card wb-empty">{err||'尚未同步'}</div>;
  const {summary,mails,events,sources}=brief;
  const anyConnected=sources.some(s=>s.state==='connected');
  const tomorrow=summary?.tomorrow?.length?summary.tomorrow.map(t=>({e:events[t.event],prep:t.prep})):events.filter(isTomorrow).map(e=>({e,prep:''}));
  const today=(summary?.today||[]).map(t=>({e:events[t.event],note:t.note}));
  return <>
    <Sources sources={sources} onConnect={onConnect} busy={busy}/>
    {err&&<div className="wb-warn"><WarningCircle size={16}/>{err}</div>}
    {!anyConnected?<div className="wb-card wb-empty"><b>連線 Gmail 與 Google 日曆後，AI 會在這裡幫你整理每天的重點</b>
      <p>包括需要儘快處理的郵件、今天剩下的行程，以及明天的會議要準備什麼。</p>
      {go&&<button className="btn" onClick={()=>go('Connectors')}>前往連接器</button>}</div>
    :<>
      <section className={'wb-card wb-headline'+(loading?' stale':'')}>
        <span className="wb-ai"><Sparkle size={14} weight="fill"/>AI 摘要</span>
        <h2>{summary?.headline||(mails.length||events.length?'今天沒有特別需要注意的事項':'最近沒有新郵件或行程')}</h2>
        {summary?.tips?.length>0&&<ul className="wb-tips">{summary.tips.map((t,i)=><li key={i}><Lightbulb size={15}/>{t}</li>)}</ul>}
      </section>
      <div className={'wb-grid'+(loading?' stale':'')}>
        <section className="wb-card">
          <h3><WarningCircle size={17}/>緊急事項<span className="count">{summary?.urgent?.length||0}</span></h3>
          {!summary?.urgent?.length?<p className="wb-none">沒有需要立即處理的郵件。</p>:summary.urgent.map(u=>{const m=mails[u.mail];return <a key={u.mail} className="wb-item" href={gmailLink(m)} target="_blank" rel="noreferrer">
            <span className="wb-ic mail"><EnvelopeSimple size={16}/></span>
            <span className="wb-tx"><b>{m.subject}</b><small>{sender(m.from)} · {mailTime(m.at)}</small><em>{u.why}</em></span>
            <ArrowSquareOut size={15} className="wb-out"/></a>})}
        </section>
        <section className="wb-card">
          <h3><CalendarBlank size={17}/>明天的會議<span className="count">{tomorrow.length}</span></h3>
          {!tomorrow.length?<p className="wb-none">明天沒有排定的會議。</p>:tomorrow.map(({e,prep})=><div key={e.id} className="wb-item">
            <span className="wb-time">{eventTime(e)}</span>
            <span className="wb-tx"><b>{e.title}</b>{e.location&&<small><MapPin size={12}/>{e.location}</small>}{prep&&<em>準備：{prep}</em>}</span>
            {e.link&&<a className="wb-out" href={e.link} target="_blank" rel="noreferrer" aria-label="在 Google 日曆開啟"><ArrowSquareOut size={15}/></a>}</div>)}
          {today.length>0&&<><h4>今天還有</h4>{today.map(({e,note})=><div key={e.id} className="wb-item">
            <span className="wb-time">{eventTime(e)}</span><span className="wb-tx"><b>{e.title}</b>{note&&<em>{note}</em>}</span></div>)}</>}
        </section>
      </div>
      <p className="wb-foot">AI 只讀取你自己的帳號，郵件與行程內容先去識別化再交給模型；摘要只保留在這個分頁，重新整理頁面不會再次讀取。{brief.model&&` 模型：${brief.model}`}</p>
    </>}
  </>;
}

/* ------------------------------------------------------------------ 待辦 */
const dueLabel=d=>{if(!d)return '';const t=ymd(new Date());if(d===t)return '今天';if(d===ymd(addDays(new Date(),1)))return '明天';const [,m,dd]=d.split('-');return `${+m}/${+dd}`};
function Todos({items,setItems,notify}){
  const [adding,setAdding]=useState(false),[text,setText]=useState(''),[due,setDue]=useState(()=>ymd(new Date())),[busy,setBusy]=useState(false);
  const add=async e=>{
    e.preventDefault();if(!text.trim())return;setBusy(true);
    try{const t=await api.addTodo({text:text.trim(),due});setItems(a=>[t,...(a||[])]);setText('');setAdding(false)}catch(err){notify('無法新增待辦：'+errText(err))}finally{setBusy(false)}
  };
  const toggle=async t=>{setItems(a=>a.map(x=>x.id===t.id?{...x,done:!t.done}:x));try{await api.updateTodo(t.id,{done:!t.done})}catch(err){setItems(a=>a.map(x=>x.id===t.id?t:x));notify('無法更新：'+errText(err))}};
  const remove=async t=>{setItems(a=>a.filter(x=>x.id!==t.id));try{await api.deleteTodo(t.id)}catch(err){setItems(a=>[t,...a]);notify('無法刪除：'+errText(err))}};
  const today=ymd(new Date());
  const open=(items||[]).filter(t=>!t.done),done=(items||[]).filter(t=>t.done);
  return <section className="wb-card wb-todos">
    <div className="wb-head"><h3><ListChecks size={17}/>待辦事項<span className="count">{open.length}</span></h3>
      {!adding&&<button className="btn sm primary" onClick={()=>setAdding(true)}><Plus size={15}/>新增</button>}</div>
    {adding&&<form className="wb-add" onSubmit={add}>
      <input autoFocus placeholder="要做什麼？" maxLength={200} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setAdding(false)}}/>
      <input type="date" value={due} onChange={e=>setDue(e.target.value)} aria-label="期限"/>
      <button className="btn sm primary" disabled={busy||!text.trim()}>{busy?'新增中…':'加入'}</button>
      <button type="button" className="btn sm" onClick={()=>{setAdding(false);setText('')}}>取消</button></form>}
    {items===null?<p className="wb-none"><span className="lv-spin"/>載入中…</p>:!items.length&&!adding?<p className="wb-none">還沒有待辦事項，按「新增」加入第一件事。</p>:null}
    {[...open,...done].map(t=><div key={t.id} className={'wb-todo'+(t.done?' done':'')}>
      <input type="checkbox" checked={t.done} onChange={()=>toggle(t)} aria-label={t.text}/>
      <span className="wb-tx">{t.text}</span>
      {t.due&&<small className={!t.done&&t.due<today?'late':''}>{dueLabel(t.due)}</small>}
      <button className="wb-del" aria-label="刪除" onClick={()=>remove(t)}><Trash size={15}/></button></div>)}
  </section>;
}

/* ------------------------------------------------------------------ 待審核: publish requests only an admin can decide */
const ago=t=>{if(!t)return '';const m=Math.round((Date.now()-new Date(t))/60000);return m<60?`${Math.max(1,m)} 分鐘前`:m<1440?`${Math.round(m/60)} 小時前`:`${Math.round(m/1440)} 天前`};
function Reviews({rows,reload,notify,go}){
  const [busy,setBusy]=useState(''),[rej,setRej]=useState(null),[reason,setReason]=useState('');
  const decide=async(a,approve)=>{setBusy(a.id);try{await api.reviewAgent(a.id,approve,approve?'':reason.trim());setRej(null);setReason('');notify(approve?`已核准並發布「${a.name}」v${a.review.version}`:'已退回申請');await reload()}catch(e){notify(errText(e))}finally{setBusy('')}};
  return <section className="wb-card">
    <div className="wb-head"><h3><ListChecks size={17}/>等待管理員審核的發布申請<span className="count">{rows?.length||0}</span></h3></div>
    {rows===null?<p className="wb-none"><span className="lv-spin"/>載入中…</p>:!rows.length?<p className="wb-none">目前沒有待審核的申請。</p>
    :rows.map(a=>{const flow=(a.kind||(a.steps?.length?'flow':'agent'))==='flow';return <div key={a.id} className="wb-review">
      <span className="wb-tx"><b>{a.name} <span className="wb-ver">v{a.review.version}</span><span className="wb-kind">{flow?'流程':'Agent'}</span></b>
        <small>申請人 {a.review.requested_by_email} · {ago(a.review.requested_at)}{a.description&&` · ${a.description.slice(0,60)}`}</small></span>
      {rej===a.id?<span className="wb-rej"><input autoFocus placeholder="退回原因（必填）" value={reason} onChange={e=>setReason(e.target.value)}/>
        <button className="btn sm" disabled={!!busy||!reason.trim()} onClick={()=>decide(a,false)}>確認退回</button><button className="btn sm" onClick={()=>setRej(null)}><X size={14}/></button></span>
      :<span className="wb-act"><button className="btn sm" onClick={()=>go(flow?'Flows':'Agent Hub')}>查看</button>
        <button className="btn sm" disabled={!!busy} onClick={()=>{setRej(a.id);setReason('')}}>退回</button>
        <button className="btn sm primary" disabled={!!busy} onClick={()=>decide(a,true)}><Check size={14}/>{busy===a.id?'處理中…':'核准並發布'}</button></span>}
    </div>})}
  </section>;
}

/* ------------------------------------------------------------------ page */
export default function Workbench({me,notify,go}){
  const isAdmin=me?.role==='admin';
  const tabs=['動態','行事曆','待辦',...(isAdmin?['待審核']:[])];
  const [tab,setTab]=useState('動態'),[now,setNow]=useState(()=>new Date());
  const [brief,setBrief]=useState(()=>{try{const c=JSON.parse(sessionStorage.getItem(CACHE)||'null');return c?.uid===me?.uid?c.brief:null}catch{return null}});
  const [loading,setLoading]=useState(false),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[calKey,setCalKey]=useState(0);
  const [todos,setTodos]=useState(null),[reviews,setReviews]=useState(null);

  const sync=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const b=await api.workbenchBrief(localIso());setBrief(b);try{sessionStorage.setItem(CACHE,JSON.stringify({uid:me?.uid,brief:b}))}catch{/* full */}}
    catch(e){const m=errText(e);setErr(m.startsWith('429')?m.replace(/^429\s*/,''):'同步失敗：'+m.replace(/^\d{3}\s*/,''))}
    finally{setLoading(false)}
  },[me?.uid]);
  const loadTodos=useCallback(()=>api.todos().then(setTodos).catch(e=>{setTodos([]);notify('無法載入待辦：'+errText(e))}),[notify]);
  const loadReviews=useCallback(()=>isAdmin?api.reviewQueue().then(r=>setReviews(r||[])).catch(()=>setReviews([])):Promise.resolve(),[isAdmin]);

  useEffect(()=>{if(!brief)sync()},[]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{loadTodos();loadReviews()},[]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),60000);return ()=>clearInterval(t)},[]);

  const connect=async s=>{setBusy(true);try{if(await connectAccount(s.connector_id,notify,{untilClosed:s.state==='reauth_required'}))await sync()}finally{setBusy(false)}};
  const refresh=()=>{sync();loadTodos();loadReviews();setCalKey(k=>k+1)};

  const [hello,nudge]=greeting(now.getHours());
  const name=me?.name||me?.email?.split('@')[0]||'';
  const openTodos=(todos||[]).filter(t=>!t.done).length;
  const syncedAt=brief?.generated_at?hm(brief.generated_at):'';
  return <div className="wb">
    <header className="wb-hero">
      <div>
        <p className="wb-date">{now.getMonth()+1}月{now.getDate()}日 {WD[now.getDay()]} · 我的工作台</p>
        <h1>{hello}{name&&`，${name}`}</h1>
        <p className="wb-nudge">{nudge}</p>
      </div>
      <div className="wb-sync">
        {syncedAt&&<small>上次同步 {syncedAt}</small>}
        <button className="btn sm" disabled={loading} onClick={refresh} title="重新讀取 Gmail 與 Google 日曆，並請 AI 重新整理"><ArrowClockwise size={15} className={loading?'wb-spin':''}/>{loading?'同步中…':'重新同步'}</button>
      </div>
    </header>
    <div className="tabline"><div className="tabs">{tabs.map(t=><button key={t} className={tab===t?'selected':''} onClick={()=>setTab(t)}>{t}
      {t==='動態'&&brief?.summary?.urgent?.length>0&&<span className="count">{brief.summary.urgent.length}</span>}
      {t==='待辦'&&openTodos>0&&<span className="count">{openTodos}</span>}
      {t==='待審核'&&reviews?.length>0&&<span className="count">{reviews.length}</span>}</button>)}</div></div>
    {tab==='動態'&&<Brief brief={brief} loading={loading} err={err} onConnect={connect} busy={busy} go={go}/>}
    {tab==='行事曆'&&<Suspense fallback={<p className="muted small">載入中…</p>}><LiveCalendar key={calKey} notify={notify} go={go}/></Suspense>}
    {tab==='待辦'&&<Todos items={todos} setItems={setTodos} notify={notify}/>}
    {tab==='待審核'&&isAdmin&&<Reviews rows={reviews} reload={loadReviews} notify={notify} go={go}/>}
  </div>;
}
