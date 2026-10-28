import React,{useEffect,useMemo,useState} from 'react';
import {BookOpen,CheckSquare,DotsThree,IdentificationBadge,Info,Key,PencilSimple,Plus,Prohibit,Shield,Trash,Wrench,User} from '@phosphor-icons/react';
import {api} from '../api';
import {ROLES,errText} from './constants';
import {Loading,Notice} from './shared';
import {Empty,ListToolbar} from '../ListKit';
import RolePermissionsPage from './RolePermissionsPage';
import './admin.css';
import './roles.css';

const TABS=['全部','系統預設','自訂'];
const ICON={admin:Shield,builder:Wrench,user:User};
const COLS='2.4fr 1fr .8fr .8fr .8fr .6fr';

// 設計稿中的自訂角色（尚無後端支援，僅供顯示，且皆為停用狀態，不可指派）
const CUSTOM_ROLES=[
  {id:'ai-reviewer',label:'AI 審核員',desc:'審核 Agent 上架與版本發佈',icon:CheckSquare,custom:true,suspended:true,can:[]},
  {id:'trainer',label:'教育訓練講師',desc:'建立教育訓練課程與管理參加名單',icon:BookOpen,custom:true,suspended:true,can:[]},
];
const ALL_ROLES=[...ROLES.map(r=>({...r,custom:false})),...CUSTOM_ROLES];

// 角色定義寫死在程式碼中（backend 只有 admin / builder / user 三種），此頁僅供檢視，不提供編輯。
export default function RolesPage({me,notify}){
  const [users,setUsers]=useState(null);
  const [tab,setTab]=useState('全部');
  const [search,setSearch]=useState('');
  const [menuFor,setMenuFor]=useState(null);
  const [permRole,setPermRole]=useState(null);
  const admin=me?.role==='admin';

  useEffect(()=>{
    if(!admin)return;
    api.listUsers().then(d=>setUsers(d.users||[])).catch(e=>{notify?.('載入使用者失敗：'+errText(e));setUsers([])});
  },[admin]);// eslint-disable-line react-hooks/exhaustive-deps

  // 點擊其他地方或按 Esc 關閉操作選單
  useEffect(()=>{
    if(menuFor===null)return;
    const close=()=>setMenuFor(null);
    const esc=e=>{if(e.key==='Escape')setMenuFor(null)};
    document.addEventListener('click',close);
    document.addEventListener('keydown',esc);
    return()=>{document.removeEventListener('click',close);document.removeEventListener('keydown',esc)};
  },[menuFor]);

  const countOf=role=>users?users.filter(u=>u.role===role).length:null;
  const needle=search.trim().toLowerCase();
  const shown=useMemo(()=>ALL_ROLES.filter(r=>(tab==='全部'||(tab==='自訂')===r.custom)&&(!needle||[r.label,r.en,r.desc].some(s=>(s||'').toLowerCase().includes(needle)))),[tab,needle]);

  if(!admin)return <div className="card-page lv-page"><Empty text="此頁面僅限系統管理員。"/></div>;
  if(permRole)return <RolePermissionsPage role={permRole} onBack={()=>setPermRole(null)}/>;

  const assigned=users?users.filter(u=>ROLES.some(r=>r.id===u.role)).length:null;

  return <div className="card-page lv-page rl-page">
    <div className="page-heading"><h1><IdentificationBadge/>角色管理</h1><div className="lv-actions"><button className="btn primary" disabled title="尚未開放線上新增"><Plus/>新增角色</button></div></div>
    <p className="subtitle">檢視平台角色的權限範圍與目前指派人數。角色變更請至「使用者管理」進行。</p>

    <div className="rl-stats">
      <div className="rl-stat"><div className="rl-stat-label">角色總數</div><div className="rl-stat-value">{ALL_ROLES.length}<small>個</small></div></div>
      <div className="rl-stat"><div className="rl-stat-label">系統預設角色</div><div className="rl-stat-value">{ROLES.length}<small>個</small></div></div>
      <div className="rl-stat"><div className="rl-stat-label">自訂角色</div><div className="rl-stat-value">{CUSTOM_ROLES.length}<small>個</small></div></div>
      <div className="rl-stat"><div className="rl-stat-label">已指派使用者</div><div className="rl-stat-value">{assigned??'—'}<small>人</small></div></div>
    </div>

    <ListToolbar search={search} onSearch={setSearch} placeholder="搜尋角色名稱" tabs={TABS} tab={tab} onTab={setTab}/>

    {users===null?<Loading/>:<div className="lt rl-table">
      <div className="lt-head" style={{'--cols':COLS}}><span>角色</span><span>類型</span><span>狀態</span><span>成員數</span><span>權限數</span><span style={{textAlign:'right'}}>操作</span></div>
      {shown.map(r=>{const Icon=ICON[r.id]||r.icon;return <div key={r.id} className="lt-row" style={{'--cols':COLS}}>
        <span className="rl-role"><span className={'rl-icon'+(r.custom?' custom':'')}><Icon size={16}/></span><span><b>{r.label}</b><small>{r.desc}</small></span></span>
        <span><span className={'rl-tag'+(r.custom?' custom':'')}>{r.custom?'自訂':'系統預設'}</span></span>
        <span>{r.suspended?<span className="lv-pill"><i/>停用</span>:<span className="lv-pill ok"><i/>啟用</span>}</span>
        <span className="muted">{countOf(r.id)} 人</span>
        <span className="muted">{r.can.length}</span>
        <span className="rl-actions"><span className="rl-menu">
          <button className="rl-icon-btn" aria-label={'更多 '+r.label} aria-haspopup="menu" aria-expanded={menuFor===r.id} onClick={e=>{e.stopPropagation();setMenuFor(menuFor===r.id?null:r.id)}}><DotsThree size={16} weight="bold"/></button>
          {menuFor===r.id&&<div className="rl-dropdown" role="menu">
            <button className="rl-dropdown-item" role="menuitem" disabled={r.id==='admin'} title={r.id==='admin'?'管理員不可編輯':undefined} onClick={()=>{setMenuFor(null);notify?.('編輯角色尚未接入後端，未實際變更')}}><PencilSimple size={15}/>編輯</button>
            <button className="rl-dropdown-item" role="menuitem" onClick={()=>{setMenuFor(null);setPermRole(r)}}><Key size={15}/>權限設定</button>
            <button className="rl-dropdown-item" role="menuitem" disabled={r.id==='admin'||r.suspended} title={r.id==='admin'?'管理員不可停用':r.suspended?'角色已停用':undefined} onClick={()=>{setMenuFor(null);notify?.('停用角色尚未接入後端，未實際變更')}}><Prohibit size={15}/>停用</button>
            <div className="rl-dropdown-sep"/>
            <button className="rl-dropdown-item danger" role="menuitem" disabled title={r.custom?'尚未開放刪除':'內建角色無法刪除'}><Trash size={15}/>刪除</button>
          </div>}
        </span></span>
      </div>})}
      {shown.length===0&&<Empty text="沒有符合條件的角色。"/>}
    </div>}

    <Notice icon={<Info size={16}/>}>角色與功能對應目前為平台內建設定，尚未提供線上編輯。管理員帳號另可由部署設定 ADMIN_EMAILS 固定指定。</Notice>
  </div>;
}
