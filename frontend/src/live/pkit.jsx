import React,{useEffect,useRef} from 'react';

export const errText=e=>String(e?.message||e);
export const isBuilder=me=>me?.role==='builder'||me?.role==='admin';
export const isAdmin=me=>me?.role==='admin';
export const fmtSize=n=>n==null?'—':n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
export const fmtTime=s=>{if(!s)return '—';const d=new Date(s);return isNaN(d)?'—':d.toLocaleString('zh-TW',{hour12:false})};

/* Run an async loader once per mount. */
export function useOnce(fn){const ran=useRef(false);useEffect(()=>{if(ran.current)return;ran.current=true;fn()},[]);}// eslint-disable-line

export const Loading=({text='載入中…'})=><div className="lv-p-loading">{text}</div>;
export const Banner=({icon,info,children})=><div className={'lv-p-banner'+(info?' info':'')}>{icon}<div>{children}</div></div>;
