import React,{useMemo,useState} from 'react';
import {ArrowLeft,CalendarBlank,ChatCircle,Cube,Flask,Gear,House,IdentificationBadge,Info,Lightning,MagnifyingGlass,Plugs,SquaresFour,User} from '@phosphor-icons/react';
import {Notice} from './shared';
import './admin.css';
import './roles.css';

// 資源清單與權限欄位沿用設計稿 re-rbac/role-permission-mgmt.html
const RESOURCES=[
  {name:'對話',desc:'AI 對話與聊天紀錄',icon:ChatCircle},
  {name:'我的工作台',desc:'個人動態、行事曆與待辦',icon:House},
  {name:'連接器',desc:'外部服務與資料來源串接',icon:Plugs},
  {name:'空間',desc:'團隊協作空間與成員內容',icon:SquaresFour},
  {name:'Agent',desc:'Agent 建立、版本與發佈',icon:Cube},
  {name:'技能',desc:'Agent 可調用的技能模組',icon:Lightning},
  {name:'排程',desc:'定時執行的 Agent 任務',icon:CalendarBlank},
  {name:'沙盒測試',desc:'Agent 草稿的測試環境',icon:Flask},
  {name:'使用者管理',desc:'帳號建立、停用與部門指派',icon:User},
  {name:'角色管理',desc:'角色定義與權限設定',icon:IdentificationBadge},
  {name:'設定',desc:'系統與個人偏好設定',icon:Gear},
];
const ACTIONS=[{label:'建立',en:'create'},{label:'讀取',en:'read'},{label:'更新',en:'update'},{label:'刪除',en:'delete'}];

// 權限矩陣尚未儲存於平台：管理員為系統預設的全部允許且不可修改；其他角色可在頁面上勾選，但變更僅保留於本次頁面，無法儲存。
export default function RolePermissionsPage({role,onBack}){
  const [search,setSearch]=useState('');
  const [perms,setPerms]=useState({});
  const needle=search.trim().toLowerCase();
  const shown=useMemo(()=>RESOURCES.filter(r=>!needle||(r.name+' '+r.desc).toLowerCase().includes(needle)),[needle]);
  const granted=role.id==='admin';
  const readOnly=granted||!!role.suspended;

  const isOn=(res,act)=>granted||!!perms[res+'|'+act];
  const toggle=(res,act)=>{if(!readOnly)setPerms(p=>({...p,[res+'|'+act]:!p[res+'|'+act]}))};
  // 欄位全選只作用於目前篩選後可見的資源，與設計稿一致
  const colState=act=>{const n=shown.filter(r=>isOn(r.name,act)).length;return{all:shown.length>0&&n===shown.length,some:n>0&&n<shown.length}};
  const toggleCol=(act,on)=>setPerms(p=>({...p,...Object.fromEntries(shown.map(r=>[r.name+'|'+act,on]))}));

  return <div className="card-page lv-page rl-page">
    <div className="rl-crumb"><button className="rl-crumb-link" onClick={onBack}><ArrowLeft size={14}/>角色管理</button><span>/</span><span>權限設定</span></div>
    <div className="page-heading"><h1>權限設定</h1><div className="lv-actions">
      <button className="btn" disabled>取消</button>
      <button className="btn primary" disabled title="權限矩陣尚未開放儲存">儲存變更</button>
    </div></div>
    <p className="subtitle">設定角色對各項資源可執行的操作：建立、讀取、更新與刪除。</p>

    <div className="rl-role-bar">正在設定角色：<b>{role.label}</b><span className={'rl-tag'+(role.custom?' custom':'')}>{role.custom?'自訂':'系統預設'}</span></div>

    <div className="lt-toolbar"><label className="search"><MagnifyingGlass size={16}/><input aria-label="搜尋" placeholder="搜尋資源名稱或說明" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>

    <section className="rl-card">
      <table className="rl-perm">
        <thead><tr>
          <th>資源</th>
          {ACTIONS.map(a=>{const c=colState(a.en);return <th key={a.en}><label className="rl-col-head"><input type="checkbox" disabled={readOnly} checked={granted||c.all} ref={el=>{if(el)el.indeterminate=!granted&&c.some}} onChange={e=>toggleCol(a.en,e.target.checked)}/>{a.label}<span>{a.en}</span></label></th>})}
        </tr></thead>
        <tbody>
          {shown.map(r=><tr key={r.name}>
            <td><div className="rl-res"><span className="rl-res-icon"><r.icon size={16}/></span><div><b>{r.name}</b><small>{r.desc}</small></div></div></td>
            {ACTIONS.map(a=><td key={a.en}><input type="checkbox" aria-label={`${r.name} ${a.label}`} disabled={readOnly} checked={isOn(r.name,a.en)} onChange={()=>toggle(r.name,a.en)}/></td>)}
          </tr>)}
          {shown.length===0&&<tr><td colSpan={5} className="rl-empty">找不到符合的資源</td></tr>}
        </tbody>
      </table>
      <div className="rl-card-foot"><span>勾選代表該角色允許執行此操作，未勾選則禁止。</span><span>{shown.length===RESOURCES.length?`共 ${RESOURCES.length} 項資源`:`顯示 ${shown.length} / ${RESOURCES.length} 項資源`}</span></div>
    </section>

    <Notice icon={<Info size={16}/>}>{granted?'管理員為系統預設角色，權限固定為全部允許，不可在此修改。':role.suspended?'此角色已停用，權限無法修改。':'勾選變更僅保留於本頁，尚未儲存至平台；離開頁面後將還原。'}</Notice>
  </div>;
}
