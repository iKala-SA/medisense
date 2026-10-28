import React from 'react';
import {ArrowRight} from '@phosphor-icons/react';
import './admin-home.css';

/* Admin home: one page, no tabs. Every admin area as a card, grouped like the sidebar. */
const DESC={
  'Model':'可用模型、供應商與核准的雲端供應商。',
  'Model Routing':'模型群組、規則優先順序與敏感資料處置政策。',
  'Security Control':'網路搜尋、語音輸入等功能總開關與資料保護設定。',
  '稽核記錄':'模型呼叫、路由決策與資料分級的查詢與匯出。',
  'Users':'使用者帳號、部門與角色指派。',
  'Roles':'角色與其權限範圍。',
  'Groups':'群組與成員，用於分享與授權。',
  'Monitoring':'用量、成本與預算使用情況。',
};
export default function AdminHome({groups,go,account,orgName}){
  const sections=groups.filter(g=>g.title&&g.items.length);
  return <div className="ah">
    <header className="ah-head"><div><h1>管理帳戶</h1><p>管理組織的 AI 政策、模型路由與稽核存取。</p></div>{orgName&&<span className="ah-org">{orgName}</span>}</header>
    {sections.map(g=><section key={g.title} className="ah-sec"><h2>{g.title}</h2>
      <div className="ah-grid">{g.items.map(([label,key,I])=><button type="button" key={key} className="ah-card" onClick={()=>go(key)}>
        <span className="ah-ico"><I size={20}/></span>
        <span className="ah-txt"><b>{label}</b><small>{DESC[key]||''}</small></span>
        <ArrowRight className="ah-go" size={16}/>
      </button>)}</div></section>)}
    <section className="ah-sec"><h2>帳戶資訊</h2>
      <dl className="ah-info"><div><dt>帳戶名稱</dt><dd>{account}</dd></div><div><dt>身分來源</dt><dd>院內 AD / SSO（未連線）</dd></div><div><dt>管理權限</dt><dd>管理員示範角色 · 正式授權尚未驗證</dd></div></dl>
    </section>
  </div>;
}
