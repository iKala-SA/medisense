import React,{useState} from 'react';
import {X,User,UsersThree,Globe,Lock,ShareNetwork} from '@phosphor-icons/react';

export const emptyShare=()=>({access:'restricted',role:'use',members:[]});
export const accountShare=()=>({access:'account',role:'use',members:[]});
const users=[
  {type:'user',id:'u1',name:'王雅婷',sub:'藥劑部'},{type:'user',id:'u2',name:'林建宏',sub:'心臟科'},{type:'user',id:'u3',name:'陳怡君',sub:'護理部'},
  {type:'user',id:'u4',name:'張志豪',sub:'資訊室'},{type:'user',id:'u5',name:'黃心怡',sub:'護理部'},{type:'user',id:'u6',name:'吳承翰',sub:'心臟科'}
];
const groups=[
  {type:'group',id:'g1',name:'藥劑部',sub:'群組 · 12 人'},{type:'group',id:'g2',name:'心臟科',sub:'群組 · 18 人'},{type:'group',id:'g3',name:'護理部',sub:'群組 · 46 人'},
  {type:'group',id:'g4',name:'資訊室',sub:'群組 · 8 人'},{type:'group',id:'g5',name:'全體醫師',sub:'群組 · 64 人'}
];
const directory=[...groups,...users];
const roles=[['use','可使用'],['edit','可編輯']];

export function shareSummary(s){
  if(!s)return '僅自己';
  if(s.access==='account')return '整個帳號';
  const g=s.members.filter(m=>m.type==='group').length,u=s.members.length-g;
  if(!s.members.length)return '僅自己';
  return [u&&`${u} 位使用者`,g&&`${g} 個群組`].filter(Boolean).join('、');
}
export function ShareButton({share,onClick,label='分享'}){
  const open=share?.access==='account';
  return <button type="button" className="share-btn" aria-label={label} title={label} onClick={onClick}>{open?<Globe size={15}/>:share?.members?.length?<UsersThree size={15}/>:<Lock size={15}/>}<span>{shareSummary(share)}</span></button>;
}
export const ShareAction=({onClick})=><button type="button" className="btn share-action" onClick={onClick}><ShareNetwork/>分享</button>;

export function ShareModal({title,value,owner='Paggie',onClose,onDone}){
  const [s,setS]=useState(()=>structuredClone(value||emptyShare())),[q,setQ]=useState('');
  const taken=new Set(s.members.map(m=>m.id));
  const hits=q.trim()?directory.filter(d=>!taken.has(d.id)&&(d.name+d.sub).includes(q.trim())):[];
  const add=d=>{setS(a=>({...a,members:[...a.members,{type:d.type,id:d.id,name:d.name,sub:d.sub,role:'use'}]}));setQ('')};
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal share-modal" role="dialog" aria-modal="true" aria-label="分享設定">
    <button type="button" className="icon-btn modal-close" aria-label="關閉" onClick={onClose}><X/></button>
    <h2>分享「{title||'未命名'}」</h2>
    <div className="share-search"><input aria-label="新增使用者或群組" autoFocus placeholder="新增使用者或群組" value={q} onChange={e=>setQ(e.target.value)}/>
      {q.trim()&&<div className="share-hits">{hits.length?hits.map(d=><button type="button" key={d.id} onClick={()=>add(d)}><span className="share-ico">{d.type==='group'?<UsersThree size={16}/>:<User size={16}/>}</span><span><b>{d.name}</b><small>{d.sub}</small></span></button>):<p className="muted small">找不到符合的使用者或群組</p>}</div>}</div>
    <h4>具有存取權的對象</h4>
    <div className="share-list">
      <div className="share-row"><span className="share-ico"><User size={16}/></span><span><b>{owner}（你）</b><small>擁有者</small></span><span className="muted small">擁有者</span></div>
      {s.members.map(m=><div className="share-row" key={m.id}><span className="share-ico">{m.type==='group'?<UsersThree size={16}/>:<User size={16}/>}</span><span><b>{m.name}</b><small>{m.sub}</small></span>
        <select aria-label={'權限 '+m.name} value={m.role} onChange={e=>setS(a=>({...a,members:a.members.map(x=>x.id===m.id?{...x,role:e.target.value}:x)}))}>{roles.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <button type="button" className="icon-btn" aria-label={'移除 '+m.name} onClick={()=>setS(a=>({...a,members:a.members.filter(x=>x.id!==m.id)}))}><X/></button></div>)}
      {!s.members.length&&<p className="muted small share-empty">尚未分享給任何人。可搜尋姓名或群組加入。</p>}
    </div>
    <h4>一般存取權</h4>
    <div className="share-row share-general"><span className="share-ico">{s.access==='account'?<Globe size={16}/>:<Lock size={16}/>}</span>
      <span><select aria-label="一般存取權" value={s.access} onChange={e=>setS(a=>({...a,access:e.target.value}))}><option value="restricted">僅限上方對象</option><option value="account">整個帳號的所有人</option></select><small>{s.access==='account'?'帳號內所有成員都能找到並使用':'只有上方列出的對象能存取'}</small></span>
      {s.access==='account'&&<select aria-label="一般存取權限" value={s.role} onChange={e=>setS(a=>({...a,role:e.target.value}))}>{roles.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}</div>
    <p className="muted small share-note">原型示範：使用者與群組為合成資料，分享設定只保存在本次瀏覽器工作階段，未連接真實權限系統。</p>
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={()=>onDone(s)}>完成</button></div>
  </section></div>;
}
