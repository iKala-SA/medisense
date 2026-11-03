import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Copy,Check,LinkSimple,ShieldCheck,X} from '@phosphor-icons/react';
import {api} from './api';
import './share.css';

/* 分享 a conversation (rules 2026-11-03): one link per conversation, a snapshot of the de-identified messages so far, readable by
   anyone signed in to the platform, fixed 30 days, revocable. The server does the snapshot, de-identification and audit. */
export const shareUrl=id=>`${location.origin}/share/${id}`;
export const fmtDate=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':`${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`};

/* Mock mode (VITE_MOCK_API=1): shares live in this browser only, so the dialog and the /share page can be tried without a backend. */
const MKEY='medisense.mockShares';
const mload=()=>{try{return JSON.parse(localStorage.getItem(MKEY)||'{}')}catch{return {}}};
const msave=v=>{try{localStorage.setItem(MKEY,JSON.stringify(v))}catch{/* storage blocked: in-memory only */}};
const mockStore=(()=>{let s=null;const all=()=>(s??=mload());return {
  get:sid=>Object.values(all()).find(x=>x.session_id===sid&&new Date(x.expires_at)>new Date())||null,
  create(chat){const hit=this.get(chat.id);if(hit)return hit;const at=new Date(),id=Math.random().toString(36).slice(2,12);
    const messages=(chat.messages||[]).flatMap(m=>m.role?[{role:m.role,content:m.content}]:[{role:'user',content:m.text||''},{role:'assistant',content:m.ans||''}]).filter(m=>m.content);
    const x={id,session_id:chat.id,title:chat.title||'對話',owner_name:'示範使用者',created_at:at.toISOString(),expires_at:new Date(+at+30*864e5).toISOString(),attachments:0,
      messages:messages.length?messages:[{role:'user',content:'[PERSON_NAME] 的血壓追蹤建議？'},{role:'assistant',content:'（示範內容）建議每週量測兩次並記錄。'}]};
    all()[id]=x;msave(all());return x},
  revoke(sid){for(const [k,v] of Object.entries(all()))if(v.session_id===sid)delete all()[k];msave(all())},
  view:id=>{const x=all()[id];if(!x||new Date(x.expires_at)<=new Date())throw new Error('404 share not found or expired');return x},
}})();
export const shareApi=mock=>mock?{
  get:async sid=>mockStore.get(sid),create:async chat=>mockStore.create(chat),revoke:async sid=>mockStore.revoke(sid),view:async id=>mockStore.view(id),
}:{get:sid=>api.getShare(sid),create:chat=>api.createShare(chat.id),revoke:sid=>api.revokeShare(sid),view:id=>api.viewShare(id)};

export function ShareDialog({chat,mock,notify,onClose}){
  const S=shareApi(mock);
  const [share,setShare]=useState(undefined),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[err,setErr]=useState('');
  useEffect(()=>{let live=true;S.get(chat.id).then(s=>live&&setShare(s||null)).catch(e=>{if(live){setShare(null);setErr(e.message)}});return()=>{live=false}},[chat.id]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{const k=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
  const act=fn=>async()=>{if(busy)return;setBusy(true);setErr('');try{await fn()}catch(e){setErr(/409/.test(e.message)?'這個對話還沒有內容，無法分享。':e.message)}finally{setBusy(false)}};
  const create=act(async()=>setShare(await S.create(chat)));
  const revoke=act(async()=>{await S.revoke(chat.id);setShare(null);notify?.('已撤銷分享連結')});
  const copy=()=>{const u=shareUrl(share.id);(navigator.clipboard?.writeText(u)||Promise.reject()).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800)}).catch(()=>{const i=document.querySelector('.sh-link input');i?.select()})};
  return createPortal(<div className="rc-modal" onClick={onClose}><div className="sh-dialog" role="dialog" aria-modal="true" aria-label="分享對話" onClick={e=>e.stopPropagation()}>
    <div className="sh-head"><h3>分享對話</h3><button type="button" className="sh-x" aria-label="關閉" onClick={onClose}><X size={18}/></button></div>
    <p className="sh-title" title={chat.title}>{chat.title}</p>
    {share===undefined?<p className="sh-note">載入中…</p>:share?<>
      <div className="sh-link"><LinkSimple size={16}/><input readOnly value={shareUrl(share.id)} aria-label="分享連結" onFocus={e=>e.target.select()}/><button type="button" className="sh-copy" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>}{copied?'已複製':'複製連結'}</button></div>
      <p className="sh-note">分享的是目前為止的對話內容，之後的新訊息不會出現在連結中。</p>
      <p className="sh-info"><ShieldCheck size={15}/><span>連結 30 天後失效（{fmtDate(share.expires_at)}），登入平台的院內人員都能檢視；內容已去識別化。每次開啟都會記錄在稽核紀錄。</span></p>
      <div className="sh-actions"><button type="button" className="sh-revoke" disabled={busy} onClick={revoke}>撤銷分享</button><button type="button" className="sh-primary" onClick={onClose}>完成</button></div>
    </>:<>
      <p className="sh-note">建立一個連結，分享的是目前為止的對話內容（之後的新訊息不會包含在內）。</p>
      <p className="sh-info"><ShieldCheck size={15}/><span>連結 30 天後失效，登入平台的院內人員都能檢視；內容已去識別化，附件與圖片不會分享。你可以隨時撤銷。</span></p>
      <div className="sh-actions"><button type="button" className="sh-ghost" onClick={onClose}>取消</button><button type="button" className="sh-primary" disabled={busy} onClick={create}><LinkSimple size={15}/>{busy?'建立中…':'建立連結'}</button></div>
    </>}
    {err&&<p className="sh-err" role="alert">{err}</p>}
  </div></div>,document.body);
}
