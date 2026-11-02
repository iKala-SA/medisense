import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {ArrowClockwise,ArrowLeft,CaretRight,IdentificationBadge,Info,Plus,Shield,Trash,Wrench,User,X} from '@phosphor-icons/react';
import {api} from '../api';
import {errText} from './constants';
import {Loading,Notice} from './shared';
import {Empty,ListToolbar,Toggle} from '../ListKit';
import './admin.css';
import './roles.css';

const TABS=['全部','系統預設'];
const lc=s=>String(s||'').trim().toLowerCase();
// 圖示由前端依角色 id 對應（後端不回傳圖示）；未知的角色使用通用圖示
const ICON={admin:Shield,builder:Wrench,user:User};
const COLS='2.4fr 1fr .8fr 24px';

// 角色資料由 GET /api/roles 提供。列表僅供檢視；點選列可編輯名稱與說明（系統管理員除外）。
export default function RolesPage({me,notify}){
  const [data,setData]=useState(null);
  const [tab,setTab]=useState('全部');
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(false);
  const [opened,setOpened]=useState(null);
  const [creating,setCreating]=useState(false);
  const admin=me?.role==='admin';

  const load=useCallback(()=>{
    setBusy(true);
    return api.listRoles().then(setData).catch(e=>{notify?.('載入角色失敗：'+errText(e));setData(d=>d||{roles:[],stats:null})}).finally(()=>setBusy(false));
  },[notify]);
  // mount only: `notify` changes identity on every App render (see UsersPage)
  useEffect(()=>{if(admin)load()},[admin]);// eslint-disable-line react-hooks/exhaustive-deps

  const roles=data?.roles;
  const stats=data?.stats;
  const needle=search.trim().toLowerCase();
  const shown=useMemo(()=>(roles||[]).filter(r=>(tab==='全部'||!r.custom)&&(!needle||[r.name,r.en,r.desc].some(s=>(s||'').toLowerCase().includes(needle)))),[roles,tab,needle]);

  if(!admin)return <div className="card-page lv-page"><Empty text="此頁面僅限系統管理員。"/></div>;
  if(opened)return <RoleDetail role={opened} notify={notify} onBack={()=>{setOpened(null)}} onSaved={r=>setData(d=>({...d,roles:d.roles.map(x=>x.id===r.id?{...x,...r}:x)}))} onDeleted={id=>{setOpened(null);setData(d=>({...d,roles:d.roles.filter(x=>x.id!==id)}));load()}}/>;

  return <div className="card-page lv-page rl-page">
    <div className="page-heading"><h1><IdentificationBadge/>角色管理</h1><div className="lv-actions"><button className="btn" onClick={load} disabled={busy}><ArrowClockwise className={busy?'lv-spin':''}/>重新整理</button><button className="btn primary" onClick={()=>setCreating(true)}><Plus/>新增角色</button></div></div>
    <p className="subtitle">檢視平台角色的權限範圍與目前指派人數。角色變更請至「使用者管理」進行。</p>

    <div className="rl-stats">
      <div className="rl-stat"><div className="rl-stat-label">角色總數</div><div className="rl-stat-value">{stats?.total_roles??'—'}<small>個</small></div></div>
      <div className="rl-stat"><div className="rl-stat-label">系統預設角色</div><div className="rl-stat-value">{stats?.system_roles??'—'}<small>個</small></div></div>
      <div className="rl-stat"><div className="rl-stat-label">自訂角色</div><div className="rl-stat-value">{stats?.custom_roles??'—'}<small>個</small></div></div>
    </div>

    <ListToolbar search={search} onSearch={setSearch} placeholder="搜尋角色名稱" tabs={TABS} tab={tab} onTab={setTab}/>

    {data===null?<Loading/>:<div className="lt rl-table">
      <div className="lt-head" style={{'--cols':COLS}}><span>角色</span><span>類型</span><span>狀態</span><span/></div>
      {shown.map(r=>{const Icon=ICON[r.id]||IdentificationBadge;return <div key={r.id} className="lt-row" style={{'--cols':COLS,cursor:'pointer'}} role="button" tabIndex={0} onClick={()=>setOpened(r)} onKeyDown={e=>{if(e.key==='Enter')setOpened(r)}}>
        <span className="rl-role"><span className={'rl-icon'+(r.custom?' custom':'')}><Icon size={16}/></span><span><b>{r.name}</b><small>{r.desc}</small></span></span>
        <span><span className={'rl-tag'+(r.custom?' custom':'')}>{r.custom?'自訂':'系統預設'}</span></span>
        <span>{r.status?<span className="lv-pill ok"><i/>啟用</span>:<span className="lv-pill"><i/>停用</span>}</span>
        <CaretRight className="muted"/>
      </div>})}
      {shown.length===0&&<Empty text="沒有符合條件的角色。"/>}
    </div>}

    <Notice icon={<Info size={16}/>}>角色與功能對應目前為平台內建設定。管理員帳號另可由部署設定 ADMIN_EMAILS 固定指定。</Notice>
    {creating&&<CreateRoleModal notify={notify} onClose={()=>setCreating(false)} onCreated={r=>{setCreating(false);setOpened(r);load()}}/>}
  </div>;
}

function friendlyRole(e){
  const m=errText(e);
  if(m.startsWith('403'))return '權限不足，請聯絡系統管理員';
  if(m.startsWith('422'))return '資料格式不正確，請檢查輸入內容';
  return '操作失敗：'+m;
}

// 新增自訂角色，表單欄位與 GroupsPage 的新增群組對齊；建立後直接開啟角色細節。
function CreateRoleModal({onClose,onCreated,notify}){
  const [name,setName]=useState(''),[desc,setDesc]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e){
    e.preventDefault();
    if(!name.trim())return setErr('請輸入角色名稱');
    if(name.trim().length>40)return setErr('角色名稱不可超過 40 字');
    setBusy(true);setErr('');
    try{const r=await api.createRole({name:name.trim(),desc:desc.trim()});notify?.('已建立角色');onCreated(r)}
    catch(x){setErr(friendlyRole(x))}finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><form className="modal" role="dialog" aria-modal="true" aria-label="新增角色" onSubmit={submit}>
    <button type="button" className="icon-btn modal-close" aria-label="關閉" onClick={onClose}><X/></button>
    <h2>新增角色</h2>
    <div className="field"><label>角色名稱</label><input autoFocus maxLength={40} value={name} onChange={e=>{setName(e.target.value);setErr('')}} placeholder="例如：現場主管"/></div>
    <div className="field"><label>說明</label><textarea rows={2} maxLength={300} value={desc} onChange={e=>setDesc(e.target.value)}/></div>
    {err&&<p className="lv-o-err" role="alert">{err}</p>}
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={busy}>{busy?'建立中…':'建立'}</button></div>
  </form></div>;
}

// 角色的指派清單：使用者寫入 users.roles（僅記錄，不影響存取）；群組寫入 groups.role_ids（僅關聯，不影響存取）。
// 清單可搜尋、移除，並以多選加入；每次變更都直接 PATCH 該筆資料。
const LINK_KIND={
  user:{title:'指派使用者',field:'roles',empty:'尚未指派使用者',add:'指派使用者',search:'搜尋姓名、電子郵件或群組',
    cols:'1.2fr 1.6fr .8fr .6fr 24px',head:['姓名','電子郵件','群組','狀態'],
    text:u=>[u.name||'—',u.email,u.department||'—',u.status==='suspended'?'停用':'啟用'],
    keys:u=>[u.name,u.email,u.department],
    label:u=>u.name||u.email,
    desc:'指派此角色的使用者。僅記錄指派，不影響任何存取權限；使用者的實際存取仍由「使用者管理」中的角色決定。'},
  group:{title:'關聯群組',field:'role_ids',empty:'尚未關聯群組',add:'關聯群組',search:'搜尋群組名稱或說明',
    cols:'1.2fr 2fr .8fr 24px',head:['名稱','說明','成員數'],
    text:g=>[g.name,g.description||'—',String(g.member_count??g.member_emails?.length??0)],
    keys:g=>[g.name,g.description],
    label:g=>g.name,
    desc:'關聯此角色的群組。僅記錄關聯，不影響任何存取權限。'},
};

function RoleLinks({kind,role,notify}){
  const K=LINK_KIND[kind];
  const isUser=kind==='user';
  const [rows,setRows]=useState(null),[q,setQ]=useState(''),[adding,setAdding]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const req=isUser?api.listUsers().then(r=>r.users||[]):api.listGroups().then(r=>Array.isArray(r)?r:(r.groups||[]));
    req.then(setRows).catch(e=>{notify?.(`載入${isUser?'使用者':'群組'}失敗：`+errText(e));setRows([])});
  },[]);// eslint-disable-line react-hooks/exhaustive-deps

  const idOf=x=>isUser?x.email:x.id;
  const has=x=>(x[K.field]||[]).includes(role.id);
  const linked=(rows||[]).filter(has);
  const needle=lc(q);
  const shown=linked.filter(x=>!needle||K.keys(x).some(v=>(v||'').toLowerCase().includes(needle)));

  // 依 role id 更新單筆資料，回傳新的列資料
  async function save(x,on){
    const ids=on?[...(x[K.field]||[]),role.id]:(x[K.field]||[]).filter(v=>v!==role.id);
    return isUser?api.updateUser(x.email,{roles:ids}):api.updateGroupInfo(x.id,{[K.field]:ids});
  }
  async function unlink(x){
    setBusy(true);
    try{const r=await save(x,false);setRows(rs=>rs.map(y=>idOf(y)===idOf(r)?{...y,...r}:y));notify?.(`已移除${isUser?'使用者':'群組'}：${K.label(x)}`)}
    catch(e){notify?.('移除失敗：'+errText(e))}finally{setBusy(false)}
  }
  // 多選加入：逐筆送出，失敗的保留在對話框中並回報數量
  async function linkMany(picked){
    setBusy(true);
    const done=[];const failed=[];
    for(const x of picked){
      try{const r=await save(x,true);done.push(r)}catch(e){failed.push(K.label(x))}
    }
    if(done.length)setRows(rs=>rs.map(y=>{const r=done.find(d=>idOf(d)===idOf(y));return r?{...y,...r}:y}));
    setBusy(false);
    if(failed.length){notify?.(`已加入 ${done.length} 筆，${failed.length} 筆失敗：${failed.join('、')}`);return false}
    notify?.(`已加入 ${done.length} 筆`);return true;
  }

  const candidates=(rows||[]).filter(x=>!has(x));

  return <div className="lv-card">
    <h2>{K.title}（{linked.length}）</h2>
    <p className="lv-sub">{K.desc}</p>
    {rows===null?<span className="muted small">載入中…</span>:<>
      <div className="lv-actions" style={{justifyContent:'space-between',marginBottom:8}}>
        <ListToolbar search={q} onSearch={setQ} placeholder={K.search} tabs={[]} tab="" onTab={()=>{}}/>
        <button type="button" className="btn primary" disabled={busy||!candidates.length} onClick={()=>setAdding(true)}><Plus/>{K.add}</button>
      </div>
      <div className="lt" style={{'--cols':K.cols}}>
        <div className="lt-head">{K.head.map(h=><span key={h}>{h}</span>)}<span/></div>
        {shown.map(x=><div className="lt-row" key={idOf(x)}>
          {K.text(x).map((v,i)=><span key={i} className={i===0?'':'muted'}>{v}</span>)}
          <span><button type="button" className="icon-btn" aria-label={'移除 '+K.label(x)} disabled={busy} onClick={()=>unlink(x)}><X size={14}/></button></span>
        </div>)}
        {!shown.length&&<Empty text={linked.length?'沒有符合條件的資料。':K.empty}/>}
      </div>
    </>}
    {adding&&<AddLinksModal kind={kind} title={K.title} candidates={candidates} label={K.label} text={K.text} keys={K.keys} busy={busy}
      onClose={()=>setAdding(false)} onSubmit={async picked=>{const ok=await linkMany(picked);if(ok)setAdding(false);return ok}}/>}
  </div>;
}

// 多選加入對話框：可搜尋候選清單，勾選後一次加入
function AddLinksModal({title,candidates,label,text,keys,busy,onClose,onSubmit}){
  const [q,setQ]=useState(''),[picked,setPicked]=useState([]);
  const needle=lc(q);
  const shown=candidates.filter(x=>!needle||keys(x).some(v=>(v||'').toLowerCase().includes(needle)));
  const idOf=x=>x.email??x.id;
  const isOn=x=>picked.some(p=>idOf(p)===idOf(x));
  const toggle=x=>setPicked(ps=>isOn(x)?ps.filter(p=>idOf(p)!==idOf(x)):[...ps,x]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}><div className="modal" role="dialog" aria-modal="true" aria-label={'加入'+title} style={{width:'min(640px,94vw)'}}>
    <button type="button" className="icon-btn modal-close" aria-label="關閉" disabled={busy} onClick={onClose}><X/></button>
    <h2>{title}</h2>
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋" tabs={[]} tab="" onTab={()=>{}}/>
    <div className="lt" style={{'--cols':'24px 1.4fr 1.8fr 1fr',maxHeight:360,overflow:'auto',marginTop:8}}>
      {shown.map(x=><label className="lt-row" key={idOf(x)} style={{cursor:'pointer'}}>
        <input type="checkbox" checked={isOn(x)} onChange={()=>toggle(x)} aria-label={'選取 '+label(x)}/>
        {text(x).slice(0,3).map((v,i)=><span key={i} className={i===0?'':'muted'}>{v}</span>)}
      </label>)}
      {!shown.length&&<Empty text="沒有符合條件的資料。"/>}
    </div>
    <div className="modal-actions"><span className="muted small" style={{marginRight:'auto'}}>已選 {picked.length} 筆</span><button type="button" className="btn" disabled={busy} onClick={onClose}>取消</button><button type="button" className="btn primary" disabled={busy||!picked.length} onClick={()=>onSubmit(picked)}>{busy?'加入中…':`加入（${picked.length}）`}</button></div>
  </div></div>;
}

// 角色細節：名稱、英文名稱（非必填）、說明、狀態與權限標籤可編輯。系統管理員為固定角色，整頁唯讀。
const LABEL_LIMIT=20;
function RoleDetail({role:initial,notify,onBack,onSaved,onDeleted}){
  const [role,setRole]=useState(initial);
  const [delOpen,setDelOpen]=useState(false),[delBusy,setDelBusy]=useState(false);
  const [name,setName]=useState(initial.name||''),[en,setEn]=useState(initial.en||''),[desc,setDesc]=useState(initial.desc||'');
  const [status,setStatus]=useState(!!initial.status),[can,setCan]=useState(initial.can||[]),[canDraft,setCanDraft]=useState('');
  const [busy,setBusy]=useState(false),[err,setErr]=useState('');
  const fixed=role.id==='admin';
  const dirty=name.trim()!==(role.name||'')||en.trim()!==(role.en||'')||desc.trim()!==(role.desc||'')||status!==!!role.status||can.join('\n')!==(role.can||[]).join('\n');
  const back=()=>{if(dirty&&!window.confirm('放棄未儲存的變更？'))return;onBack()};
  // 內建角色（含 admin）後端一律回 403，這裡同步停用按鈕並說明原因
  const deletable=!fixed&&!!role.custom;

  async function remove(){
    setDelBusy(true);
    try{await api.deleteRole(role.id);notify?.('已刪除角色');onDeleted(role.id)}
    catch(x){notify?.('刪除失敗：'+errText(x))}finally{setDelBusy(false)}  // keep the dialog open on failure, as in GroupDetail
  }

  function addLabel(){
    const v=canDraft.trim();
    if(!v)return;
    if(v.length>LABEL_LIMIT)return setErr(`權限標籤不可超過 ${LABEL_LIMIT} 字`);
    if(can.length>=20)return setErr('權限標籤最多 20 個');
    if(!can.includes(v))setCan([...can,v]);
    setCanDraft('');setErr('');
  }

  async function save(e){
    e.preventDefault();
    if(!name.trim())return setErr('請輸入角色名稱');
    setBusy(true);setErr('');
    try{
      const r=await api.updateRole(role.id,{name:name.trim(),en:en.trim(),desc:desc.trim(),status,can});
      setRole({...role,...r});setName(r.name);setEn(r.en||'');setDesc(r.desc);setStatus(!!r.status);setCan(r.can||[]);onSaved(r);notify?.('已更新角色');
    }catch(x){setErr('儲存失敗：'+errText(x))}finally{setBusy(false)}
  }

  return <div className="card-page lv-page rl-page">
    <button className="lv-back" onClick={back}><ArrowLeft/>返回角色列表</button>
    <div className="page-heading"><h1>{role.name}</h1><div className="lv-actions"><button className="btn" style={{color:'#b91c1c'}} disabled={!deletable||busy} title={fixed?'管理員不可刪除':!role.custom?'內建角色無法刪除':undefined} onClick={()=>setDelOpen(true)}><Trash/>刪除角色</button></div></div>
    <p className="subtitle">{fixed?'系統管理員為固定角色，不可編輯。':'編輯角色的名稱、說明、狀態與權限標籤。'}</p>

    <form className="lv-card" onSubmit={save} style={{maxWidth:560,display:'grid',gap:12}}>
      <h2>基本資料</h2>
      <div className="field"><label>角色名稱</label><input maxLength={40} value={name} disabled={fixed||busy} onChange={e=>{setName(e.target.value);setErr('')}}/></div>
      <div className="field"><label>英文名稱（非必填）</label><input maxLength={40} value={en} disabled={fixed||busy} onChange={e=>setEn(e.target.value)}/></div>
      <div className="field"><label>說明</label><textarea rows={3} maxLength={300} value={desc} disabled={fixed||busy} onChange={e=>setDesc(e.target.value)}/></div>
      <div className="field"><label>狀態</label>
        <div className="lv-actions"><Toggle on={status} onChange={setStatus} label="角色狀態" disabled={fixed||busy}/><span className="small muted">{status?'啟用':'停用'}</span></div>
      </div>

      <div className="field"><label>權限標籤</label>
        <p className="lv-sub" style={{margin:'0 0 4px'}}>目前僅供顯示，尚未套用到功能存取；權限矩陣尚未開放。</p>
        <div className="lv-actions" style={{flexWrap:'wrap'}}>
          {can.length?can.map(c=><span key={c} className="lv-chip">{c}{!fixed&&<button type="button" aria-label={'移除 '+c} className="icon-btn" style={{padding:0}} disabled={busy} onClick={()=>setCan(can.filter(x=>x!==c))}><X size={10}/></button>}</span>):<span className="muted small">尚未設定</span>}
        </div>
        {!fixed&&<div className="lv-actions" style={{marginTop:6}}>
          <input aria-label="新增權限標籤" maxLength={LABEL_LIMIT} value={canDraft} disabled={busy} placeholder="輸入後按 Enter 新增" onChange={e=>setCanDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addLabel()}}}/>
          <button type="button" className="btn" disabled={busy||!canDraft.trim()} onClick={addLabel}>新增</button>
        </div>}
      </div>

      {err&&<p className="lv-o-err" role="alert">{err}</p>}
      <div className="lv-actions"><button className="btn primary" disabled={fixed||busy||!dirty}>{busy?'儲存中…':'儲存'}</button></div>
    </form>

    <RoleLinks kind="user" role={role} notify={notify}/>
    <RoleLinks kind="group" role={role} notify={notify}/>

    {fixed&&<Notice icon={<Info size={16}/>}>管理員為系統預設角色，權限固定為全部允許，不可在此修改。</Notice>}
    {delOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!delBusy)setDelOpen(false)}}><div className="modal" role="dialog" aria-modal="true" aria-label="確認刪除">
      <h2>刪除角色</h2><p>確定要刪除「{role.name}」？刪除後，群組中的此角色關聯也會一併移除。</p>
      <div className="modal-actions"><button type="button" className="btn" disabled={delBusy} onClick={()=>setDelOpen(false)}>取消</button><button type="button" className="btn primary" disabled={delBusy} onClick={remove}>{delBusy?'刪除中…':'刪除'}</button></div>
    </div></div>}
  </div>;
}
