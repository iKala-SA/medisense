import React,{useState,useMemo} from 'react';
import {UsersThree,Plus,PencilSimple,Trash,Lock,X} from '@phosphor-icons/react';
import {api} from '../api';
import {Empty} from '../ListKit';
import {errText,useOnce} from './pkit';
import './ops.css';

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lc=s=>String(s).trim().toLowerCase();

function GroupModal({init,users,onClose,onSave}){
  const [name,setName]=useState(init.name||''),[desc,setDesc]=useState(init.description||''),[members,setMembers]=useState([...new Set((init.member_emails||[]).map(lc))]);
  const [q,setQ]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const add=e=>{e=lc(e);if(!EMAIL.test(e)){setErr('電子郵件格式不正確');return}setErr('');setMembers(m=>m.includes(e)?m:[...m,e]);setQ('')};
  const needle=lc(q);
  const sugg=useMemo(()=>users.filter(u=>u.email&&!members.includes(lc(u.email))&&(!needle||[u.email,u.name,u.department].some(s=>(s||'').toLowerCase().includes(needle)))).slice(0,30),[users,members,needle]);
  async function submit(e){
    e.preventDefault();
    if(!name.trim())return setErr('請輸入群組名稱');
    if(name.trim().length>80)return setErr('名稱不可超過 80 字');
    setBusy(true);setErr('');
    try{await onSave({name:name.trim(),description:desc.trim(),member_emails:members})}
    catch(x){const m=errText(x);setErr(m.startsWith('409')?'已有同名的群組，請改用其他名稱':m)}finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><form className="modal" role="dialog" aria-modal="true" aria-label={init.id?'編輯群組':'新增群組'} onSubmit={submit}>
    <button type="button" className="icon-btn modal-close" aria-label="關閉" onClick={onClose}><X/></button>
    <h2>{init.id?'編輯群組':'新增群組'}</h2>
    <div className="field"><label>群組名稱</label><input autoFocus maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="例如：護理部"/></div>
    <div className="field"><label>說明</label><textarea rows={2} value={desc} onChange={e=>setDesc(e.target.value)}/></div>
    <div className="field"><label>成員（{members.length}）</label>
      <div className="lv-o-chips">{members.map(m=><span className="lv-o-chip" key={m}>{m}<button type="button" aria-label={'移除 '+m} onClick={()=>setMembers(a=>a.filter(x=>x!==m))}><X size={12}/></button></span>)}{!members.length&&<span className="muted small">尚未加入成員</span>}</div>
      <input aria-label="搜尋或輸入電子郵件" placeholder="搜尋使用者，或輸入電子郵件後按 Enter" value={q} onChange={e=>{setQ(e.target.value);setErr('')}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(q.trim())add(q)}}}/>
      <div className="lv-o-suggest">{sugg.map(u=><button type="button" key={u.email} onClick={()=>add(u.email)}><span>{u.name||u.email}<span className="lv-o-sub">{u.email}</span></span><span className="muted">{u.department||''}</span></button>)}
        {q.trim()&&!users.some(u=>lc(u.email||'')===needle)&&<button type="button" onClick={()=>add(q)}>加入電子郵件：{lc(q)}</button>}
        {!sugg.length&&!q.trim()&&<div className="muted small" style={{padding:10}}>沒有可加入的使用者</div>}</div>
      <span className="lv-o-help">電子郵件會轉為小寫並去除重複。</span>
    </div>
    {err&&<p className="lv-o-err" role="alert">{err}</p>}
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={busy}>{busy?'儲存中…':'儲存'}</button></div>
  </form></div>;
}

export default function GroupsPage({me,notify}){
  const admin=me?.role==='admin';
  const [rows,setRows]=useState(null),[users,setUsers]=useState([]),[editing,setEditing]=useState(null),[del,setDel]=useState(null);
  async function load(){try{const r=await api.listGroups();setRows(Array.isArray(r)?r:(r.groups||[]))}catch(e){setRows([]);notify('無法載入群組：'+errText(e))}}
  useOnce(async()=>{
    if(!admin)return;
    load();
    try{const r=await api.listUsers();setUsers(r.users||[])}catch(e){notify('無法載入使用者清單（仍可手動輸入電子郵件）：'+errText(e))}
  });
  const head=<div className="page-heading"><h1><UsersThree/>群組管理</h1>{admin&&<button className="btn primary" onClick={()=>setEditing({})}><Plus/>新增群組</button>}</div>;
  if(!admin)return <div className="lv-o">{head}<div className="panel access"><Lock size={36}/><h2>僅限管理員</h2><p>群組僅管理員可建立與編輯。</p></div></div>;
  async function openEdit(g){
    try{const full=await api.listGroups().then(r=>(Array.isArray(r)?r:r.groups||[]).find(x=>x.id===g.id)||g);setEditing({...full,member_emails:full.member_emails||g.member_emails||[]})}catch{setEditing(g)}
  }
  async function save(body){
    if(editing.id)await api.updateGroup(editing.id,body);else await api.createGroup(body);
    notify(editing.id?'已更新群組':'已建立群組');setEditing(null);await load();
  }
  async function remove(){try{await api.deleteGroup(del.id);notify('已刪除群組');setDel(null);await load()}catch(e){notify('刪除失敗：'+errText(e));setDel(null)}}
  return <div className="lv-o">{head}
    <p className="subtitle">建立使用者群組，用於 Agent、技能、排程與空間的分享對象。</p>
    {rows===null?<div className="lv-o-loading">載入中…</div>:<div className="lt" style={{'--cols':'minmax(140px,1fr) minmax(200px,2fr) 90px 84px'}}>
      <div className="lt-head"><span>名稱</span><span>說明</span><span>成員數</span><span/></div>
      {rows.map(g=><div className="lt-row" key={g.id}><b>{g.name}</b><span className="muted">{g.description||'—'}</span><span>{g.member_count??g.member_emails?.length??0}</span>
        <span className="lt-actions"><button className="icon-btn" aria-label={'編輯 '+g.name} onClick={()=>openEdit(g)}><PencilSimple/></button><button className="icon-btn" aria-label={'刪除 '+g.name} onClick={()=>setDel(g)}><Trash/></button></span></div>)}
      {!rows.length&&<Empty text="尚未建立任何群組。"/>}
    </div>}
    {editing&&<GroupModal init={editing} users={users} onClose={()=>setEditing(null)} onSave={save}/>}
    {del&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDel(null)}}><div className="modal" role="dialog" aria-modal="true" aria-label="確認刪除"><h2>刪除群組</h2><p>確定要刪除「{del.name}」？已分享給此群組的項目將失去該群組的存取權。</p><div className="modal-actions"><button className="btn" onClick={()=>setDel(null)}>取消</button><button className="btn primary" onClick={remove}>刪除</button></div></div></div>}
  </div>;
}
