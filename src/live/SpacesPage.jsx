import React,{useEffect,useState} from 'react';
import {Plus,Trash,ArrowLeft,FolderSimple,FileText,PencilSimple} from '@phosphor-icons/react';
import {api} from '../api';
import {AddModal,Field,Empty} from '../ListKit';
import {ShareDialog,ShareChip} from './ShareLive';
import {errText} from './kit';
import {isBuilder,isAdmin} from './pkit';
import {canEdit,canOwn,fmtDate,match,sameShare,useLoad,State,ROLE_LABEL} from './workkit';
import './work.css';

const TYPE={personal:'個人',team:'團隊',org:'全院'};

function SpaceForm({initial,admin,onClose,onSubmit}){
  return <AddModal title={initial?'編輯空間':'建立空間'} submitLabel={initial?'儲存':'建立'} onClose={onClose} onSubmit={f=>onSubmit({name:f.get('name').trim(),description:(f.get('description')||'').trim(),type:initial?initial.type:f.get('type')})}>
    <Field label="空間名稱"><input name="name" required maxLength={80} autoFocus defaultValue={initial?.name||''} placeholder="例如：心臟科研究資料"/></Field>
    {!initial&&<Field label="類型"><select name="type" defaultValue="team"><option value="personal">個人</option><option value="team">團隊</option>{admin&&<option value="org">全院</option>}</select></Field>}
    <Field label="說明"><textarea name="description" rows={3} defaultValue={initial?.description||''} placeholder="這個空間收納哪些資料"/></Field>
  </AddModal>;
}

function Picker({docs,have,onClose,onAdd}){
  const [sel,setSel]=useState(new Set()),[q,setQ]=useState('');
  const list=docs.filter(d=>!have.has(d.id)&&match(d.name||'',q));
  const flip=id=>setSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n});
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal" role="dialog" aria-modal="true" aria-label="加入文件">
    <h2>加入文件</h2><input aria-label="搜尋文件" placeholder="搜尋文件" value={q} onChange={e=>setQ(e.target.value)} style={{width:'100%',marginBottom:10}}/>
    <div className="lv-w-docs">{list.map(d=><label className="lv-w-doc" key={d.id}><input type="checkbox" checked={sel.has(d.id)} onChange={()=>flip(d.id)}/><FileText size={16}/>{d.name}<small>{d.department||''}</small></label>)}{!list.length&&<p className="muted small">沒有可加入的文件</p>}</div>
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" disabled={!sel.size} onClick={()=>onAdd([...sel])}>加入 {sel.size||''} 份</button></div>
  </section></div>;
}

function Detail({space,me,notify,docs,onBack,onChanged,onDeleted}){
  const [s,setS]=useState(space),[editing,setEditing]=useState(false),[sharing,setSharing]=useState(false),[picking,setPicking]=useState(false);
  const builder=isBuilder(me),edit=canEdit(s);
  const names=Object.fromEntries((docs||[]).map(d=>[d.id,d.name]));
  const ids=s.document_ids||null;
  const apply=n=>{setS(n);onChanged(n)};
  const run=async(fn,ok,fail)=>{try{const r=await fn();if(ok)notify(ok);return r}catch(e){notify(fail+errText(e))}};
  const refetch=async()=>{try{apply(await api.getSpace(s.id))}catch(e){notify('重新整理失敗：'+errText(e))}};
  return <>
    <div className="lv-w-bar"><button className="lv-w-back" onClick={onBack}><ArrowLeft size={18}/>空間</button></div>
    <div className="page-heading"><h1><FolderSimple/>{s.name}</h1><div className="lv-w-bar" style={{margin:0}}>
      <ShareChip share={s.share} label={'分享 '+s.name} onClick={()=>setSharing(true)}/>
      {edit&&<button className="btn" onClick={()=>setEditing(true)}><PencilSimple/>編輯</button>}
      {canOwn(s)&&<button className="btn" onClick={async()=>{if(!window.confirm(`刪除空間「${s.name}」？文件本身不會被刪除。`))return;try{await api.deleteSpace(s.id);notify('已刪除空間');onDeleted(s.id)}catch(e){notify('刪除失敗：'+errText(e))}}}><Trash/>刪除</button>}
    </div></div>
    <p className="subtitle">{s.description||'（無說明）'}</p>
    <div className="lv-w-meta"><span className="badge">{TYPE[s.type]||s.type}</span><span className="lv-w-role">{ROLE_LABEL[s.my_role]||s.my_role}</span><span className="muted small">擁有者 {s.owner_email||'—'} · 更新 {fmtDate(s.updated_at)}</span></div>
    <div className="page-heading" style={{marginTop:16}}><h3 style={{margin:0}}>文件（{s.documents_count??(ids||[]).length}）</h3>
      {edit&&builder&&<button className="btn primary" disabled={docs===null} onClick={()=>setPicking(true)}><Plus/>加入文件</button>}</div>
    <div className="lt" style={{'--cols':'1fr 130px 44px'}}>
      <div className="lt-head"><span>文件</span><span>部門</span><span/></div>
      {(ids||[]).map(id=>{const d=(docs||[]).find(x=>x.id===id);return <div className="lt-row" key={id}><span><FileText size={15}/> {names[id]||<span className="muted">{id}</span>}</span><span className="muted small">{d?.department||'—'}</span>
        {edit?<button className="icon-btn" aria-label={'移除 '+(names[id]||id)} onClick={async()=>{await run(()=>api.removeSpaceDoc(s.id,id),'已移除文件','移除失敗：')&&refetch()}}><Trash/></button>:<span/>}</div>})}
      {!(ids||[]).length&&<Empty text={ids===null&&s.documents_count?`此空間共有 ${s.documents_count} 份文件（無法顯示清單）`:'尚無文件'}/>}
    </div>
    {!builder&&<p className="lv-w-note">你的角色無法瀏覽文件庫，僅顯示文件編號與數量；加入文件需要建構者權限。</p>}
    {editing&&<SpaceForm initial={s} onClose={()=>setEditing(false)} onSubmit={async v=>{const r=await run(()=>api.updateSpace(s.id,{...v,document_ids:s.document_ids||[]}),'已更新空間','儲存失敗：');if(r){apply(r);setEditing(false)}}}/>}
    {picking&&<Picker docs={docs||[]} have={new Set(ids||[])} onClose={()=>setPicking(false)} onAdd={async sel=>{const r=await run(()=>api.addSpaceDocs(s.id,sel),'已加入文件','加入失敗：');if(r){apply(r);setPicking(false)}}}/>}
    {sharing&&<ShareDialog title={s.name} value={s.share} owner={s.owner_email||me.email} onClose={()=>setSharing(false)} onDone={async v=>{
      if(!canOwn(s)){notify('只有擁有者或管理員可以變更分享設定');setSharing(false);return}
      const r=await run(()=>api.shareSpace(s.id,v),'已更新分享設定','分享設定失敗：');if(r){apply(r);setSharing(false)}}}/>}
  </>;
}

/** 空間 (live, shared Spaces). Props: me = GET /api/me; notify(message). */
export default function SpacesPage({me,notify}){
  const [items,setItems,reload,err]=useLoad(api.listSpaces,'空間',notify);
  const [docs,setDocs]=useState(isBuilder(me)?null:[]),[q,setQ]=useState(''),[creating,setCreating]=useState(false),[open,setOpen]=useState(null);
  useEffect(()=>{if(isBuilder(me))api.listDocs().then(d=>setDocs(d||[])).catch(e=>{setDocs([]);notify('載入文件庫失敗：'+errText(e))})},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const put=n=>setItems(a=>(a||[]).map(x=>x.id===n.id?{...x,...n}:x));

  if(open){const s=items.find(x=>x.id===open);if(s)return <Detail key={s.id} space={s} me={me} notify={notify} docs={isBuilder(me)?docs:null} onBack={()=>setOpen(null)} onChanged={put} onDeleted={id=>{setItems(a=>a.filter(x=>x.id!==id));setOpen(null)}}/>}
  const rows=(items||[]).filter(s=>match(s.name+(s.description||''),q));
  return <>
    <div className="page-heading"><h1>空間</h1><button className="btn primary" onClick={()=>setCreating(true)}><Plus/>建立空間</button></div>
    <p className="subtitle">與同仁共享的文件集合：個人、團隊或全院。</p>
    <div className="toolbar"><label className="search"><input aria-label="搜尋" placeholder="搜尋空間" value={q} onChange={e=>setQ(e.target.value)}/></label></div>
    {items===null?<State/>:err&&!items.length?<State err={err} onRetry={reload}/>:!items.length?<div className="lv-state">還沒有空間。按「建立空間」開始。</div>:!rows.length?<div className="lv-state">找不到符合「{q}」的空間</div>:
    <div className="space-grid">{rows.map(s=><section className="panel space-card" key={s.id}>
      <span className="tile large"><FolderSimple/></span><h3>{s.name}</h3><p>{s.description||'（無說明）'}</p>
      <div className="lv-w-meta"><span className="badge">{TYPE[s.type]||s.type}</span><span className="lv-w-role">{ROLE_LABEL[s.my_role]||s.my_role}</span></div>
      <div className="card-bottom"><span className="small muted">{s.documents_count??0} 份文件</span><ShareChip share={s.share} label={'分享 '+s.name} onClick={()=>setOpen(s.id)}/><button className="text-button" onClick={()=>setOpen(s.id)}>開啟</button></div>
    </section>)}</div>}
    {creating&&<SpaceForm admin={isAdmin(me)} onClose={()=>setCreating(false)} onSubmit={async v=>{
      try{const s=await api.createSpace({...v,document_ids:[]});setItems(a=>[s,...(a||[])]);setCreating(false);notify('已建立空間')}catch(e){notify('建立失敗：'+errText(e))}}}/>}
  </>;
}
