import React,{useMemo,useState} from 'react';
import {MagnifyingGlass,X,Database,Atom} from '@phosphor-icons/react';
import {api} from '../api';
import {useOnce,Loading,fmtTime} from './pkit';
import './pickdata.css';

export const KIND_LABEL={postgres:'PostgreSQL',mysql:'MySQL',mssql:'SQL Server',bigquery:'BigQuery',cloud_sql_postgres:'Cloud SQL',cloud_sql_mysql:'Cloud SQL',cloud_sql_mssql:'Cloud SQL'};
const TABS=[['all','全部'],['space','空間'],['db','資料庫']];

/* 新增資料: pick knowledge spaces and databases for this conversation (what the + 新增 in the 資料範圍 menu opens). */
export default function PickData({live,picked,onSave,onClose}){
  const [rows,setRows]=useState(null),[tab,setTab]=useState('all'),[q,setQ]=useState(''),[sel,setSel]=useState(()=>new Set(picked.map(p=>p.t+':'+p.id)));
  useOnce(()=>{
    if(!live){setRows([{t:'space',id:'s1',name:'院內指引',sub:'12 份文件',at:Date.now()-864e5},{t:'db',id:'d1',name:'藥局資料庫',sub:'PostgreSQL · 2 個查詢 · 1 個檢視表'}]);return}
    Promise.all([api.listSpaces().catch(()=>[]),api.myDbConnectors().catch(()=>[])]).then(([sp,db])=>setRows([
      ...(sp||[]).map(s=>({t:'space',id:s.id,name:s.name,sub:`${s.documents_count||0} 份文件`,at:s.updated_at,owner:s.owner_email})),
      ...(db||[]).map(d=>({t:'db',id:d.id,name:d.name,sub:[KIND_LABEL[d.kind]||d.kind,d.queries?.length&&`${d.queries.length} 個查詢`,d.views?.length&&`${d.views.length} 個檢視表`].filter(Boolean).join(' · ')}))]));
  });
  const list=useMemo(()=>(rows||[]).filter(r=>(tab==='all'||r.t===tab)&&(!q.trim()||(r.name+r.sub).toLowerCase().includes(q.trim().toLowerCase()))),[rows,tab,q]);
  const key=r=>r.t+':'+r.id,flip=r=>setSel(s=>{const n=new Set(s);n.has(key(r))?n.delete(key(r)):n.add(key(r));return n});
  const save=()=>onSave((rows||[]).filter(r=>sel.has(key(r))).map(r=>({t:r.t,id:r.id,name:r.name})));
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal pd-dialog" role="dialog" aria-modal="true" aria-label="新增資料">
    <header><h2>新增資料</h2><button type="button" className="icon-btn" aria-label="關閉" onClick={onClose}><X size={16}/></button></header>
    <p className="pd-sub">選擇這次對話要讓 AI 參考的空間與資料庫。資料庫能查到什麼，仍依你所屬群組的規則。</p>
    <label className="search pd-search"><MagnifyingGlass size={15}/><input autoFocus aria-label="搜尋" placeholder="搜尋空間或資料庫" value={q} onChange={e=>setQ(e.target.value)}/></label>
    <div className="pd-tabs" role="tablist">{TABS.map(([k,l])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'on':''} onClick={()=>setTab(k)}>{l}</button>)}</div>
    <div className="pd-table">{rows===null?<Loading/>:list.length?<table><thead><tr><th/><th>名稱</th><th>類型</th><th>內容</th></tr></thead><tbody>{list.map(r=><tr key={key(r)} onClick={()=>flip(r)} className={sel.has(key(r))?'on':''}>
      <td><input type="checkbox" aria-label={'選擇 '+r.name} checked={sel.has(key(r))} onChange={()=>flip(r)} onClick={e=>e.stopPropagation()}/></td>
      <td><span className="pd-name">{r.t==='db'?<Database size={18}/>:<Atom size={18}/>}{r.name}</span></td><td><span className="pd-pill">{r.t==='db'?'資料庫':'空間'}</span></td><td className="pd-meta">{r.sub}</td></tr>)}</tbody></table>
      :<p className="pd-empty">{rows.length?'沒有符合的項目':'目前沒有可選的空間或資料庫。空間可在「空間」頁建立；資料庫需由管理員授權。'}</p>}</div>
    <footer><span className="pd-count">已選 {sel.size} 項</span><span className="grow"/><button className="btn" onClick={onClose}>取消</button><button className="btn primary" onClick={save}>儲存</button></footer>
  </section></div>;
}
