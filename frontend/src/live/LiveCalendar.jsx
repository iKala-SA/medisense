import React,{useCallback,useEffect,useState} from 'react';
import {CaretLeft,CaretRight,ArrowClockwise,ArrowSquareOut,MapPin,CalendarBlank,Plugs} from '@phosphor-icons/react';
import {Icon} from '@iconify/react';
import calendarIcon from '@iconify-icons/logos/google-calendar';
import {api} from '../api';
import {Loading} from './pkit';
import {connectAccount,connectErr} from './connectFlow';
import './pages.css';
import './calendar.css';

const WD=['週日','週一','週二','週三','週四','週五','週六'];
const mondayOf=d=>{const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const dayKey=d=>`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
const hm=s=>new Date(s).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false});
const md=d=>`${d.getMonth()+1}月${d.getDate()}日`;

/* Events that span several days appear on every day they cover. All-day end dates are exclusive. */
function groupByDay(events,start,count=7){
  const days=Array.from({length:count},(_,i)=>({date:addDays(start,i),items:[]}));
  for(const e of events||[]){
    const s=new Date(e.start),en=e.end?new Date(e.end):s;
    days.forEach(d=>{
      const d0=d.date,d1=addDays(d0,1);
      const hit=e.all_day?(s<d1&&en>d0):(s<d1&&(en>d0||(+en===+s&&s>=d0)));
      if(hit)d.items.push(e);
    });
  }
  days.forEach(d=>d.items.sort((a,b)=>(b.all_day?1:0)-(a.all_day?1:0)||new Date(a.start)-new Date(b.start)));
  return days;
}
/* "Office" all-day entries are working-location markers, not events. */
const isOffice=e=>e.all_day&&/^office$/i.test((e.title||'').trim());
const VIEWS=[['day','日'],['week','週'],['month','月']];
const rangeOf=(view,anchor)=>{
  if(view==='day'){const s=new Date(anchor);s.setHours(0,0,0,0);return {start:s,count:1}}
  if(view==='week')return {start:mondayOf(anchor),count:7};
  const s=new Date(anchor.getFullYear(),anchor.getMonth(),1);
  return {start:s,count:new Date(anchor.getFullYear(),anchor.getMonth()+1,0).getDate()};
};
const shift=(view,d,n)=>view==='month'?new Date(d.getFullYear(),d.getMonth()+n,1):addDays(d,n*(view==='week'?7:1));
const timeText=e=>e.all_day?'全天':e.end?`${hm(e.start)} – ${hm(e.end)}`:hm(e.start);

function Hero({title,children,action}){
  return <div className="lv-cal-hero"><span className="lv-cal-logo"><Icon icon={calendarIcon} width={34} height={34}/></span><h2>{title}</h2><p>{children}</p>{action}</div>;
}

export default function LiveCalendar({notify,go}){
  const [status,setStatus]=useState(null),[mine,setMine]=useState(null),[busy,setBusy]=useState(false);
  const [view,setView]=useState('day'),[anchor,setAnchor]=useState(()=>new Date()),[data,setData]=useState(null),[loading,setLoading]=useState(false);

  const init=useCallback(async()=>{
    setStatus(null);
    try{
      const st=await api.calendarStatus();setStatus(st);
      if(!st.connected){try{setMine((await api.myConnectors()||[]).find(c=>c.type==='calendar')||false)}catch(e){setMine(false);notify('無法載入連線資訊：'+connectErr(e))}}
    }catch(e){setStatus({connected:false,reason:''});setMine(false);notify('無法取得行事曆狀態：'+connectErr(e))}
  },[notify]);
  useEffect(()=>{init()},[init]);

  const connected=!!status?.connected;
  const {start,count}=rangeOf(view,anchor);
  const startMs=+start;
  const loadEvents=useCallback(async()=>{
    setLoading(true);
    try{setData(await api.calendarEvents(start.toISOString(),addDays(start,count).toISOString(),view==='month'?250:100))}
    catch(e){
      const m=connectErr(e);
      if(String(e?.message).startsWith('409')){notify('行事曆尚未連線：'+m);init()}else notify('無法載入行事曆：'+m);
    }finally{setLoading(false)}
  },[startMs,count,notify,init]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(connected)loadEvents()},[connected,loadEvents]);

  const connect=async()=>{
    if(!mine)return;
    setBusy(true);
    try{if(await connectAccount(mine.id,notify))await init()}finally{setBusy(false)}
  };

  if(!status)return <Loading/>;
  if(!connected){
    if(mine===null)return <Loading/>;
    if(!mine)return <Hero title="尚未有分享給您的 Google 日曆" action={go&&<button className="btn" onClick={()=>go('Connectors')}><Plugs size={15}/>前往連接器</button>}>
      管理員需先建立 Google Calendar 連接器並分享給您，您才能在這裡連線自己的日曆。</Hero>;
    const unavailable=mine.state==='unavailable';
    return <Hero title="連線我的 Google 日曆" action={<div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
      {!unavailable&&<button className="btn primary" disabled={busy} onClick={connect}>{busy?'等待授權…':mine.state==='reauth_required'?'重新授權':'連線我的 Google 日曆'}</button>}
      {go&&<button className="btn" onClick={()=>go('Connectors')}>前往連接器</button>}</div>}>
      {mine.state==='reauth_required'?'授權已過期，請重新授權。':unavailable?(mine.problem||'連接器暫時無法使用，請聯絡管理員。'):'授權後，Medisense 只會以您自己的帳號讀取日曆，其他人看不到您的內容。'}</Hero>;
  }

  let days=groupByDay((data?.events||[]).filter(e=>!isOffice(e)),start,count);
  const today=dayKey(new Date());
  if(view==='month')days=days.filter(d=>d.items.length);
  const label=view==='day'?`${md(start)} ${WD[start.getDay()]}`:view==='week'?`${md(start)} – ${md(addDays(start,6))}`:`${start.getFullYear()}年${start.getMonth()+1}月`;
  const unit={day:'天',week:'週',month:'月'}[view];
  return <div className="lv-cal">
    <div className="lv-cal-head">
      <span className="lv-cal-acct"><Icon icon={calendarIcon} width={20} height={20}/>{data?.account_label||status.account_label||'Google 日曆'}</span>
      <span className="grow"/>
      <div className="lv-cal-nav">
        <span className="lv-cal-views" role="tablist">{VIEWS.map(([k,l])=><button key={k} role="tab" aria-selected={view===k} className={'btn sm'+(view===k?' primary':'')} onClick={()=>setView(k)}>{l}</button>)}</span>
        <button className="btn sm" aria-label={`上一${unit}`} onClick={()=>setAnchor(a=>shift(view,a,-1))}><CaretLeft size={14}/></button>
        <button className="btn sm" onClick={()=>setAnchor(new Date())}>今天</button>
        <button className="btn sm" aria-label={`下一${unit}`} onClick={()=>setAnchor(a=>shift(view,a,1))}><CaretRight size={14}/></button>
        <span className="lv-cal-range">{label}</span>
        <button className="btn sm" aria-label="重新整理" disabled={loading} onClick={loadEvents}><ArrowClockwise size={14}/></button>
      </div>
    </div>
    {!data&&loading?<Loading/>:view==='month'&&!days.length?<div className="lv-cal-none" style={{padding:'24px 0',textAlign:'center'}}>這個月沒有行程</div>:days.map(d=><section key={dayKey(d.date)} className={'lv-cal-day'+(dayKey(d.date)===today?' today':'')}>
      <div className="lv-cal-dh"><b>{WD[d.date.getDay()]}</b><span>{md(d.date)}{dayKey(d.date)===today?' · 今天':''}</span></div>
      <div className="lv-cal-evs">{d.items.length?d.items.map(e=><div className="lv-cal-ev" key={e.id+dayKey(d.date)}>
        <span className="t">{timeText(e)}</span>
        <div style={{minWidth:0}}><b>{e.title||'（無標題）'}</b>{e.location&&<small><MapPin size={11} style={{verticalAlign:-1}}/> {e.location}</small>}</div>
        {e.link&&<a href={e.link} target="_blank" rel="noreferrer" aria-label="在 Google 日曆開啟" title="在 Google 日曆開啟"><ArrowSquareOut size={16}/></a>}
      </div>):<span className="lv-cal-none">這天沒有行程</span>}</div>
    </section>)}
  </div>;
}
