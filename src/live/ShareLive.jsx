import React,{useEffect,useState} from 'react';
import {X,User,UsersThree,Globe,Lock} from '@phosphor-icons/react';
import {api} from '../api';
import {emptyShare,shareSummary} from '../ShareKit';

export {shareSummary};
const roles=[['use','可使用'],['edit','可編輯']];
const errText=e=>String(e?.message||e).replace(/^Error:\s*/,'');

/** Summary chip (same look as ShareKit's ShareButton). */
export function ShareChip({share,onClick,label='分享',disabled}){
  const open=share?.access==='account';
  return <button type="button" className="share-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{open?<Globe size={15}/>:share?.members?.length?<UsersThree size={15}/>:<Lock size={15}/>}<span>{shareSummary(share)}</span></button>;
}

/** Share dialog backed by GET /api/directory. onDone(share) receives the bare Share JSON; caller persists it. */
export function ShareDialog({title,value,onClose,onDone,owner='你'}){
  const [s,setS]=useState(()=>({...emptyShare(),...structuredClone(value||{})})),[q,setQ]=useState('');
  const [hits,setHits]=useState(null),[loading,setLoading]=useState(false),[err,setErr]=useState('');
  useEffect(()=>{
    if(!q.trim()){setHits(null);setErr('');return}
    let live=true;setLoading(true);
    const t=setTimeout(()=>{
      api.directory(q.trim()).then(r=>{if(!live)return;setErr('');setHits([
        ...(r?.groups||[]).map(g=>({type:'group',id:g.id,name:g.name,sub:`群組 · ${g.member_count??0} 人`})),
        ...(r?.users||[]).map(u=>({type:'user',id:(u.email||'').toLowerCase(),name:u.name||u.email,sub:[u.email,u.department].filter(Boolean).join(' · ')}))
      ])}).catch(e=>{if(live){setHits([]);setErr(errText(e))}}).finally(()=>live&&setLoading(false));
    },300);
    return()=>{live=false;clearTimeout(t)};
  },[q]);
  const taken=new Set(s.members.map(m=>m.type+':'+m.id));
  const list=(hits||[]).filter(d=>!taken.has(d.type+':'+d.id));
  const add=d=>{setS(a=>({...a,members:[...a.members,{type:d.type,id:d.id,name:d.name,role:'use'}]}));setQ('')};
  const key=m=>m.type+':'+m.id;
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal share-modal" role="dialog" aria-modal="true" aria-label="分享設定">
    <button type="button" className="icon-btn modal-close" aria-label="關閉" onClick={onClose}><X/></button>
    <h2>分享「{title||'未命名'}」</h2>
    <div className="share-search"><input aria-label="新增使用者或群組" autoFocus placeholder="搜尋姓名、E-mail 或群組" value={q} onChange={e=>setQ(e.target.value)}/>
      {q.trim()&&<div className="share-hits">{loading&&hits===null?<p className="muted small">搜尋中…</p>:err?<p className="muted small">搜尋失敗：{err}</p>:list.length?list.map(d=><button type="button" key={key(d)} onClick={()=>add(d)}><span className="share-ico">{d.type==='group'?<UsersThree size={16}/>:<User size={16}/>}</span><span><b>{d.name}</b><small>{d.sub}</small></span></button>):<p className="muted small">找不到符合的使用者或群組</p>}</div>}</div>
    <h4>具有存取權的對象</h4>
    <div className="share-list">
      <div className="share-row"><span className="share-ico"><User size={16}/></span><span><b>{owner}</b><small>擁有者</small></span><span className="muted small">擁有者</span></div>
      {s.members.map(m=><div className="share-row" key={key(m)}><span className="share-ico">{m.type==='group'?<UsersThree size={16}/>:<User size={16}/>}</span><span><b>{m.name||m.id}</b><small>{m.type==='group'?'群組':m.id}</small></span>
        <select aria-label={'權限 '+(m.name||m.id)} value={m.role} onChange={e=>setS(a=>({...a,members:a.members.map(x=>key(x)===key(m)?{...x,role:e.target.value}:x)}))}>{roles.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <button type="button" className="icon-btn" aria-label={'移除 '+(m.name||m.id)} onClick={()=>setS(a=>({...a,members:a.members.filter(x=>key(x)!==key(m))}))}><X/></button></div>)}
      {!s.members.length&&<p className="muted small share-empty">尚未分享給任何人。可搜尋姓名或群組加入。</p>}
    </div>
    <h4>一般存取權</h4>
    <div className="share-row share-general"><span className="share-ico">{s.access==='account'?<Globe size={16}/>:<Lock size={16}/>}</span>
      <span><select aria-label="一般存取權" value={s.access} onChange={e=>setS(a=>({...a,access:e.target.value}))}><option value="restricted">僅限上方對象</option><option value="account">整個帳號的所有人</option></select><small>{s.access==='account'?'帳號內所有成員都能找到並使用':'只有上方列出的對象能存取'}</small></span>
      {s.access==='account'&&<select aria-label="一般存取權限" value={s.role} onChange={e=>setS(a=>({...a,role:e.target.value}))}>{roles.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}</div>
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={()=>onDone({access:s.access,role:s.role,members:s.members.map(({type,id,name,role})=>({type,id,name:name||'',role}))})}>完成</button></div>
  </section></div>;
}
export default ShareDialog;
