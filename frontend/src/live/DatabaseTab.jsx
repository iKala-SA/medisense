import React,{useEffect,useState} from 'react';
import {Icon} from '@iconify/react';
import postgresIcon from '@iconify-icons/logos/postgresql';
import mysqlIcon from '@iconify-icons/logos/mysql-icon';
import oracleIcon from '@iconify-icons/logos/oracle';
import mariaIcon from '@iconify-icons/logos/mariadb-icon';
import snowflakeIcon from '@iconify-icons/logos/snowflake-icon';
import ProviderIcon from './ProviderIcon';
import {Database,Plus,Trash,Warning,Lock,X} from '@phosphor-icons/react';
import {api} from '../api';
import {authorizeBigQuery,bigqueryToken} from '../firebase';
import {errText,useOnce,Loading,Banner} from './pkit';
import {Empty} from '../ListKit';
import './database.css';
import './gatewaycatalog.css';

/* MVP: a connection is just where the database is and how to log in. PostgreSQL / MySQL / SQL Server use the account entered
   here; BigQuery takes no account — every user queries with their own Google identity. Agents linked to a connection can list
   its tables and run read-only SELECTs. */
export const DB_KINDS={
  postgres:{label:'PostgreSQL',fields:[['host','主機（IP 或網域）'],['port','連接埠','5432'],['database','資料庫名稱']]},
  mysql:{label:'MySQL',fields:[['host','主機（IP 或網域）'],['port','連接埠','3306'],['database','資料庫名稱']]},
  mssql:{label:'SQL Server',fields:[['host','主機（IP 或網域）'],['port','連接埠','1433'],['database','資料庫名稱']]},
  bigquery:{label:'BigQuery',fields:[['project','專案 ID','','例：cloud-sa-sandbox-1'],['location','區域（region）','asia-east1'],['datasets','資料集（多個用逗號分隔）','','例：esther_dataset']]},
};
const nice=m=>{ // FastAPI validation errors arrive as a JSON list
  const i=m.indexOf('[');if(i<0)return m;
  try{return JSON.parse(m.slice(i)).map(x=>`${(x.loc||[]).filter(k=>k!=='body').join(' › ')}：${String(x.msg).replace(/^Value error, /,'')}`).join('\n')}catch{return m}
};

/* 建立 / 設定: one small dialog for both. */
function ConnDialog({init,onClose,onSaved,onDeleted}){
  const kind=init.kind,K=DB_KINDS[kind],bq=kind==='bigquery',saved=!!init.id;
  const [v,setV]=useState(()=>({name:init.name||'',description:init.description||'',user:init.user||'',password:'',max_rows:init.max_rows||100,
    ssl:init.connection?.ssl||'false',...Object.fromEntries(K.fields.map(([k,,d])=>[k,init.connection?.[k]??(saved?'':d||'')]))}));
  const [busy,setBusy]=useState(''),[msg,setMsg]=useState(null);
  const set=(k,x)=>{setV(o=>({...o,[k]:x}));setMsg(null)};
  const conn=()=>({...Object.fromEntries(K.fields.map(([k])=>[k,String(v[k]||'').trim()])),...(bq?{}:{ssl:v.ssl})});
  const needPw=!bq&&!init.password_set;
  const missing=!v.name.trim()||K.fields.some(([k])=>!String(v[k]||'').trim())||(!bq&&!v.user.trim())||(needPw&&!v.password);
  const verify=async()=>{
    setBusy('t');setMsg(null);
    try{
      if(bq&&!bigqueryToken())await authorizeBigQuery(); // BigQuery is tested with the admin's own Google account
      // a saved connection with an unchanged password is tested with the stored one
      setMsg(saved&&!v.password&&!bq?await api.testSavedDb(init.id):await api.testDbConnection(kind,conn(),bq?'':v.user.trim(),bq?'':v.password));
    }catch(e){const c=e?.code||'';setMsg({ok:false,message:c==='auth/popup-closed-by-user'?'已取消 BigQuery 授權':nice(errText(e))})}
    finally{setBusy('')}
  };
  const save=async()=>{
    setBusy('s');setMsg(null);
    const body={name:v.name.trim(),kind,description:v.description.trim(),connection:conn(),max_rows:Math.min(1000,Math.max(1,+v.max_rows||100)),
      ...(bq?{}:{user:v.user.trim(),...(v.password?{password:v.password}:{})})};
    try{onSaved(saved?await api.updateDbConnector(init.id,body):await api.createDbConnector(body))}
    catch(e){setMsg({ok:false,message:nice(errText(e))});setBusy('')}
  };
  const remove=async()=>{if(!window.confirm(`刪除「${init.name}」？連結到它的 Agent 將無法再查詢這個資料庫${bq?'':'，已儲存的密碼也會一併刪除'}。`))return;
    setBusy('d');try{await api.deleteDbConnector(init.id);onDeleted(init.id)}catch(e){setMsg({ok:false,message:errText(e)});setBusy('')}};
  useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
  const inp=(k,l,ph,extra={})=><label key={k}>{l}<input value={v[k]} placeholder={ph||''} onChange={e=>set(k,e.target.value)} {...extra}/></label>;
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal lv-db-create" role="dialog" aria-modal="true" aria-label={`${K.label} 連線`}>
    <header><h2>{saved?init.name:`新的 ${K.label} 連線`}</h2><button type="button" className="icon-btn" aria-label="關閉" onClick={onClose}><X size={16}/></button></header>
    <form onSubmit={e=>{e.preventDefault();if(!missing&&!busy)save()}}>
      {inp('name','名稱','例：藥局資料庫',{autoFocus:!saved})}
      {inp('description','說明（選填，Agent 會參考）','這個資料庫裡有什麼資料')}
      <div className="lv-db-grid">{K.fields.map(([k,l,d,ph])=>inp(k,l,ph||d))}</div>
      {bq?<p className="lv-db-note ic"><Lock size={13}/> 不需要帳號密碼：每位使用者以自己的 Google 帳號查詢，看得到的資料由 Google IAM 決定。要讓使用者授權一次就長期有效，請在「連接器 → 全部服務」啟用 Google BigQuery（google_bigquery，允許 query / start_query_job / get_query_results）並分享；否則使用者在對話中點「授權 BigQuery」取得一小時的臨時授權。</p>
        :<div className="lv-db-grid">{inp('user','帳號','建議使用唯讀帳號',{autoComplete:'off'})}
          {inp('password','密碼',init.password_set?'已設定（留空沿用）':'',{type:'password',autoComplete:'new-password'})}</div>}
      <div className="lv-db-grid">{inp('max_rows','單次最多回傳筆數','100',{type:'number',min:1,max:1000,style:{maxWidth:160}})}</div>
      {msg&&<p className={'lv-db-res '+(msg.ok===false?'bad':msg.ok?'ok':'')} style={{whiteSpace:'pre-line',...(msg.ok==null?{background:'#f3f6f4',color:'#4b6157'}:{})}}>{msg.message}</p>}
      <footer>
        {saved&&<button type="button" className="btn danger" disabled={!!busy} onClick={remove}><Trash size={13}/>刪除</button>}
        {!bq&&<label className="lv-db-ssl"><input type="checkbox" checked={v.ssl==='true'} onChange={e=>set('ssl',e.target.checked?'true':'false')}/>SSL</label>}
        <span className="grow"/>
        <button type="button" className="btn" disabled={!!busy||(bq?!v.project.trim()||!v.datasets.trim():!v.host.trim()||!v.port.trim())} onClick={verify}>{busy==='t'?'驗證中…':'驗證連線'}</button>
        <button type="submit" className="btn primary" disabled={missing||!!busy}>{busy==='s'?'儲存中…':saved?'儲存':'建立'}</button>
      </footer>
    </form></section></div>;
}

const CATALOG=[
  {id:'postgres',name:'PostgreSQL',sub:'自建或 Cloud SQL（填私有 IP）',icon:postgresIcon,kind:'postgres',common:true},
  {id:'mysql',name:'MySQL',sub:'自建或 Cloud SQL（填私有 IP）',icon:mysqlIcon,kind:'mysql',common:true},
  {id:'mssql',name:'SQL Server',sub:'自建或 Cloud SQL（填私有 IP）',kind:'mssql',common:true},
  {id:'bigquery',name:'Google BigQuery',sub:'以使用者自己的 Google 帳號查詢',service:'google_bigquery',kind:'bigquery',common:true},
  {id:'oracle',name:'Oracle',sub:'院內 HIS 常見',icon:oracleIcon,soon:true},
  {id:'mariadb',name:'MariaDB',sub:'',icon:mariaIcon,soon:true},
  {id:'snowflake',name:'Snowflake',sub:'',icon:snowflakeIcon,soon:true},
];
const Logo=({c,size=40})=><span className="lv-gc-ico" style={{width:size,height:size}}>{c.service?<ProviderIcon service={c.service} name={c.name} size={size}/>:c.icon?<Icon icon={c.icon} width={size*0.6} height={size*0.6}/>:<Database size={size*0.55} color="#0b6bcb"/>}</span>;
const where=c=>c.kind==='bigquery'?`${c.connection?.project||''} · ${c.connection?.datasets||''}`:`${c.user?c.user+'@':''}${c.connection?.host||''}:${c.connection?.port||''}/${c.connection?.database||''}`;

export default function DatabaseTab({notify,mode,q}){
  const [list,setList]=useState(null),[open,setOpen]=useState(null),[denied,setDenied]=useState('');
  useOnce(()=>{api.listDbConnectors().then(setList).catch(e=>{const m=errText(e);setList([]);if(m.startsWith('403'))setDenied(m);else notify('無法載入資料庫連線：'+m)})});
  const s=(q||'').trim().toLowerCase();
  if(list===null)return <Loading/>;
  if(denied)return <Banner icon={<Warning size={16}/>}>只有管理員可以管理資料庫連線。</Banner>;
  const made=c=>c.kind?list.filter(x=>x.kind===c.kind).length:0;
  const cat=CATALOG.filter(c=>(mode==='all'||c.common)&&(!s||(c.name+c.sub).toLowerCase().includes(s)));
  const mine=list.filter(c=>!s||(c.name+(c.description||'')+(DB_KINDS[c.kind]?.label||'')).toLowerCase().includes(s));
  return <div className="lv-db">
    {mode==='mine'?(mine.length?<div className="lv-p-cards">{mine.map(c=><div className="lv-p-card" key={c.id}>
      <div className="lv-p-card-head"><span className="connector-icon"><Database size={24}/></span><div style={{minWidth:0}}><h3>{c.name}</h3><span className="lv-p-meta">{DB_KINDS[c.kind]?.label||c.kind}</span></div></div>
      <p>{c.description||'（無說明）'}</p>
      <p className="lv-p-meta" title={where(c)} style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{where(c)}</p>
      <div className="lv-p-card-foot"><span className="grow"/><button className="btn sm" onClick={()=>setOpen(c)}>設定</button></div>
    </div>)}</div>:<div className="lt"><Empty text={list.length?'沒有符合的連線':'尚未建立資料庫連線。到「常用連接器」選一種資料庫開始。'}/></div>)
    :<>
      <p className="lv-db-note">選一種資料庫建立連線，再到 Agent 的設定裡連結它；使用這個 Agent 的人就能用自然語言查詢（唯讀）。</p>
      {cat.length?<div className="lv-gc-grid lv-db-grid4">{cat.map(c=><button key={c.id} type="button" className={'lv-gc-card lv-db-opt'+(c.soon?' soon':'')} disabled={c.soon} onClick={()=>!c.soon&&setOpen({kind:c.kind})}>
        <div className="lv-gc-head"><Logo c={c}/><div><h3>{c.name}</h3>{c.sub&&<span className="lv-p-meta">{c.sub}</span>}</div></div>
        <div className="lv-gc-foot">{c.soon?<span className="lv-gc-tag">尚未提供</span>:<span className="lv-p-meta">{made(c)?`已建立 ${made(c)} 個`:'尚未建立'}</span>}{!c.soon&&<span className="lv-db-add"><Plus size={12}/>建立</span>}</div>
      </button>)}</div>:<div className="lt"><Empty text="沒有符合的資料庫"/></div>}
    </>}
    {open&&DB_KINDS[open.kind]&&<ConnDialog key={open.id||'new'} init={open} onClose={()=>setOpen(null)}
      onSaved={c=>{setOpen(null);setList(a=>a.some(x=>x.id===c.id)?a.map(x=>x.id===c.id?c:x):[c,...a]);notify(open.id?'已儲存':'已建立連線。接著到 Agent 設定裡連結它。')}}
      onDeleted={id=>{setOpen(null);setList(a=>a.filter(x=>x.id!==id));notify('已刪除連線')}}/>}
  </div>;
}

/* Non-admins: the connections that exist (MVP: no per-group rules — access comes from the Agents that link them). */
export function MyDb({q}){
  const [list,setList]=useState(null),[err,setErr]=useState('');
  useOnce(()=>{api.myDbConnectors().then(setList).catch(e=>{setErr(errText(e));setList([])})});
  if(list===null)return <Loading/>;
  const s=(q||'').trim().toLowerCase(),rows=list.filter(c=>!s||(c.name+(c.description||'')+(DB_KINDS[c.kind]?.label||'')).toLowerCase().includes(s));
  return <div className="lv-db">
    <p className="lv-db-note">這些資料庫可以透過連結它們的 Agent 查詢（唯讀）。BigQuery 以你自己的 Google 帳號查詢。</p>
    {err&&<Banner icon={<Warning size={16}/>}>{err}</Banner>}
    {rows.length?<div className="lv-p-cards">{rows.map(c=><div className="lv-p-card" key={c.id}>
      <div className="lv-p-card-head"><span className="connector-icon"><Database size={24}/></span><div style={{minWidth:0}}><h3>{c.name}</h3><span className="lv-p-meta">{DB_KINDS[c.kind]?.label||c.kind}</span></div></div>
      <p>{c.description||'（無說明）'}</p>
    </div>)}</div>:<div className="lt"><Empty text={list.length?'沒有符合的資料庫':'目前還沒有資料庫連線。'}/></div>}
  </div>;
}
