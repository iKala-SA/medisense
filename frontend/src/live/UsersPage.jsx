import React,{useEffect,useMemo,useState,useCallback} from 'react';
import {UserPlus,DownloadSimple,ArrowClockwise,ArrowLeft,ClockCounterClockwise,Lock,Warning,Info,Trash,CaretRight} from '@phosphor-icons/react';
import {api,saveBlob} from '../api';
import {ListToolbar,AddModal,Field,Empty} from '../ListKit';
import {ROLES,ROLE_LABEL,STATUSES,fmtDateTime,errText} from './constants';
import {useOrgGroups,groupName} from './orgGroups';
import {Loading,Notice} from './shared';
import './admin.css';

const TABS=['全部','啟用','停用'];
const inTab=(u,t)=>t==='全部'||(t==='啟用'&&u.status!=='suspended')||(t==='停用'&&u.status==='suspended');
const PAGE=30;

const RoleBadge=({role})=><span className={'lv-pill '+(role==='admin'?'brand':role==='builder'?'soft':'')}>{ROLE_LABEL[role]||role}</span>;
const StatusBadge=({u})=>u.status==='suspended'?<span className="lv-pill err"><i/>停用</span>:<span className="lv-pill ok"><i/>啟用</span>;
const Avatar=({u})=><span className={'lv-avatar '+(u.status==='suspended'?'off':'')}>{(u.name||u.email||'?').slice(0,1).toUpperCase()}</span>;

export default function UsersPage({me,notify,goAudit}){
  const [dir,setDir]=useState(null);
  const [tab,setTab]=useState('全部');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const [adding,setAdding]=useState(false);
  const orgGroups=useOrgGroups();
  const [editing,setEditing]=useState(null);
  const [exporting,setExporting]=useState(false);
  const [busy,setBusy]=useState(false);
  const [role,setRole]=useState('');
  const [statsOpen,setStatsOpen]=useState(true);
  // UI only: the API enforces `users` (write, export) and `users`/`users-viewer` (read).
  const perms=me?.permissions||[],canEdit=perms.includes('users'),canView=canEdit||perms.includes('users-viewer');

  const load=useCallback(()=>{
    setBusy(true);
    return api.listUsers().then(setDir).catch(e=>{notify?.('載入使用者失敗：'+errText(e));setDir(d=>d||{users:[]})}).finally(()=>setBusy(false));
  },[notify]);
  // mount only: `notify` changes identity on every App render, so depending on it would re-call the API after a failure
  useEffect(()=>{if(canView)load()},[canView]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>setPage(1),[tab,search,role]);

  const users=dir?.users||[];
  // stat cards show totals across all users, not the current filter
  const suspendedCount=users.filter(u=>u.status==='suspended').length;
  const needle=search.trim().toLowerCase();
  const shown=useMemoList(users,tab,needle,role);
  const pages=Math.max(1,Math.ceil(shown.length/PAGE));
  if(!canView)return <div className="card-page lv-page"><Empty text="沒有使用者管理權限，請聯絡系統管理員。"/></div>;

  const rows=shown.slice((page-1)*PAGE,page*PAGE);

  async function exportCsv(){
    setExporting(true);
    try{saveBlob(await api.usersCsv(),'tcvgh-accounts.csv');notify?.('已匯出帳號清冊')}
    catch(e){notify?.('匯出失敗：'+errText(e))}finally{setExporting(false)}
  }
  async function preregister(fd){
    const email=String(fd.get('email')||'').trim().toLowerCase();
    if(!email||!email.includes('@')){notify?.('請輸入有效的電子郵件');return}
    try{
      await api.preregisterUser(email,fd.get('role'),'');
      const gid=fd.get('group')||'';
      if(gid){try{await api.addGroupMembers(gid,[email])}catch(e){notify?.('已預先登錄，但加入群組失敗：'+errText(e))}}
      setAdding(false);notify?.(`已預先登錄 ${email}`);load()}
    catch(e){notify?.('預先登錄失敗：'+errText(e))}
  }

  if(editing)return <UserEdit email={editing} me={me} readOnly={!canEdit} notify={notify} goAudit={goAudit} onBack={()=>{setEditing(null);load()}}/>;

  return <div className="card-page lv-page">
    <div className="page-heading"><h1>使用者管理</h1><div className="lv-actions">
      <button className="btn" onClick={load} disabled={busy}><ArrowClockwise className={busy?'lv-spin':''}/>重新整理</button>
      {canEdit&&<button className="btn" onClick={exportCsv} disabled={exporting||!dir}><DownloadSimple/>匯出 CSV</button>}
      {canEdit&&<button className="btn primary" onClick={()=>setAdding(true)}><UserPlus/>預先註冊</button>}
    </div></div>
    <p className="subtitle">管理同仁的平台角色、所屬群組與帳號狀態。角色與狀態變更需填寫原因，並寫入稽核記錄。</p>
    <div className="lv-stats-toggle"><button className="lv-stats-btn" aria-label={statsOpen?'收合統計':'展開統計'} aria-expanded={statsOpen} onClick={()=>setStatsOpen(o=>!o)}>+</button></div>
    {statsOpen&&<div className="lv-stats">{[['使用者人數',users.length],['啟用人數',users.length-suspendedCount],['停用人數',suspendedCount]].map(([label,n])=><div className="lv-card lv-stat" key={label}><span className="muted small">{label}</span><b>{n}</b></div>)}</div>}
    <ListToolbar search={search} onSearch={setSearch} placeholder="搜尋姓名或電子郵件" tabs={TABS} tab={tab} onTab={setTab} filters={<>
      <select className="lv-select" aria-label="角色" value={role} onChange={e=>setRole(e.target.value)}><option value="">全部角色</option>{ROLES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select>
    </>}/>
    {dir===null?<Loading/>:<div className="lt">
      <div className="lt-head" style={{'--cols':'1.6fr 1fr 1fr .9fr 1fr 24px'}}><span>姓名</span><span>群組</span><span>角色</span><span>狀態</span><span>最近登入</span><span/></div>
      {rows.map(u=><div key={u.email} className="lt-row" style={{'--cols':'1.6fr 1fr 1fr .9fr 1fr 24px',cursor:'pointer'}} onClick={()=>setEditing(u.email)}>
        <span className="lv-name"><Avatar u={u}/><span><b>{u.name||'（尚未登入）'}</b><small style={{display:'block',overflow:'hidden',textOverflow:'ellipsis'}}>{u.email}</small></span></span>
        <span title={(u.groups||[]).map(id=>groupName(orgGroups,id)).join('、')}>{(u.groups||[]).length?(u.groups||[]).map(id=>groupName(orgGroups,id)).join('、'):'—'}</span>
        <span><RoleBadge role={u.role}/></span>
        <span><StatusBadge u={u}/></span>
        <span className="muted small">{u.last_seen_at?fmtDateTime(u.last_seen_at):'—'}</span>
        <CaretRight className="muted"/>
      </div>)}
      {rows.length===0&&<Empty text={users.length===0?'目前沒有使用者資料。':'沒有符合條件的使用者。'}/>}
    </div>}
    {shown.length>PAGE&&<div className="lv-pager"><span>共 {shown.length} 人，第 {page} / {pages} 頁</span><span className="lv-actions"><button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一頁</button><button className="btn" disabled={page===pages} onClick={()=>setPage(p=>p+1)}>下一頁</button></span></div>}
    {adding&&<AddModal title="預先註冊使用者" hint="同仁首次以院內 Google 帳號登入時，會套用此角色與群組。" submitLabel="預先註冊" onClose={()=>setAdding(false)} onSubmit={preregister}>
      <Field label="電子郵件"><input name="email" type="email" required placeholder="name@example.org" autoFocus/></Field>
      <Field label="角色"><select name="role" defaultValue="user">{ROLES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
      <Field label="群組"><select name="group" defaultValue=""><option value="">不加入群組</option>{(orgGroups||[]).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
    </AddModal>}
  </div>;
}

// plain helper (not a hook name) to keep hook order stable across the admin guard above
function useMemoList(users,tab,needle,role){
  return useMemo(()=>users.filter(u=>inTab(u,tab)&&(!role||u.role===role)&&(!needle||[u.name,u.email].some(s=>(s||'').toLowerCase().includes(needle)))),[users,tab,needle,role]);
}

const SYSTEM_ROLE_IDS=['admin','builder','user'];
/* The role a person shows in 編輯使用者: an assigned custom role (users.roles) if there is one, else the account role. */
const roleOf=u=>(u.roles||[]).find(r=>!SYSTEM_ROLE_IDS.includes(r))||u.role;

function UserEdit({email,me,readOnly,notify,goAudit,onBack}){
  const [u,setU]=useState(null);
  const [roleSel,setRoleSel]=useState('user');  // a role id from 角色管理 (system or custom)
  const [status,setStatus]=useState('active');
  const [memberOf,setMemberOf]=useState([]);  // group ids, from 群組管理
  const orgGroups=useOrgGroups();
  const [roles,setRoles]=useState(null);      // GET /api/roles: the real roles, system and custom
  const [gq,setGq]=useState('');
  const [origView,setOrigView]=useState(false);
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState(false);

  const reset=x=>{setU(x);setRoleSel(roleOf(x));setStatus(x.status);setMemberOf(x.groups||[]);setOrigView(!!x.original_view);setReason('')};
  useEffect(()=>{api.getUser(email).then(reset).catch(e=>{notify?.('載入使用者失敗：'+errText(e));onBack()})},[email]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{api.listRoles().then(r=>setRoles(Array.isArray(r)?r:(r?.roles||[]))).catch(()=>setRoles(ROLES.map(x=>({id:x.id,name:x.label,en:x.en,desc:x.desc,can:x.can,custom:false}))))},[]);

  if(!u)return <div className="card-page lv-page"><Loading/></div>;

  const self=!!u.uid&&u.uid===me?.uid||(!!me?.email&&me.email.toLowerCase()===u.email.toLowerCase());
  const locked=self||u.bootstrap_admin||readOnly;  // roles and status cannot be changed
  const custom=!SYSTEM_ROLE_IDS.includes(roleSel);
  const accountRole=custom?'user':roleSel;  // a custom role rides on the base 一般使用者 account; its permissions come from the role
  const roleIds=[roleSel];
  const rolesChanged=roleSel!==roleOf(u);  // the assigned role list becomes exactly the picked role
  const viewChanged=origView!==!!u.original_view;
  const accessChanged=accountRole!==u.role||status!==u.status||viewChanged;
  const had=new Set(u.groups||[]),now=new Set(memberOf);
  const joined=memberOf.filter(g=>!had.has(g)),left=(u.groups||[]).filter(g=>!now.has(g));
  const groupsChanged=joined.length+left.length>0;
  const dirty=accessChanged||rolesChanged||groupsChanged;
  const needReason=accessChanged&&!reason.trim();
  const owned=u.owned||{agents:0,published_agents:0,connectors:0,documents:0};
  const ownsSomething=owned.agents+owned.connectors+owned.documents>0;
  const demoting=u.role!=='user'&&accountRole==='user'&&ownsSomething;
  const suspending=status==='suspended'&&u.status!=='suspended';
  const roleRow=id=>(roles||[]).find(r=>r.id===id);
  const roleLabel=id=>roleRow(id)?.name||ROLE_LABEL[id]||id;

  async function save(){
    setBusy(true);setSaved(false);
    try{
      // group membership lives in 群組管理: one add / remove per change (each is audited there)
      for(const g of joined)await api.addGroupMembers(g,[u.email]);
      for(const g of left)await api.removeGroupMember(g,u.email);
      const patch={...(accountRole!==u.role?{role:accountRole}:{}),...(rolesChanged?{roles:roleIds}:{}),...(status!==u.status?{status}:{}),
        ...(viewChanged?{original_view:origView}:{}),reason:reason.trim()};
      reset(accessChanged||rolesChanged?await api.updateUser(u.email,patch):await api.getUser(u.email));setSaved(true);notify?.('已儲存並寫入稽核記錄');
    }catch(e){notify?.('儲存失敗：'+errText(e))}finally{setBusy(false)}
  }
  async function cancelPrereg(){
    if(!window.confirm(`取消 ${u.email} 的預先註冊？對方之後登入時會以「一般使用者」建立帳號。`))return;
    try{await api.cancelPreregistration(u.email);notify?.('已取消預先註冊');onBack()}
    catch(e){notify?.('取消失敗：'+errText(e))}
  }

  const summary=[roleSel!==roleOf(u)&&`角色 ${roleLabel(roleOf(u))} → ${roleLabel(roleSel)}`,status!==u.status&&(suspending?'停用帳號':'恢復帳號'),viewChanged&&(origView?'授予原始檔檢視':'撤銷原始檔檢視'),
    joined.length>0&&`加入 ${joined.map(g=>groupName(orgGroups,g)).join('、')}`,left.length>0&&`移出 ${left.map(g=>groupName(orgGroups,g)).join('、')}`].filter(Boolean).join('、');
  const shownGroups=(orgGroups||[]).filter(g=>!gq.trim()||g.name.toLowerCase().includes(gq.trim().toLowerCase()));

  return <div className="card-page lv-page ue">
    <button className="lv-back" onClick={onBack}><ArrowLeft/>返回使用者列表</button>

    <header className="ue-head">
      <Avatar u={u}/>
      <div className="ue-who">
        <h1>{u.name||'（尚未登入）'}<RoleBadge role={u.role}/><StatusBadge u={u}/></h1>
        <p>{u.email}{u.bootstrap_admin&&<span className="ue-tag">固定管理員</span>}{self&&<span className="ue-tag">您自己的帳號</span>}</p>
        <div className="ue-facts"><span>帳號建立 {fmtDateTime(u.created_at)}</span><span>最後活動 {fmtDateTime(u.last_seen_at)}</span>
          <span>{owned.agents} 個 Agent · {owned.connectors} 個連接器 · {owned.documents} 份文件</span></div>
      </div>
      {goAudit&&<button className="btn" onClick={()=>goAudit(u.email)}><ClockCounterClockwise/>個人稽核記錄</button>}
    </header>

    {readOnly&&<Notice icon={<Lock size={16}/>}>您為唯讀檢視，無法變更使用者資料。</Notice>}
    {(self||u.bootstrap_admin)&&<Notice icon={<Lock size={16}/>}>{self?'不能變更自己的角色與狀態，請由另一位管理員操作。':'此帳號列在部署設定 ADMIN_EMAILS，永遠是管理員且不能停用。'}所屬群組仍可修改。</Notice>}

    <div className="ue-grid">
      <section className="ue-panel">
        <div className="ue-panel-h"><h2>角色</h2><span>{roles?`${roles.length} 個角色`:''}</span></div>
        <p className="ue-sub">每位同仁一個角色。自訂角色以一般使用者為基礎，權限依角色管理中的設定。</p>
        <div className="ue-list" role="radiogroup" aria-label="角色">
          {roles===null?<p className="ue-empty">載入中…</p>:roles.map(r=>{const on=roleSel===r.id,off=r.suspended===true||r.status===false;
            return <button key={r.id} type="button" role="radio" aria-checked={on} disabled={locked||off} className={'ue-item'+(on?' on':'')} onClick={()=>setRoleSel(r.id)}>
              <span className="ue-radio"/><span className="ue-item-t"><b>{r.name}{r.custom&&<em>自訂</em>}{off&&<em className="off">已停用</em>}{r.id===roleOf(u)&&<em className="cur">目前</em>}</b>
                <small>{r.desc||(r.can||[]).join('、')||r.en||''}</small></span></button>})}
        </div>
        {demoting&&<Notice tone="warn" icon={<Warning size={16}/>}>此人擁有 {owned.agents} 個 Agent、{owned.connectors} 個連接器與 {owned.documents} 份文件，改為非管理角色後仍歸此人所有，但無法再編輯。</Notice>}
      </section>

      <section className="ue-panel">
        <div className="ue-panel-h"><h2>群組</h2><span>已選 {memberOf.length}{orgGroups?` / ${orgGroups.length}`:''}</span></div>
        <p className="ue-sub">可複選。成員名單與群組管理同步。</p>
        {orgGroups&&orgGroups.length>6&&<input className="ue-search" value={gq} onChange={e=>setGq(e.target.value)} placeholder="搜尋群組" aria-label="搜尋群組"/>}
        <div className="ue-list" aria-label="群組">
          {orgGroups===null?<p className="ue-empty">載入中…</p>:!orgGroups.length?<p className="ue-empty">沒有可用的群組（尚未建立，或沒有檢視群組的權限）</p>
            :!shownGroups.length?<p className="ue-empty">沒有符合的群組</p>
            :shownGroups.map(g=>{const on=memberOf.includes(g.id);
              return <label key={g.id} className={'ue-item'+(on?' on':'')}><input type="checkbox" className="ue-check" disabled={readOnly||busy} checked={on}
                onChange={e=>setMemberOf(m=>e.target.checked?[...m,g.id]:m.filter(x=>x!==g.id))}/><span className="ue-item-t"><b>{g.name}</b></span></label>})}
        </div>
      </section>

      <section className="ue-panel">
        <div className="ue-panel-h"><h2>帳號狀態</h2></div>
        <p className="ue-sub">{u.status_changed_at?`上次由 ${u.status_changed_by} 於 ${fmtDateTime(u.status_changed_at)} 變更${u.status_reason?'：'+u.status_reason:''}`:'停用會立即阻擋平台存取，可隨時恢復。'}</p>
        <div className="ue-seg">{STATUSES.map(st=><button key={st.id} type="button" disabled={locked} className={(status===st.id?'on ':'')+(st.id==='suspended'?'bad':'')} onClick={()=>setStatus(st.id)}>{st.label}</button>)}</div>
      </section>

      <section className="ue-panel">
        <div className="ue-panel-h"><h2>原始檔檢視</h2></div>
        <p className="ue-sub">含個資的原始檔僅授權人員可開啟，每次需填寫用途並寫入稽核。</p>
        <div className="ue-seg">{[[false,'不可檢視'],[true,'可檢視（需填用途）']].map(([v,t])=><button key={String(v)} type="button" disabled={self||readOnly} className={origView===v?'on':''} onClick={()=>setOrigView(v)}>{t}</button>)}</div>
      </section>
    </div>

    {accessChanged&&<section className="ue-panel ue-reason"><div className="ue-panel-h"><h2>變更原因 <span className="req">*</span></h2><span>{reason.length} / 200</span></div>
      <textarea maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：轉調護理部；留職停薪，停用存取。"/></section>}

    {!u.uid&&<div className="ue-prereg"><span>此帳號為預先註冊，對方尚未登入過。</span>{!readOnly&&<button className="btn danger" onClick={cancelPrereg}><Trash/>取消預先註冊</button>}</div>}

    <div className="lv-savebar"><div><span>{dirty?<b>{summary}</b>:<>正在編輯 <b>{u.name||u.email}</b></>}</span><small>{saved&&!dirty?'已儲存並寫入稽核記錄。':needReason?'變更角色、狀態或原始檔檢視需要填寫原因。':'變更會寫入稽核記錄。'}</small></div>
      {!readOnly&&<button className="btn" disabled={!dirty||busy} onClick={()=>reset(u)}>取消變更</button>}
      {!readOnly&&<button className={'btn primary'} style={suspending?{background:'#c62828',borderColor:'#c62828'}:undefined} disabled={!dirty||needReason||busy} onClick={save}>{busy?'儲存中…':suspending?'確認停用並儲存':'儲存變更'}</button>}
    </div>
  </div>;
}
