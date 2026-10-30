import React,{useEffect,useMemo,useState} from 'react';
import {ArrowClockwise,ArrowLeft,CaretRight,Lock,Plus,Trash,UsersThree,UserPlus,X} from '@phosphor-icons/react';
import {api} from '../api';
import {ListToolbar,Empty,Toggle} from '../ListKit';
import {errText,useOnce} from './pkit';
import './ops.css';

// Member rule matches the backend GroupIn / add-members check: contains "@", no whitespace (BE-GROUP-SPEC Q2).
const PAGE=30,BATCH=100,MEMBER_LIMIT=1000;
const lc=s=>String(s||'').trim().toLowerCase();
const validEmail=e=>e.includes('@')&&!/\s/.test(e);
const REJECT={invalid_email:'格式不正確',domain_not_allowed:'網域不在允許清單',not_a_registered_account:'尚未建立帳號（請先到使用者管理預先註冊）'};

// Map API errors ("{status} {detail}") to the Chinese messages in FE-GROUP-SPEC §7.2.
function friendly(e){
  const m=errText(e);
  if(m.includes('member limit'))return `群組成員不可超過 ${MEMBER_LIMIT} 人`;
  if(m.startsWith('403'))return '權限不足，請聯絡系統管理員';
  if(m.startsWith('404'))return '此群組或成員已不存在，請重新整理';
  if(m.startsWith('422'))return '資料格式不正確，請檢查輸入內容';
  return '操作失敗：'+m;
}

function CreateModal({onClose,onCreated,notify}){
  const [name,setName]=useState(''),[desc,setDesc]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e){
    e.preventDefault();
    if(!name.trim())return setErr('請輸入群組名稱');
    if(name.trim().length>80)return setErr('群組名稱不可超過 80 字');
    setBusy(true);setErr('');
    try{const g=await api.createGroup({name:name.trim(),description:desc.trim(),member_emails:[]});notify('已建立群組');onCreated(g)}
    catch(x){setErr(friendly(x))}finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><form className="modal" role="dialog" aria-modal="true" aria-label="新增群組" onSubmit={submit}>
    <button type="button" className="icon-btn modal-close" aria-label="關閉" onClick={onClose}><X/></button>
    <h2>新增群組</h2>
    <div className="field"><label>群組名稱</label><input autoFocus maxLength={80} value={name} onChange={e=>{setName(e.target.value);setErr('')}} placeholder="例如：護理部"/></div>
    <div className="field"><label>說明</label><textarea rows={2} maxLength={500} value={desc} onChange={e=>setDesc(e.target.value)}/></div>
    {err&&<p className="lv-o-err" role="alert">{err}</p>}
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={busy}>{busy?'建立中…':'建立'}</button></div>
  </form></div>;
}

function AddMembersModal({group,members,notify,onClose,onDone}){
  const [users,setUsers]=useState(null),[q,setQ]=useState(''),[picked,setPicked]=useState([]),[manual,setManual]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null);
  useEffect(()=>{api.listUsers().then(r=>setUsers(r.users||[])).catch(e=>{setUsers([]);notify('無法載入使用者清單（仍可手動輸入電子郵件）：'+errText(e))})},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const memberSet=useMemo(()=>new Set(members.map(m=>m.email)),[members]);
  const needle=lc(q);
  // Suspended accounts are not suggested (FE-GROUP-SPEC Q1); they can still be typed in.
  const candidates=useMemo(()=>(users||[]).filter(u=>u.email&&u.status!=='suspended'&&!memberSet.has(lc(u.email))&&(!needle||[u.email,u.name,u.department].some(s=>(s||'').toLowerCase().includes(needle)))).slice(0,PAGE),[users,memberSet,needle]);
  const toggle=e=>setPicked(p=>p.includes(e)?p.filter(x=>x!==e):[...p,e]);

  async function submit(){
    const typed=manual.split(/[\s,，;；]+/).map(lc).filter(Boolean);
    const all=[...new Set([...picked,...typed])];
    if(!all.length)return setErr('請選擇或輸入電子郵件');
    const bad=all.filter(e=>!validEmail(e));
    if(bad.length)return setErr('格式不正確：'+bad.join('、'));
    if(memberSet.size+all.length>MEMBER_LIMIT)return setErr(`群組成員不可超過 ${MEMBER_LIMIT} 人`);
    setBusy(true);setErr('');
    try{
      const total={added:[],skipped:[],rejected:[]};
      for(let i=0;i<all.length;i+=BATCH){
        const r=await api.addGroupMembers(group.id,all.slice(i,i+BATCH));
        total.added.push(...r.added);total.skipped.push(...r.skipped);total.rejected.push(...r.rejected);
      }
      notify(`已加入 ${total.added.length} 人，略過 ${total.skipped.length} 人`);
      if(total.rejected.length){setResult(total);onDone()}else onDone(true);
    }catch(x){setErr(friendly(x))}finally{setBusy(false)}
  }

  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal" role="dialog" aria-modal="true" aria-label="加入成員">
    <button type="button" className="icon-btn modal-close" aria-label="關閉" onClick={onClose}><X/></button>
    <h2>加入成員</h2>
    <p className="muted small">只能加入已存在的帳號（含預先註冊）。新帳號請先到「使用者管理」預先註冊。</p>
    <div className="field"><label>搜尋使用者</label><input placeholder="搜尋姓名、電子郵件或科別" value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="lv-o-suggest">{users===null?<div className="muted small" style={{padding:10}}>載入中…</div>:candidates.map(u=><button type="button" key={u.email} aria-pressed={picked.includes(lc(u.email))} onClick={()=>toggle(lc(u.email))}><span>{u.name||u.email}<span className="lv-o-sub">{u.email}</span></span><span className="muted">{picked.includes(lc(u.email))?'已選':(u.department||'')}</span></button>)}
      {users!==null&&!candidates.length&&<div className="muted small" style={{padding:10}}>沒有可加入的使用者</div>}</div>
    <div className="field"><label>手動輸入（以逗號或空白分隔）</label><textarea rows={2} aria-label="手動輸入電子郵件" value={manual} onChange={e=>setManual(e.target.value)} placeholder="staff-a@example.test"/></div>
    {picked.length>0&&<div className="lv-o-chips">{picked.map(e=><span className="lv-o-chip" key={e}>{e}<button type="button" aria-label={'取消選取 '+e} onClick={()=>toggle(e)}><X size={12}/></button></span>)}</div>}
    {err&&<p className="lv-o-err" role="alert">{err}</p>}
    {result&&<div className="muted small">
      <p>已加入 {result.added.length} 人，略過 {result.skipped.length} 人，未加入 {result.rejected.length} 人：</p>
      <ul>{result.rejected.map(r=><li key={r.email}>{r.email}（{REJECT[r.reason]||r.reason}）</li>)}</ul>
    </div>}
    <div className="modal-actions">{result?<button className="btn primary" onClick={onClose}>完成</button>:<><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={busy} onClick={submit}>{busy?'加入中…':'加入'}</button></>}</div>
  </div></div>;
}

function MembersTab({group,notify,onCountChange}){
  const [members,setMembers]=useState(null),[q,setQ]=useState(''),[page,setPage]=useState(1),[adding,setAdding]=useState(false),[removing,setRemoving]=useState(null),[busy,setBusy]=useState(false);
  // picked: e-mails selected for batch removal; kept across pages, cleared when the search changes
  const [picked,setPicked]=useState(()=>new Set()),[batchOpen,setBatchOpen]=useState(false),[failed,setFailed]=useState([]);
  const load=async()=>{try{const r=await api.listGroupMembers(group.id);setMembers(r);onCountChange(r.length)}catch(e){setMembers(m=>m||[]);notify(friendly(e))}};
  useEffect(()=>{load()},[group.id]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{setPage(1);setPicked(new Set())},[q]);
  const needle=lc(q);
  const shown=useMemo(()=>(members||[]).filter(m=>!needle||[m.name,m.email,m.department].some(s=>(s||'').toLowerCase().includes(needle))),[members,needle]);
  const pages=Math.max(1,Math.ceil(shown.length/PAGE));
  const rows=shown.slice((page-1)*PAGE,page*PAGE);

  async function remove(){
    setBusy(true);
    try{await api.removeGroupMember(group.id,removing.email);notify('已移出 '+removing.email);setRemoving(null);await load()}
    catch(e){notify(friendly(e))}finally{setBusy(false)}  // keep the dialog open on failure (FE-GROUP-SPEC §5.2.3)
  }

  // Batch removal calls the single-member endpoint for each selected e-mail. Items that fail stay selected.
  const pickedList=[...picked];
  const pageEmails=rows.map(m=>m.email);
  const allOnPage=pageEmails.length>0&&pageEmails.every(e=>picked.has(e));
  const togglePick=e=>setPicked(p=>{const n=new Set(p);n.has(e)?n.delete(e):n.add(e);return n});
  const togglePage=()=>setPicked(p=>{const n=new Set(p);allOnPage?pageEmails.forEach(e=>n.delete(e)):pageEmails.forEach(e=>n.add(e));return n});
  async function removeBatch(){
    setBusy(true);
    const bad=[];
    for(const email of pickedList){
      try{await api.removeGroupMember(group.id,email)}catch(e){bad.push({email,msg:friendly(e)})}
    }
    const ok=pickedList.length-bad.length;
    notify(`已移出 ${ok} 人${bad.length?`，${bad.length} 人失敗`:''}`);
    setPicked(new Set(bad.map(b=>b.email)));
    setFailed(bad);
    if(!bad.length)setBatchOpen(false);  // stay open on partial failure so the user can retry
    await load();
    setBusy(false);
  }

  return <div>
    <div className="lt-toolbar" style={{marginBottom:12}}>
      <div className="lt-filters"><label className="search"><input aria-label="搜尋成員" placeholder="搜尋姓名、電子郵件或科別" value={q} onChange={e=>setQ(e.target.value)}/></label></div>
      <div className="lv-actions">
        {pickedList.length>0&&<><span className="muted small">已選 {pickedList.length} 人</span><button className="btn" style={{color:'#b91c1c'}} disabled={busy} onClick={()=>{setFailed([]);setBatchOpen(true)}}><Trash/>移出所選</button></>}
        <button className="btn primary" onClick={()=>setAdding(true)}><UserPlus/>加入成員</button>
      </div>
    </div>
    {members===null?<div className="lv-o-loading">載入中…</div>:<div className="lt" style={{'--cols':'36px minmax(220px,2fr) 110px 56px'}}>
      <div className="lt-head"><span><input type="checkbox" aria-label="選取本頁所有成員" checked={allOnPage} disabled={!rows.length} onChange={togglePage}/></span><span>姓名與電子郵件</span><span>帳號狀態</span><span/></div>
      {rows.map(m=><div className="lt-row" key={m.email}>
        <span><input type="checkbox" aria-label={'選取 '+m.email} checked={picked.has(m.email)} onChange={()=>togglePick(m.email)}/></span>
        <span><b>{m.name||'（尚未登入）'}</b><br/><span className="muted small">{m.email}</span></span>
        <span>{!m.has_account?<span className="lv-pill" style={{color:'#b45309'}}>帳號不存在</span>:m.status==='suspended'?<span className="lv-pill" style={{color:'#b91c1c'}}>停用</span>:<span className="lv-pill" style={{color:'#15803d'}}>啟用</span>}</span>
        <span className="lt-actions"><button className="icon-btn" aria-label={'移除 '+m.email} onClick={()=>setRemoving(m)}><Trash/></button></span>
      </div>)}
      {!shown.length&&<Empty text={members.length?'沒有符合條件的成員。':'尚未加入成員。'}/>}
    </div>}
    {shown.length>PAGE&&<div className="lv-pager"><span>共 {shown.length} 人，第 {page} / {pages} 頁</span><span className="lv-actions"><button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一頁</button><button className="btn" disabled={page===pages} onClick={()=>setPage(p=>p+1)}>下一頁</button></span></div>}
    {adding&&<AddMembersModal group={group} members={members||[]} notify={notify} onClose={()=>setAdding(false)} onDone={closeIt=>{if(closeIt)setAdding(false);load()}}/>}
    {batchOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setBatchOpen(false)}}><div className="modal" role="dialog" aria-modal="true" aria-label="確認批次移出">
      <h2>批次移出成員</h2><p>確定要將所選的 {pickedList.length} 位成員移出「{group.name}」？</p>
      {failed.length>0&&<div className="lv-o-err" role="alert"><p>以下 {failed.length} 人未移出：</p><ul>{failed.map(f=><li key={f.email}>{f.email}（{f.msg}）</li>)}</ul></div>}
      <div className="modal-actions"><button className="btn" disabled={busy} onClick={()=>setBatchOpen(false)}>取消</button><button className="btn primary" disabled={busy||!pickedList.length} onClick={removeBatch}>{busy?'移出中…':'移出'}</button></div>
    </div></div>}
    {removing&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setRemoving(null)}}><div className="modal" role="dialog" aria-modal="true" aria-label="確認移出">
      <h2>移出成員</h2><p>確定要將 {removing.email} 移出「{group.name}」？</p>
      <div className="modal-actions"><button className="btn" disabled={busy} onClick={()=>setRemoving(null)}>取消</button><button className="btn primary" disabled={busy} onClick={remove}>移出</button></div>
    </div></div>}
  </div>;
}

const ROLE_PICK_LIMIT=10;
const sameIds=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);

function InfoTab({group,notify,onDirtyChange,onSaved}){
  const [name,setName]=useState(group.name||''),[desc,setDesc]=useState(group.description||''),[roleIds,setRoleIds]=useState(group.role_ids||[]),[roleList,setRoleList]=useState([]),[roleQ,setRoleQ]=useState(''),[roleFocus,setRoleFocus]=useState(false),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const dirty=name.trim()!==(group.name||'')||desc.trim()!==(group.description||'')||!sameIds(roleIds,group.role_ids||[]);
  useEffect(()=>{onDirtyChange(dirty)},[dirty]);// eslint-disable-line react-hooks/exhaustive-deps
  // role list is loaded once; a failure only hides the names, the ids are still shown
  useEffect(()=>{api.listRoles().then(r=>setRoleList(r.roles||[])).catch(()=>{})},[]);
  const roleName=id=>roleList.find(r=>r.id===id)?.name||id;
  // Search box: case-insensitive, matches id or name; already-linked roles are excluded; at most ROLE_PICK_LIMIT shown
  const needle=lc(roleQ);
  const matches=roleList.filter(r=>!roleIds.includes(r.id)&&(!needle||r.id.toLowerCase().includes(needle)||(r.name||'').toLowerCase().includes(needle)));
  const pick=id=>{setRoleIds(a=>a.includes(id)?a:[...a,id]);setRoleQ('')};

  async function save(e){
    e.preventDefault();
    if(!name.trim())return setErr('請輸入群組名稱');
    if(name.trim().length>80)return setErr('群組名稱不可超過 80 字');
    setBusy(true);setErr('');
    try{
      // PATCH sends name, description and role_ids only, so the member list is never overwritten here.
      const g=await api.updateGroupInfo(group.id,{name:name.trim(),description:desc.trim(),role_ids:roleIds});
      notify('已更新群組');onSaved(g);
    }catch(x){setErr(friendly(x))}finally{setBusy(false)}
  }

  return <form onSubmit={save} style={{maxWidth:560,display:'grid',gap:12}}>
    <div className="field"><label>群組名稱</label><input maxLength={80} value={name} onChange={e=>{setName(e.target.value);setErr('')}}/></div>
    <div className="field"><label>說明</label><textarea rows={3} maxLength={500} value={desc} onChange={e=>setDesc(e.target.value)}/></div>
    <div className="field"><label>角色</label>
      {/* Selected roles are compact tags on the same row as the search box; the candidate list only shows while the box has focus. */}
      <div className="role-picker" style={{position:'relative'}}>
        <div className="lv-o-chips" style={{margin:0,alignItems:'center',border:'1px solid #dce9e3',borderRadius:9,padding:'4px 6px',background:'#fff'}}>
          {roleIds.map(id=><span className="lv-o-chip" key={id} style={{padding:'1px 4px 1px 8px',fontSize:11}}>{roleName(id)}<button type="button" aria-label={'移除角色 '+roleName(id)} onClick={()=>setRoleIds(a=>a.filter(x=>x!==id))}><X size={10}/></button></span>)}
          <input type="search" aria-label="搜尋角色" placeholder={roleIds.length?'':'搜尋角色名稱或代號'} value={roleQ} style={{border:0,outline:'none',flex:'1 1 120px',minWidth:120,padding:'3px 4px'}}
            onChange={e=>setRoleQ(e.target.value)} onFocus={()=>setRoleFocus(true)} onBlur={()=>setRoleFocus(false)}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(matches[0])pick(matches[0].id)}}}/>
        </div>
        {(roleFocus||roleQ)&&<div className="lv-o-suggest" role="listbox" aria-label="待選角色" style={{position:'absolute',left:0,right:0,zIndex:5,boxShadow:'0 6px 18px rgba(0,0,0,.08)'}}>
          {matches.slice(0,ROLE_PICK_LIMIT).map(r=><button type="button" role="option" aria-selected={false} key={r.id} onMouseDown={e=>e.preventDefault()} onClick={()=>pick(r.id)}><span>{r.name||r.id}</span><span className="muted small">{r.id}</span></button>)}
          {!matches.length&&<div className="muted small" style={{padding:10}}>{roleList.length?'沒有符合的角色':'角色清單載入中…'}</div>}
          {matches.length>ROLE_PICK_LIMIT&&<div className="muted small" style={{padding:10}}>僅顯示前 {ROLE_PICK_LIMIT} 筆，請輸入更多條件縮小範圍</div>}
        </div>}
      </div>
      <span className="lv-o-help">角色目前只記錄關聯，不影響任何功能的存取權限。</span>
    </div>
    {err&&<p className="lv-o-err" role="alert">{err}</p>}
    <div className="lv-actions"><button className="btn primary" disabled={busy||!dirty}>{busy?'儲存中…':'儲存'}</button></div>
  </form>;
}

function GroupDetail({group:initial,notify,onBack,onChanged}){
  const [group,setGroup]=useState(initial),[dirty,setDirty]=useState(false),[delOpen,setDelOpen]=useState(false),[delBusy,setDelBusy]=useState(false),[infoOpen,setInfoOpen]=useState(true),[membersOpen,setMembersOpen]=useState(true);
  const [memberCount,setMemberCount]=useState(initial.member_count??initial.member_emails?.length??0);
  async function remove(){
    setDelBusy(true);
    try{await api.deleteGroup(group.id);notify('已刪除群組');onChanged();onBack()}
    catch(e){notify(friendly(e))}finally{setDelBusy(false)}  // keep the dialog open on failure (FE-GROUP-SPEC §5.3.1)
  }
  const back=()=>{if(dirty&&!window.confirm('放棄未儲存的變更？'))return;onBack()};
  return <div className="lv-o">
    <div className="page-heading"><h1><button className="icon-btn" aria-label="返回群組列表" onClick={back}><ArrowLeft/></button>{group.name}</h1><div className="lv-actions"><button className="btn" style={{color:'#b91c1c'}} onClick={()=>setDelOpen(true)}><Trash/>刪除群組</button></div></div>
    <p className="subtitle">成員 {memberCount} 人。群組目前不影響使用者的存取權限。</p>
    {/* Sections stay mounted when collapsed (display only) so unsaved edits and loaded members are kept. */}
    <section style={{marginBottom:28}}>
      <div className="lv-actions" style={{justifyContent:'space-between',marginBottom:12}}>
        <h2 style={{fontSize:16,margin:0}}>基本資料</h2><Toggle on={infoOpen} onChange={setInfoOpen} label="展開或收合基本資料"/>
      </div>
      <div style={{display:infoOpen?undefined:'none'}}><InfoTab group={group} notify={notify} onDirtyChange={setDirty} onSaved={g=>{setGroup({...group,...g});setDirty(false);onChanged()}}/></div>
    </section>
    <section>
      <div className="lv-actions" style={{justifyContent:'space-between',marginBottom:12}}>
        <h2 style={{fontSize:16,margin:0}}>成員（{memberCount}）</h2><Toggle on={membersOpen} onChange={setMembersOpen} label="展開或收合成員名單"/>
      </div>
      <div style={{display:membersOpen?undefined:'none'}}><MembersTab group={group} notify={notify} onCountChange={setMemberCount}/></div>
    </section>
    {delOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!delBusy)setDelOpen(false)}}><div className="modal" role="dialog" aria-modal="true" aria-label="確認刪除">
      <h2>刪除群組</h2><p>確定要刪除「{group.name}」？群組的 {memberCount} 位成員名單將一併刪除。</p>
      <div className="modal-actions"><button type="button" className="btn" disabled={delBusy} onClick={()=>setDelOpen(false)}>取消</button><button type="button" className="btn primary" disabled={delBusy} onClick={remove}>{delBusy?'刪除中…':'刪除'}</button></div>
    </div></div>}
  </div>;
}

export default function GroupsPage({me,notify}){
  const admin=me?.role==='admin';
  const [rows,setRows]=useState(null),[q,setQ]=useState(''),[creating,setCreating]=useState(false),[opened,setOpened]=useState(null),[busy,setBusy]=useState(false);
  async function load(){
    setBusy(true);
    try{const r=await api.listGroups();setRows(Array.isArray(r)?r:(r.groups||[]))}
    catch(e){setRows(d=>d||[]);notify('無法載入群組：'+errText(e))}finally{setBusy(false)}
  }
  useOnce(async()=>{if(admin)load()});
  const head=<div className="page-heading"><h1><UsersThree/>群組管理</h1>{admin&&!opened&&<div className="lv-actions"><button className="btn" onClick={load} disabled={busy}><ArrowClockwise className={busy?'lv-spin':''}/>重新整理</button><button className="btn primary" onClick={()=>setCreating(true)}><Plus/>新增群組</button></div>}</div>;
  if(!admin)return <div className="lv-o">{head}<div className="panel access"><Lock size={36}/><h2>僅限管理員</h2><p>群組僅管理員可建立與編輯。</p></div></div>;
  if(opened)return <GroupDetail group={opened} notify={notify} onBack={()=>{setOpened(null);load()}} onChanged={()=>{}}/>;

  const needle=lc(q);
  const shown=(rows||[]).filter(g=>!needle||[g.name,g.description].some(s=>(s||'').toLowerCase().includes(needle)));
  return <div className="lv-o">{head}
    <p className="subtitle">建立群組並維護成員名單。群組目前不影響使用者的存取權限。</p>
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋群組名稱或說明" tabs={[]} tab="" onTab={()=>{}}/>
    {rows===null?<div className="lv-o-loading">載入中…</div>:<div className="lt" style={{'--cols':'minmax(140px,1fr) minmax(200px,2fr) 90px 24px'}}>
      <div className="lt-head"><span>名稱</span><span>說明</span><span>成員數</span><span/></div>
      {shown.map(g=><div className="lt-row" key={g.id} role="button" tabIndex={0} style={{cursor:'pointer'}} onClick={()=>setOpened(g)} onKeyDown={e=>{if(e.key==='Enter')setOpened(g)}}>
        <b>{g.name}</b><span className="muted">{g.description||'—'}</span><span>{g.member_count??g.member_emails?.length??0}</span><CaretRight/>
      </div>)}
      {!shown.length&&<Empty text={rows.length?'沒有符合條件的群組。':'尚未建立任何群組。'}/>}
    </div>}
    {creating&&<CreateModal notify={notify} onClose={()=>setCreating(false)} onCreated={g=>{setCreating(false);setOpened(g)}}/>}
  </div>;
}
