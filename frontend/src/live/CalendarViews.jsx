import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Buildings,MapPin,ArrowSquareOut,X} from '@phosphor-icons/react';

/* Google-Calendar-style views: a month grid and a week / day time grid. Weeks start on Sunday. */
export const WD_EN=['SUN','MON','TUE','WED','THU','FRI','SAT'];
export const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
export const startOfDay=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x};
export const sundayOf=d=>addDays(startOfDay(d),-startOfDay(d).getDay());
export const dayKey=d=>`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
const sameDay=(a,b)=>dayKey(a)===dayKey(b);
const H=60;                                   // px per hour in the time grid
const NUM=['','初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
const LUNAR=(()=>{try{return new Intl.DateTimeFormat('zh-TW-u-ca-chinese',{month:'long',day:'numeric'})}catch{return null}})();
/* 農曆: "初二", and the month name on the 1st ("十月") like Google Calendar. */
export function lunarOf(d){
  if(!LUNAR)return '';
  try{const parts=LUNAR.formatToParts(new Date(d.getFullYear(),d.getMonth(),d.getDate(),12));
    const day=parseInt(parts.find(p=>p.type==='day')?.value,10),month=parts.find(p=>p.type==='month')?.value||'';
    return day===1?month.replace(/^閏/,'閏'):NUM[day]||''}catch{return ''}
}
const t12=d=>{const h=d.getHours(),m=d.getMinutes(),ap=h<12?'am':'pm',hh=h%12||12;return m?`${hh}:${String(m).padStart(2,'0')}${ap}`:`${hh}${ap}`};
const hourLabel=h=>h===0?'12 AM':h<12?`${h} AM`:h===12?'12 PM':`${h-12} PM`;
export const isOffice=e=>e.all_day&&/^office$/i.test((e.title||'').trim());
/* All-day dates are plain 'YYYY-MM-DD' (end exclusive): read them as LOCAL midnight, not UTC (which spills into the next day east of UTC). */
export const when=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?new Date(+v.slice(0,4),+v.slice(5,7)-1,+v.slice(8,10)):new Date(v);
const covers=(e,d0)=>{const d1=addDays(d0,1),s=when(e.start),en=e.end?when(e.end):s;return e.all_day?(s<d1&&en>d0):(s<d1&&(en>d0||(+en===+s&&s>=d0)))};

function Detail({ev,onClose}){
  useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
  const s=when(ev.start),en=ev.end?when(ev.end):null;
  const text=ev.all_day?`${s.getMonth()+1}月${s.getDate()}日 全天`:`${s.getMonth()+1}月${s.getDate()}日 ${t12(s)}${en?' – '+t12(en):''}`;
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal gc-detail" role="dialog" aria-modal="true" aria-label={ev.title||'行程'}>
    <button type="button" className="icon-btn gc-x" aria-label="關閉" onClick={onClose}><X size={16}/></button>
    <h3><i className="gc-dot"/>{ev.title||'（無標題）'}</h3><p>{text}</p>
    {ev.location&&<p><MapPin size={14}/> {ev.location}</p>}
    {ev.link&&<a className="btn sm" href={ev.link} target="_blank" rel="noreferrer"><ArrowSquareOut size={14}/>在 Google 日曆開啟</a>}
  </section></div>;
}

/* ------------------------------------------------------------------ month */
export function MonthGrid({events,anchor,onPick,onDay}){
  const first=new Date(anchor.getFullYear(),anchor.getMonth(),1),start=sundayOf(first);
  const weeks=Math.ceil((first.getDay()+new Date(anchor.getFullYear(),anchor.getMonth()+1,0).getDate())/7);
  const today=new Date(),rows=Array.from({length:weeks},(_,w)=>Array.from({length:7},(_,i)=>addDays(start,w*7+i)));
  return <div className="gc-month" style={{'--rows':weeks}}>
    <div className="gc-mh">{WD_EN.map(w=><span key={w}>{w}</span>)}</div>
    <div className="gc-mb">{rows.map((row,w)=>{
      const offIdx=row.findIndex(d=>events.some(e=>isOffice(e)&&covers(e,d)));
      return <div className="gc-week" key={w}>{row.map((d,i)=>{
        const evs=events.filter(e=>!isOffice(e)&&covers(e,d)).sort((a,b)=>(b.all_day?1:0)-(a.all_day?1:0)||when(a.start)-when(b.start));
        const office=events.some(e=>isOffice(e)&&covers(e,d)),isT=sameDay(d,today),k=dayKey(d),max=office?3:4,more=evs.length-max;
        const list=evs.slice(0,more>0?max-1:max);
        const lun=lunarOf(d),other=d.getMonth()!==anchor.getMonth();
        return <div key={k} className={'gc-cell'+(other?' other':'')} onClick={()=>onDay?.(d)}>
          <div className="gc-dnum">{isT?<b className="gc-today">{d.getDate()}</b>:<span>{d.getDate()===1?`${d.getMonth()+1===1?d.getFullYear()+'年':''}${d.getMonth()+1}月`:''}{d.getDate()}</span>}{lun&&<small className={isT?'t':''}>（{lun}）</small>}</div>
          {office&&<div className={'gc-office'+(i===offIdx?' first':'')}>{i===offIdx&&<span><Buildings size={12}/>Office</span>}</div>}
          <div className="gc-evs">{list.map(e=><button type="button" key={e.id+k} className={'gc-ev'+(e.all_day?' allday':'')} title={e.title} onClick={ev=>{ev.stopPropagation();onPick(e)}}>
            {e.all_day?null:<i className="gc-dot"/>}{!e.all_day&&<em>{t12(new Date(e.start))}</em>}<span>{e.title||'（無標題）'}</span></button>)}
            {more>0&&<button type="button" className="gc-more" onClick={ev=>{ev.stopPropagation();onDay?.(d)}}>{more+1} more</button>}
          </div></div>})}</div>})}</div>
  </div>;
}

/* ------------------------------------------------------------- week / day */
function pack(items){
  // overlapping timed events share the width side by side
  const out=[],sorted=[...items].sort((a,b)=>a.s-b.s||b.e-a.e);let group=[],gEnd=0;
  const flush=()=>{if(!group.length)return;const cols=[];group.forEach(x=>{let c=cols.findIndex(end=>end<=x.s);if(c<0){c=cols.length;cols.push(0)}cols[c]=x.e;x.col=c});group.forEach(x=>out.push({...x,cols:cols.length}));group=[]};
  for(const x of sorted){if(group.length&&x.s>=gEnd)flush();group.push(x);gEnd=Math.max(gEnd,x.e)}flush();return out;
}
export function TimeGrid({events,days,onPick,onDay}){
  const today=new Date(),scroller=useRef(null),[now,setNow]=useState(()=>new Date());
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(t)},[]);
  useLayoutEffect(()=>{if(scroller.current)scroller.current.scrollTop=H*7.5},[days.length,+days[0]]);
  const cols=days.map(d=>{
    const d1=addDays(d,1),all=events.filter(e=>e.all_day&&covers(e,d));
    const timed=events.filter(e=>!e.all_day&&covers(e,d)).map(ev=>{
      const s=Math.max(+new Date(ev.start),+d),en=Math.min(+(ev.end?new Date(ev.end):new Date(ev.start)),+d1);
      return {ev,s,e:Math.max(en,s+25*60000)}});            // at least ~25 minutes tall so short events stay clickable
    return {d,all:all.filter(x=>!isOffice(x)),office:all.some(isOffice),timed:pack(timed)};
  });
  const firstOffice=cols.findIndex(c=>c.office);
  return <div className="gc-time" style={{'--n':days.length}}>
    <div className="gc-th"><div className="gc-gmt">GMT{-now.getTimezoneOffset()/60>=0?'+':''}{-now.getTimezoneOffset()/60}</div>
      {cols.map(({d,all,office},ci)=>{const isT=sameDay(d,today);return <div key={dayKey(d)} className={'gc-thc'+(isT?' today':'')} onClick={()=>onDay?.(d)}>
        <span className="wd">{WD_EN[d.getDay()]}</span><span className={'dn'+(isT?' is':'')}><b>{d.getDate()}</b><small>{lunarOf(d)}</small></span>
        {office?<div className={'gc-office'+(ci===firstOffice?' first':'')}>{ci===firstOffice&&<span><Buildings size={12}/>Office</span>}</div>:<div className="gc-office none"/>}
        {all.map(e=><button type="button" key={e.id} className="gc-ad" title={e.title} onClick={ev=>{ev.stopPropagation();onPick(e)}}>{e.title}</button>)}</div>})}</div>
    <div className="gc-scroll" ref={scroller}><div className="gc-grid" style={{height:H*24}}>
      <div className="gc-hours">{Array.from({length:24},(_,h)=>h?<span key={h} style={{top:h*H}}>{hourLabel(h)}</span>:null)}</div>
      {cols.map(({d,timed})=><div key={dayKey(d)} className="gc-col" onClick={()=>onDay?.(d)}>
        {Array.from({length:24},(_,h)=><i key={h} className="gc-line" style={{top:h*H}}/>)}
        {sameDay(d,today)&&<div className="gc-now" style={{top:(now.getHours()+now.getMinutes()/60)*H}}><i/></div>}
        {timed.map(x=>{const top=(x.s-+d)/36e5*H,h=Math.max(22,(x.e-x.s)/36e5*H-1),w=100/x.cols,ev=x.ev;const s=new Date(ev.start),en=ev.end?new Date(ev.end):null;
          return <button type="button" key={(ev.id||'')+x.s} className={'gc-block'+(x.cols>1?' ov':'')} style={{top,height:h,left:`calc(${x.col*w}% + 1px)`,width:`calc(${w}% - 3px)`}} onClick={e2=>{e2.stopPropagation();onPick(ev)}} title={ev.title}>
            <b>{ev.title||'（無標題）'}</b>{h>34&&<span>{t12(s)}{en?' – '+t12(en):''}{ev.location&&h>52?`, ${ev.location}`:''}</span>}</button>})}
      </div>)}
    </div></div>
  </div>;
}
export {Detail as EventDetail};
