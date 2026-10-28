import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ThumbsUp,ThumbsDown,X,Copy,Check,CircleNotch} from '@phosphor-icons/react';
import {api} from '../api';
import './feedback.css';

export const REASONS=[['inaccurate','不準確，與事實不符'],['incomplete','回答不完整'],['misunderstood','沒有理解我的問題'],['sources','引用來源有問題'],
  ['wordy','太冗長'],['unsafe','含有冒犯或不安全的內容'],['slow','回應太慢'],['other','其他（請在下方說明）']];

/* The "分享你的回饋" dialog shown after 👎. */
function FeedbackModal({question,answer,onClose,onSubmit}){
  const [picked,setPicked]=useState([]),[details,setDetails]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[copied,setCopied]=useState(false);
  const first=useRef(null);
  useEffect(()=>{first.current?.focus();const k=e=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',k);return ()=>document.removeEventListener('keydown',k)},[onClose]);
  const toggle=id=>setPicked(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const ok=picked.length>0||details.trim().length>0;
  async function submit(){setBusy(true);setErr('');try{await onSubmit(picked,details.trim())}catch(e){setErr(e.message);setBusy(false)}}
  async function copy(){
    try{await navigator.clipboard.writeText(`問題：\n${question}\n\n回答：\n${answer}`);setCopied(true);setTimeout(()=>setCopied(false),1600)}catch{setErr('瀏覽器不允許複製')}
  }
  return createPortal(<div className="fb-back" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="fb-dialog" role="dialog" aria-modal="true" aria-labelledby="fb-title">
      <header><h3 id="fb-title">分享你的回饋</h3><button type="button" className="fb-x" aria-label="關閉" onClick={onClose}><X size={18}/></button></header>
      <div className="fb-reasons">{REASONS.map(([id,label],i)=><label key={id} className="fb-check"><input ref={i===0?first:null} type="checkbox" checked={picked.includes(id)} onChange={()=>toggle(id)}/><span className="box"><Check size={13} weight="bold"/></span>{label}</label>)}</div>
      <label className="fb-detail">補充說明<textarea rows={4} maxLength={2000} value={details} onChange={e=>setDetails(e.target.value)} placeholder="分享回饋細節，或重現問題的步驟"/></label>
      <p className="fb-note">你的回饋與這則對話內容（已去識別化）會提供給系統管理團隊，用於改善服務。請勿填寫病人個資、商業敏感或機密資訊。</p>
      {err&&<p className="fb-err" role="alert">{err}</p>}
      <footer><button type="button" className="fb-link" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>}{copied?'已複製':'複製對話內容'}</button>
        <span className="sp"/><button type="button" className="fb-cancel" onClick={onClose}>取消</button>
        <button type="button" className="fb-submit" disabled={!ok||busy} onClick={submit}>{busy?<><CircleNotch className="spin" size={14}/>送出中…</>:'送出'}</button></footer>
    </div></div>,document.body);
}

/* 👍 / 👎 under a reply. `rating` is what the user already gave ('up' | 'down' | undefined). */
export default function FeedbackBar({sessionId,msgIndex,rating,question,answer,notify,mock}){
  const [cur,setCur]=useState(rating),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>setCur(rating),[rating,sessionId,msgIndex]);
  const usable=mock||(!!sessionId&&msgIndex!=null);
  async function send(r,reasons=[],details=''){
    if(!mock)await api.sendFeedback({session_id:sessionId,message_index:msgIndex,rating:r,reasons,details});
    setCur(r==='none'?undefined:r);
  }
  async function up(){
    if(busy)return;setBusy(true);
    try{await send(cur==='up'?'none':'up');if(cur!=='up')notify?.('謝謝你的回饋')}catch(e){notify?.('無法送出回饋：'+e.message)}finally{setBusy(false)}
  }
  async function down(){
    if(busy)return;
    if(cur==='down'){setBusy(true);try{await send('none')}catch(e){notify?.('無法收回：'+e.message)}finally{setBusy(false)}return}
    setOpen(true);
  }
  return <>
    <button type="button" className={'fb-btn'+(cur==='up'?' on':'')} aria-pressed={cur==='up'} aria-label="這個回答很有幫助" title="有幫助" disabled={!usable||busy} onClick={up}><ThumbsUp size={15} weight={cur==='up'?'fill':'regular'}/></button>
    <button type="button" className={'fb-btn bad'+(cur==='down'?' on':'')} aria-pressed={cur==='down'} aria-label="這個回答沒有幫助" title="沒有幫助" disabled={!usable||busy} onClick={down}><ThumbsDown size={15} weight={cur==='down'?'fill':'regular'}/></button>
    {open&&<FeedbackModal question={question} answer={answer} onClose={()=>setOpen(false)}
      onSubmit={async(reasons,details)=>{await send('down',reasons,details);setOpen(false);notify?.('已送出回饋，謝謝你')}}/>}
  </>;
}
