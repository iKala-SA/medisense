import React,{useEffect,useState} from 'react';
import {Cube,TreeStructure,Lightning,Atom,ArrowRight,UsersThree,IdentificationBadge,SignIn,SignOut,Gear,SlidersHorizontal,ClockCounterClockwise} from '@phosphor-icons/react';
import {api} from './api';

/* 管理帳戶 → 帳戶資訊: the signed-in user's profile, groups and roles, what they own, and their own usage (GET /api/me/summary). */
const fmtInt=n=>(n||0).toLocaleString('en-US');
const fmtTokens=n=>n>=1e6?`${(n/1e6).toFixed(1)} M`:n>=1e3?`${(n/1e3).toFixed(1)} k`:String(n||0);
const fmtUsd=n=>`$${(n||0).toFixed(n&&n<1?4:2)}`;
const fmtDate=t=>{if(!t)return '—';const d=new Date(t);return isNaN(d)?'—':d.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'})};
const ago=t=>{if(!t)return '—';const m=Math.round((Date.now()-new Date(t))/60000);if(isNaN(m))return '—';return m<2?'剛剛':m<60?`${m} 分鐘前`:m<1440?`${Math.round(m/60)} 小時前`:`${Math.round(m/1440)} 天前`};
const STATUS={published:['已發布','ok'],pending:['待審核','warn'],draft:['草稿',''],rejected:['已退回','bad']};

function Assets({icon:I,title,data,page,go,extra,render}){
  return <div className="as-asset">
    <button type="button" className="as-asset-head" onClick={()=>go(page)}><span className="ah-ico"><I size={18}/></span>
      <span className="as-asset-t"><b>{title}</b><small>{data.count} 個{extra?` · ${extra}`:''}</small></span><ArrowRight className="ah-go" size={15}/></button>
    {data.items.length?<ul>{data.items.map(x=><li key={x.id}>{render(x)}</li>)}</ul>:<p className="as-none">尚無</p>}
    {data.count>data.items.length&&<button type="button" className="as-more" onClick={()=>go(page)}>查看全部 {data.count} 個</button>}
  </div>;
}

export default function AccountSummary({go}){
  const [d,setD]=useState(null),[err,setErr]=useState('');
  useEffect(()=>{api.meSummary().then(setD).catch(e=>setErr(String(e?.message||e)))},[]);
  if(err)return <div className="ah-info as-msg">無法載入帳戶資訊：{err.replace(/^\d{3}\s*/,'')}</div>;
  if(!d)return <div className="ah-info as-msg">載入中…</div>;
  const {profile:p,groups,roles,assets:a,usage:u}=d;
  const max=Math.max(1e-9,...u.daily.map(x=>x.cost_usd));
  const named=(x,status)=><><span className="as-name">{x.name||x.id}</span>{status}</>;
  const pill=s=>{const [t,c]=STATUS[s]||[s,''];return <span className={'as-pill '+c}>{t}</span>};
  return <div className="as">
    <div className="as-card as-profile">
      <span className="as-avatar">{(p.name||p.email||'?').slice(0,1).toUpperCase()}</span>
      <div className="as-who"><b>{p.name||p.email}</b><small>{p.email}</small>
        <div className="as-chips">{roles.map(r=><span key={r.id} className="as-chip role"><IdentificationBadge size={13}/>{r.name}</span>)}
          {p.status==='suspended'&&<span className="as-chip bad">已停用</span>}</div></div>
      <dl className="as-facts">
        <div><dt><UsersThree size={14}/>群組</dt><dd>{groups.length?<span className="as-chips">{groups.map(g=><span key={g.id} className="as-chip" title={g.description||''}>{g.name}</span>)}</span>:'未加入群組'}</dd></div>
        <div><dt><SignIn size={14}/>登入方式</dt><dd>{p.login_label}</dd></div>
        <div><dt><ClockCounterClockwise size={14}/>帳號建立 / 最後活動</dt><dd>{fmtDate(p.created_at)} · {ago(p.last_seen_at)}</dd></div>
      </dl>
    </div>

    <h3 className="as-h">管理的資產</h3>
    <div className="as-assets">
      <Assets icon={Cube} title="Agent" page="Agent Hub" go={go} data={a.agents} extra={`${a.agents.published} 個已發布`} render={x=>named(x,<>{x.version>0&&<small>v{x.version}</small>}{pill(x.status)}</>)}/>
      <Assets icon={TreeStructure} title="流程" page="Flows" go={go} data={a.flows} extra={`${a.flows.published} 個已發布`} render={x=>named(x,<>{x.version>0&&<small>v{x.version}</small>}{pill(x.status)}</>)}/>
      <Assets icon={Lightning} title="技能" page="Skill" go={go} data={a.skills} render={x=>named(x,!x.enabled&&<span className="as-pill">已停用</span>)}/>
      <Assets icon={Atom} title="空間" page="空間" go={go} data={a.spaces} render={x=>named(x,<small>{x.documents} 份文件</small>)}/>
    </div>

    <h3 className="as-h">我的用量 <small>全部環境 · 模型呼叫</small></h3>
    <div className="as-card as-usage">
      {[['今天',u.today],['近 7 天',u.week],['本月',u.month]].map(([l,v])=><div key={l} className="as-kpi"><small>{l}</small><b>{fmtUsd(v.cost_usd)}</b>
        <span>{fmtInt(v.requests)} 次呼叫 · {fmtTokens(v.tokens)} tokens</span></div>)}
      <div className="as-spark" aria-label="近 14 天每日費用">
        <small>近 14 天每日費用</small>
        <div className="as-bars">{u.daily.map(x=><span key={x.day} title={`${x.day}：${fmtUsd(x.cost_usd)} · ${fmtInt(x.requests)} 次`} style={{height:`${Math.max(x.cost_usd>0?6:2,x.cost_usd/max*100)}%`}} className={x.cost_usd>0?'on':''}/>)}</div>
      </div>
    </div>
  </div>;
}

/* 帳號設定 dialog (sidebar profile): who is signed in, their groups and roles, how they sign in, and three aligned actions. */
export function AccountDialog({me,groupNames,live,admin,onAdmin,onPrefs,onSignOut}){
  const [s,setS]=useState(null);
  useEffect(()=>{if(live)api.meSummary().then(setS).catch(()=>setS(false))},[live]);
  const name=me?.name||me?.email||'Paggie',email=me?.email||'paggie@example.invalid';
  const groups=s?.groups?.map(g=>g.name)||groupNames||[];
  const unknownGroups=!s?.groups&&!groupNames&&me?.groups?.length;
  const roles=s?.roles?.map(r=>r.name)||(me?.role_label?[me.role_label]:[admin?'管理員':'員工']);
  const login=!live?'院內 AD（模擬）':s===null?'載入中…':s?.profile?.login_label||'—';
  return <div className="acd">
    <div className="identity"><span className="avatar">{name.slice(0,1).toUpperCase()}</span><div><b>{name}</b><small>{email}</small></div></div>
    <dl className="acd-facts">
      <div><dt><UsersThree size={15}/>群組</dt><dd>{groups.length?<span className="as-chips">{groups.map(g=><span key={g} className="as-chip">{g}</span>)}</span>:unknownGroups?`${me.groups.length} 個群組`:'未加入群組'}</dd></div>
      <div><dt><IdentificationBadge size={15}/>角色</dt><dd><span className="as-chips">{roles.map(r=><span key={r} className="as-chip role">{r}</span>)}</span></dd></div>
      <div><dt><SignIn size={15}/>登入方式</dt><dd>{login}</dd></div>
      {s?.profile?.last_seen_at&&<div><dt><ClockCounterClockwise size={15}/>最後活動</dt><dd>{ago(s.profile.last_seen_at)}</dd></div>}
    </dl>
    <div className="acd-actions">
      {admin&&<button className="btn" onClick={onAdmin}><Gear size={16}/>管理帳戶</button>}
      <button className="btn" onClick={onPrefs}><SlidersHorizontal size={16}/>偏好設定</button>
      <button className="btn" onClick={onSignOut}><SignOut size={16}/>登出</button>
    </div>
  </div>;
}
