import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ShieldWarning,LockKey,DownloadSimple,X,CircleNotch,Clock} from '@phosphor-icons/react';
import {api,saveBlob} from '../api';
import './chat.css';

const PURPOSES=['診療需要','會診討論','品質或稽核查核','教學或研究','其他'];
const clock=s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

/* Repeating diagonal "name · email · time" text laid over the page (does not block clicks or scrolling). */
function Watermark({text}){
  const bg=useMemo(()=>{
    const esc=text.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><text x="160" y="100" transform="rotate(-24 160 100)" text-anchor="middle" font-family="sans-serif" font-size="13" fill="rgba(23,60,40,0.24)">${esc}</text></svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  },[text]);
  return <div className="cx-wm" aria-hidden="true" style={{backgroundImage:bg}}/>;
}

/* The original file of a cited document. Sits next to the de-identified text in the viewer.
   doc.original: none (no stored original) | open (no personal data found) | purpose (grant + stated purpose) | denied. */
export default function OriginalView({doc,page,notify}){
  const [purpose,setPurpose]=useState(''),[preset,setPreset]=useState(PURPOSES[0]),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  const [open,setOpen]=useState(null);       // {url,blobUrl,kind,text,expires,watermark,filename,left}
  const [expired,setExpired]=useState(false);
  const cur=useRef(null);
  const release=()=>{if(cur.current?.blobUrl)URL.revokeObjectURL(cur.current.blobUrl);cur.current=null};
  useEffect(()=>release,[]);
  useEffect(()=>{release();setOpen(null);setExpired(false);setErr('')},[doc.id]);

  // the link, and with it the on-screen copy, ends when its time is up; reopening asks for a purpose again
  useEffect(()=>{
    if(!open)return;
    const t=setInterval(()=>{
      const left=Math.max(0,open.expires-Math.floor(Date.now()/1000));
      if(left<=0){release();setOpen(null);setExpired(true);return}
      setOpen(o=>o&&{...o,left});
    },1000);
    return ()=>clearInterval(t);
  },[open?.expires]);// eslint-disable-line react-hooks/exhaustive-deps

  if(doc.original==='none')return <p className="cx-empty">這份文件沒有保存原始檔。</p>;
  if(doc.original==='denied')return <div className="cx-orig-note deny"><LockKey size={18}/><div><b>需要「原始檔檢視」權限</b><p>此文件含個人資料（{(doc.pii_types||[]).length?doc.pii_types.join('、'):'已由 DLP 偵測或尚未分類'}），一般使用者只能看去識別化版本。需要核對原文時，請向管理員申請權限。</p></div></div>;

  async function openIt(){
    const why=preset==='其他'?purpose.trim():(purpose.trim()?`${preset}：${purpose.trim()}`:preset);
    if(doc.original==='purpose'&&why.length<4){setErr('請說明用途');return}
    setBusy(true);setErr('');setExpired(false);
    try{
      const r=await api.openOriginal(doc.id,doc.original==='purpose'?why:'');
      const b=await api.fetchOriginal(r.url);
      const text=r.kind==='text'?await b.text():'';
      const blobUrl=r.kind==='pdf'?URL.createObjectURL(b):'';
      const o={url:r.url,blobUrl,kind:r.kind,text,expires:r.expires_at,watermark:r.watermark,filename:r.filename,left:r.ttl_seconds};
      release();cur.current=o;setOpen(o);
    }catch(e){setErr(e.message)}finally{setBusy(false)}
  }
  async function download(){
    try{saveBlob(await api.fetchOriginal(open.url,true),open.filename);notify?.('已下載，並寫入稽核記錄')}
    catch(e){setErr(e.message)}
  }

  if(open){
    const mark=`${open.watermark} · ${new Date().toLocaleString('zh-TW',{hour12:false})}`;
    return <div className="cx-orig">
      <div className="cx-orig-bar"><span className="cx-orig-timer" title="連結到期後會自動關閉"><Clock size={13}/>{clock(open.left)} 後失效</span>
        <button type="button" onClick={download}><DownloadSimple size={14}/>下載</button>
        <button type="button" onClick={()=>{release();setOpen(null)}}><X size={14}/>關閉</button></div>
      <div className="cx-orig-page">
        {open.kind==='pdf'&&<iframe title={open.filename} src={`${open.blobUrl}#page=${page||1}`}/>}
        {open.kind==='text'&&<pre>{open.text}</pre>}
        {open.kind==='download'&&<p className="cx-empty">此檔案格式無法在頁面預覽，請使用「下載」。</p>}
        <Watermark text={mark}/>
      </div>
      <p className="cx-hint">原始檔可能含個人資料。本次開啟已記錄（誰、哪份、何時、用途）；請勿轉傳或外流。</p>
      {err&&<p className="cx-err">{err}</p>}
    </div>;
  }
  return <div className="cx-orig-ask">
    <div className={'cx-orig-note'+(doc.pii==='none'?'':' warn')}><ShieldWarning size={18}/><div>
      <b>{doc.pii==='none'?'未偵測到個人資料':'此文件含個人資料'}</b>
      <p>{doc.pii==='none'?'可直接開啟原始檔；開啟與下載仍會寫入稽核記錄。':`DLP 偵測到：${(doc.pii_types||[]).join('、')||'（尚未分類，視同含個資）'}。開啟前請說明用途，系統會記錄你是誰、開了哪份文件、什麼時候、為什麼。`}</p></div></div>
    {doc.original==='purpose'&&<>
      <label className="cx-field">用途<select value={preset} onChange={e=>setPreset(e.target.value)}>{PURPOSES.map(p=><option key={p}>{p}</option>)}</select></label>
      <label className="cx-field">補充說明{preset==='其他'?'（必填）':'（選填）'}<textarea maxLength={150} rows={2} value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="例如：核對某項檢驗數值的原始表格"/></label>
    </>}
    {err&&<p className="cx-err">{err}</p>}
    {expired&&<p className="cx-hint">上一次開啟的連結已失效，請重新開啟。</p>}
    <button type="button" className="cx-primary" disabled={busy} onClick={openIt}>{busy?<><CircleNotch className="spin" size={14}/>開啟中…</>:'開啟原始檔'}</button>
  </div>;
}
