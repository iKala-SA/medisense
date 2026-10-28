import React,{useEffect,useMemo,useState,useCallback} from 'react';
import {UserPlus,DownloadSimple,ArrowClockwise,ArrowLeft,ClockCounterClockwise,Lock,Warning,Info,Trash,CaretRight} from '@phosphor-icons/react';
import {api,saveBlob} from '../api';
import {ListToolbar,AddModal,Field,Empty} from '../ListKit';
import {DEPARTMENTS,ROLES,ROLE_LABEL,STATUSES,fmtDateTime,errText} from './constants';
import {Loading,Notice} from './shared';
import './admin.css';

const TABS=['全部','管理員','建置者','一般使用者','已停用','待註冊'];
const inTab=(u,t)=>t==='全部'||(t==='管理員'&&u.role==='admin')||(t==='建置者'&&u.role==='builder')||(t==='一般使用者'&&u.role==='user')||(t==='已停用'&&u.status==='suspended')||(t==='待註冊'&&!u.uid);
const PAGE=30;

const RoleBadge=({role})=><span className={'lv-pill '+(role==='admin'?'brand':role==='builder'?'soft':'')}>{ROLE_LABEL[role]||role}</span>;
const StatusBadge=({u})=>u.status==='suspended'?<span className="lv-pill err"><i/>已停用</span>:!u.uid?<span className="lv-pill warn"><i/>待註冊</span>:<span className="lv-pill ok"><i/>啟用中</span>;
const Avatar=({u})=><span className={'lv-avatar '+(u.status==='suspended'?'off':'')}>{(u.name||u.email||'?').slice(0,1).toUpperCase()}</span>;

export default function UsersPage({me,notify,goAudit}){
  const [dir,setDir]=useState(null);
  const [tab,setTab]=useState('全部');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const [adding,setAdding]=useState(false);
  const [editing,setEditing]=useState(null);
  const [exporting,setExporting]=useState(false);
  const [busy,setBusy]=useState(false);

  const load=useCallback(()=>{
    setBusy(true);
    return api.listUsers().then(setDir).catch(e=>{notify?.('載入使用者失敗：'+errText(e));setDir(d=>d||{users:[]})}).finally(()=>setBusy(false));
  },[notify]);
  useEffect(()=>{load()},[load]);
  useEffect(()=>setPage(1),[tab,search]);

  const users=dir?.users||[];
  const needle=search.trim().toLowerCase();
  const shown=useMemoList(users,tab,needle);
  const pages=Math.max(1,Math.ceil(shown.length/PAGE));
  if(me&&me.role!=='admin')return <div className="card-page lv-page"><Empty text="此頁面僅限系統管理員。"/></div>;

  const rows=shown.slice((page-1)*PAGE,page*PAGE);

  async function exportCsv(){
    setExporting(true);
    try{saveBlob(await api.usersCsv(),'tcvgh-accounts.csv');notify?.('已匯出帳號清冊')}
    catch(e){notify?.('匯出失敗：'+errText(e))}finally{setExporting(false)}
  }
  async function preregister(fd){
    const email=String(fd.get('email')||'').trim().toLowerCase();
    if(!email||!email.includes('@')){notify?.('請輸入有效的電子郵件');return}
    try{await api.preregisterUser(email,fd.get('role'),fd.get('department')||'');setAdding(false);notify?.(`已預先登錄 ${email}`);load()}
    catch(e){notify?.('預先登錄失敗：'+errText(e))}
  }

  if(editing)return <UserEdit email={editing} me={me} notify={notify} goAudit={goAudit} onBack={()=>{setEditing(null);load()}}/>;

  return <div className="card-page lv-page">
    <div className="page-heading"><h1>使用者管理</h1><div className="lv-actions">
      <button className="btn" onClick={load} disabled={busy}><ArrowClockwise className={busy?'lv-spin':''}/>重新整理</button>
      <button className="btn" onClick={exportCsv} disabled={exporting||!dir}><DownloadSimple/>匯出 CSV</button>
      <button className="btn primary" onClick={()=>setAdding(true)}><UserPlus/>預先註冊</button>
    </div></div>
    <p className="subtitle">管理同仁的平台角色、所屬科別與帳號狀態。角色與狀態變更需填寫原因，並寫入稽核記錄。</p>
    <ListToolbar search={search} onSearch={setSearch} placeholder="搜尋姓名、電子郵件或科別" tabs={TABS} tab={tab} onTab={setTab}/>
    {dir===null?<Loading/>:<div className="lt">
      <div className="lt-head" style={{'--cols':'1.6fr 1.4fr 1fr 1fr .9fr 1fr 24px'}}><span>姓名</span><span>電子郵件</span><span>科別</span><span>角色</span><span>狀態</span><span>最近登入</span><span/></div>
      {rows.map(u=><div key={u.email} className="lt-row" style={{'--cols':'1.6fr 1.4fr 1fr 1fr .9fr 1fr 24px',cursor:'pointer'}} onClick={()=>setEditing(u.email)}>
        <span className="lv-name"><Avatar u={u}/><span><b>{u.name||'（尚未登入）'}</b>{u.bootstrap_admin&&<small>固定管理員</small>}</span></span>
        <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{u.email}</span>
        <span>{u.department||'—'}</span>
        <span><RoleBadge role={u.role}/></span>
        <span><StatusBadge u={u}/></span>
        <span className="muted small">{u.last_seen_at?fmtDateTime(u.last_seen_at):'—'}</span>
        <CaretRight className="muted"/>
      </div>)}
      {rows.length===0&&<Empty text={users.length===0?'目前沒有使用者資料。':'沒有符合條件的使用者。'}/>}
    </div>}
    {shown.length>PAGE&&<div className="lv-pager"><span>共 {shown.length} 人，第 {page} / {pages} 頁</span><span className="lv-actions"><button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一頁</button><button className="btn" disabled={page===pages} onClick={()=>setPage(p=>p+1)}>下一頁</button></span></div>}
    {adding&&<AddModal title="預先註冊使用者" hint="同仁首次以院內 Google 帳號登入時，會套用此角色與科別。" submitLabel="預先註冊" onClose={()=>setAdding(false)} onSubmit={preregister}>
      <Field label="電子郵件"><input name="email" type="email" required placeholder="name@example.org" autoFocus/></Field>
      <Field label="角色"><select name="role" defaultValue="user">{ROLES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
      <Field label="科別"><select name="department" defaultValue=""><option value="">未設定</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select></Field>
    </AddModal>}
  </div>;
}

// plain helper (not a hook name) to keep hook order stable across the admin guard above
function useMemoList(users,tab,needle){
  return useMemo(()=>users.filter(u=>inTab(u,tab)&&(!needle||[u.name,u.email,u.department].some(s=>(s||'').toLowerCase().includes(needle)))),[users,tab,needle]);
}

function UserEdit({email,me,notify,goAudit,onBack}){
  const [u,setU]=useState(null);
  const [role,setRole]=useState('user');
  const [status,setStatus]=useState('active');
  const [department,setDepartment]=useState('');
  const [origView,setOrigView]=useState(false);
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState(false);

  const reset=x=>{setU(x);setRole(x.role);setStatus(x.status);setDepartment(x.department||'');setOrigView(!!x.original_view);setReason('')};
  useEffect(()=>{api.getUser(email).then(reset).catch(e=>{notify?.('載入使用者失敗：'+errText(e));onBack()})},[email]);// eslint-disable-line react-hooks/exhaustive-deps

  if(!u)return <div className="card-page lv-page"><Loading/></div>;

  const self=!!u.uid&&u.uid===me?.uid||(!!me?.email&&me.email.toLowerCase()===u.email.toLowerCase());
  const locked=self||u.bootstrap_admin;
  const viewChanged=origView!==!!u.original_view;
  const accessChanged=role!==u.role||status!==u.status||viewChanged;
  const dirty=accessChanged||department!==(u.department||'');
  const needReason=accessChanged&&!reason.trim();
  const owned=u.owned||{agents:0,published_agents:0,connectors:0,documents:0};
  const ownsSomething=owned.agents+owned.connectors+owned.documents>0;
  const demoting=u.role!=='user'&&role==='user'&&ownsSomething;
  const suspending=status==='suspended'&&u.status!=='suspended';

  async function save(){
    setBusy(true);setSaved(false);
    try{
      const patch={...(role!==u.role?{role}:{}),...(status!==u.status?{status}:{}),...(viewChanged?{original_view:origView}:{}),...(department!==(u.department||'')?{department}:{}),reason:reason.trim()};
      reset(await api.updateUser(u.email,patch));setSaved(true);notify?.('已儲存並寫入稽核記錄');
    }catch(e){notify?.('儲存失敗：'+errText(e))}finally{setBusy(false)}
  }
  async function cancelPrereg(){
    if(!window.confirm(`取消 ${u.email} 的預先註冊？對方之後登入時會以「一般使用者」建立帳號。`))return;
    try{await api.cancelPreregistration(u.email);notify?.('已取消預先註冊');onBack()}
    catch(e){notify?.('取消失敗：'+errText(e))}
  }

  const summary=[role!==u.role&&`角色 ${ROLE_LABEL[u.role]} → ${ROLE_LABEL[role]}`,status!==u.status&&(suspending?'停用帳號':'恢復帳號'),viewChanged&&(origView?'授予原始檔檢視':'撤銷原始檔檢視'),department!==(u.department||'')&&`科別 → ${department||'未設定'}`].filter(Boolean).join('、');

  return <div className="card-page lv-page">
    <button className="lv-back" onClick={onBack}><ArrowLeft/>返回使用者列表</button>
    <div className="page-heading"><h1>編輯使用者</h1>{goAudit&&<button className="btn" onClick={()=>goAudit(u.email)}><ClockCounterClockwise/>檢視個人稽核記錄</button>}</div>
    <p className="subtitle">調整同仁的角色、所屬科別，或停用其存取。</p>

    <div className="lv-card"><div className="lv-profile">
      <Avatar u={u}/>
      <div style={{flex:1,minWidth:240}}>
        <h2>{u.name||'（尚未登入）'}<RoleBadge role={u.role}/><StatusBadge u={u}/>{u.bootstrap_admin&&<span className="lv-chip">固定管理員（部署設定）</span>}{self&&<span className="lv-chip">這是您自己的帳號</span>}</h2>
        <p className="muted small" style={{margin:'4px 0 12px'}}>{u.email}</p>
        <div className="lv-actions"><span className="small muted">所屬科別</span>
          <select className="lv-select" value={department} onChange={e=>setDepartment(e.target.value)}><option value="">未設定</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select></div>
        <div className="lv-actions" style={{marginTop:12}}><span className="lv-chip">{owned.agents} 個 Agent（{owned.published_agents} 個已發布）</span><span className="lv-chip">{owned.connectors} 個連接器</span><span className="lv-chip">{owned.documents} 份知識文件</span></div>
      </div>
      <dl className="lv-dl"><dt>帳號建立</dt><dd>{fmtDateTime(u.created_at)}{u.created_by&&`（${u.created_by==='migrate_users'?'既有建置者移轉':u.created_by+' 預先註冊'}）`}</dd><dt>首次登入</dt><dd>{u.first_login_at?fmtDateTime(u.first_login_at):'尚未登入'}</dd><dt>最後活動</dt><dd>{fmtDateTime(u.last_seen_at)}</dd></dl>
    </div></div>

    {locked&&<Notice icon={<Lock size={16}/>}>{self?'不能變更自己的角色與狀態，請由另一位管理員操作。':'此帳號列在部署設定 ADMIN_EMAILS，永遠是管理員且不能停用，避免平台被鎖住。需變更請由資訊室重新部署。'}所屬科別仍可修改。</Notice>}

    <div className="lv-card"><h2>帳號狀態</h2><p className="lv-sub">{u.status_changed_at?`上次由 ${u.status_changed_by} 於 ${fmtDateTime(u.status_changed_at)} 設為${u.status==='suspended'?'停用':'啟用'}${u.status_reason?'：'+u.status_reason:''}`:'停用會立即阻擋平台存取；恢復後依原角色繼續使用。'}</p>
      {STATUSES.map(s=><button key={s.id} type="button" disabled={locked} className={'lv-opt '+(status===s.id?'on ':'')+(s.id==='suspended'?'bad':'')} onClick={()=>setStatus(s.id)}><span className="dot"/><span><b>{s.label}</b><p>{s.desc}</p></span></button>)}
    </div>

    <div className="lv-card"><h2>角色</h2><p className="lv-sub">每位同仁只有一個角色，決定能使用哪些功能。{u.role_changed_at&&` 上次由 ${u.role_changed_by==='migrate_users'?'系統移轉':u.role_changed_by} 於 ${fmtDateTime(u.role_changed_at)} 變更。`}</p>
      {ROLES.map(r=><button key={r.id} type="button" disabled={locked} className={'lv-opt '+(role===r.id?'on':'')} onClick={()=>setRole(r.id)}><span className="dot"/><span><b>{r.label}（{r.en}）{r.id===u.role&&<span className="lv-pill soft" style={{marginLeft:8}}>目前角色</span>}</b><p>{r.desc}</p><span className="lv-chips">{r.can.map(c=><span key={c} className="lv-chip">{c}</span>)}</span></span></button>)}
      {demoting&&<div style={{marginTop:12}}><Notice tone="warn" icon={<Warning size={16}/>}>此人擁有 {owned.agents} 個 Agent、{owned.connectors} 個連接器與 {owned.documents} 份知識文件。改為一般使用者後這些項目仍歸此人所有，但此人無法再編輯；已發布的 Agent 照常上線，管理員仍可編輯。</Notice></div>}
    </div>

    <div className="lv-card"><h2>原始檔檢視</h2><p className="lv-sub">知識庫文件預設只顯示去識別化內容。含個資的原始檔，只有被授權的人可以開啟，且每次必須填寫用途；每次開啟都會寫入稽核記錄。{u.original_view_changed_at&&` 上次由 ${u.original_view_changed_by} 於 ${fmtDateTime(u.original_view_changed_at)} 變更。`}</p>
      {self&&<div style={{marginBottom:10}}><Notice icon={<Lock size={16}/>}>不能變更自己的原始檔檢視權限，請由另一位管理員操作。</Notice></div>}
      {[[false,'不可檢視含個資的原始檔','只能看去識別化版本；未偵測到個資的文件仍可開啟原始檔。'],[true,'可檢視含個資的原始檔（需填用途）','適用於需要核對原文、表格或頁面的臨床同仁。']].map(([v,t,d])=><button key={String(v)} type="button" disabled={self} className={'lv-opt '+(origView===v?'on':'')} onClick={()=>setOrigView(v)}><span className="dot"/><span><b>{t}</b><p>{d}</p></span></button>)}
    </div>

    {accessChanged&&<div className="lv-card"><h2>變更原因 <span style={{color:'#b3261e'}}>*</span></h2><p className="lv-sub">原因會連同變更前後的角色、狀態或原始檔檢視權限寫入稽核記錄。</p>
      <textarea maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：轉調護理部，改為一般使用者；留職停薪，停用存取。"/><div className="lv-hint">{reason.length} / 200</div></div>}

    {!u.uid&&<div className="lv-card"><div className="lv-actions" style={{justifyContent:'space-between'}}><span className="small muted">此帳號為預先註冊，對方尚未登入過。如果登錄錯誤，可以直接取消。</span><button className="btn danger" onClick={cancelPrereg}><Trash/>取消預先註冊</button></div></div>}

    <div className="lv-savebar"><div><span>正在編輯 <b>{u.name||u.email}</b>{dirty&&<span className="muted small">　{summary}</span>}</span><small>{saved&&!dirty?'已儲存並寫入稽核記錄。':needReason?'變更角色、狀態或原始檔檢視權限需要填寫原因。':'角色與狀態的變更會寫入稽核記錄。'}</small></div>
      <button className="btn" disabled={!dirty||busy} onClick={()=>reset(u)}>取消變更</button>
      <button className={'btn primary'} style={suspending?{background:'#b3261e',borderColor:'#b3261e'}:undefined} disabled={!dirty||needReason||busy} onClick={save}>{busy?'儲存中…':suspending?'確認停用並儲存':'儲存變更'}</button>
    </div>
  </div>;
}
