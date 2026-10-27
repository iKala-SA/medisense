import React,{useCallback,useEffect,useState} from 'react';
import {errText} from './kit';

export const canEdit=x=>['owner','admin','edit'].includes(x?.my_role);
export const canOwn=x=>['owner','admin'].includes(x?.my_role);
export const ROLE_LABEL={owner:'擁有者',admin:'管理員',edit:'可編輯',use:'可使用'};
export const fmtDate=t=>{if(!t)return '—';const d=new Date(t);return isNaN(d)?'—':d.toLocaleString('zh-TW',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};
export const match=(text,q)=>text.toLowerCase().includes(q.trim().toLowerCase());
export const sameShare=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);

/** Loads a list once; returns [items|null, setItems, reload, error]. */
export function useLoad(fn,label,notify){
  const [items,setItems]=useState(null),[err,setErr]=useState('');
  const load=useCallback(()=>{setErr('');return fn().then(r=>setItems(r||[])).catch(e=>{setItems([]);setErr(errText(e));notify(`載入${label}失敗：${errText(e)}`)})},[]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{load()},[load]);
  return [items,setItems,()=>{setItems(null);load()},err];
}
export const State=({text,err,onRetry})=><div className="lv-state">{err?<>無法載入：{err}<br/><button className="text-button" onClick={onRetry}>重試</button></>:<><span className="lv-spin"/>{text||'載入中…'}</>}</div>;
