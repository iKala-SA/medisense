import React from 'react';
import {ArrowRight} from '@phosphor-icons/react';
import AccountSummary from './AccountSummary';
import './admin-home.css';

/* Admin home: one page, no heading. The signed-in account first (profile, assets, usage), then every admin area as a card,
   grouped like the sidebar. */
const DESC={
  'Model':'瀏覽可用模型、一鍵註冊並套用到 Medisense Model Gateway。',
  'Model Routing':'模型群組、規則優先順序與敏感資料處置政策。',
  '稽核記錄':'模型呼叫、路由決策與資料分級的查詢與匯出。',
  'Users':'使用者帳號、部門與角色指派。',
  'Roles':'角色與其權限範圍。',
  'Groups':'群組與成員，用於分享與授權。',
  'Monitoring':'用量、成本與預算使用情況。',
};
export default function AdminHome({groups,go,account,live=false}){
  const sections=groups.filter(g=>g.title&&g.items.length);
  return <div className="ah">
    <section className="ah-sec"><h2>帳戶資訊</h2>
      {live?<AccountSummary go={go}/>:<dl className="ah-info"><div><dt>帳戶名稱</dt><dd>{account}</dd></div><div><dt>身分來源</dt><dd>院內 AD / SSO（未連線）</dd></div><div><dt>管理權限</dt><dd>管理員示範角色 · 正式授權尚未驗證</dd></div></dl>}
    </section>
    {sections.map(g=><section key={g.title} className="ah-sec"><h2>{g.title}</h2>
      <div className="ah-grid">{g.items.map(([label,key,I])=><button type="button" key={key} className="ah-card" onClick={()=>go(key)}>
        <span className="ah-ico"><I size={20}/></span>
        <span className="ah-txt"><b>{label}</b><small>{DESC[key]||''}</small></span>
        <ArrowRight className="ah-go" size={16}/>
      </button>)}</div></section>)}
  </div>;
}
