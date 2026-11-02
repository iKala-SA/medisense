import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Icon} from '@iconify/react';
import postgresIcon from '@iconify-icons/logos/postgresql';
import mysqlIcon from '@iconify-icons/logos/mysql-icon';
import cloudIcon from '@iconify-icons/logos/google-cloud';
import oracleIcon from '@iconify-icons/logos/oracle';
import mariaIcon from '@iconify-icons/logos/mariadb-icon';
import snowflakeIcon from '@iconify-icons/logos/snowflake-icon';
import ProviderIcon from './ProviderIcon';
import {Database,Plus,Trash,ArrowUp,ArrowDown,ArrowLeft,Warning,Lock,MagnifyingGlass,X,CloudArrowUp,CircleNotch,CheckCircle,FileCode} from '@phosphor-icons/react';
import {api} from '../api';
import {errText,useOnce,Loading,Banner} from './pkit';
import {Empty} from '../ListKit';
import './database.css';
import './gatewaycatalog.css';

export const DB_KINDS={
  postgres:{label:'PostgreSQL',fields:[['host','主機'],['port','連接埠','5432'],['database','資料庫']]},
  mysql:{label:'MySQL',fields:[['host','主機'],['port','連接埠','3306'],['database','資料庫']]},
  mssql:{label:'SQL Server',fields:[['host','主機'],['port','連接埠','1433'],['database','資料庫']]},
  cloud_sql_postgres:{label:'Cloud SQL · PostgreSQL',fields:[['project','專案 ID'],['region','區域','asia-east1'],['instance','執行個體'],['database','資料庫'],['ip_type','IP 類型（public / private / psc）','private']]},
  cloud_sql_mysql:{label:'Cloud SQL · MySQL',fields:[['project','專案 ID'],['region','區域','asia-east1'],['instance','執行個體'],['database','資料庫'],['ip_type','IP 類型（public / private / psc）','private']]},
  cloud_sql_mssql:{label:'Cloud SQL · SQL Server',fields:[['project','專案 ID'],['region','區域','asia-east1'],['instance','執行個體'],['database','資料庫'],['ip_type','IP 類型（public / private / psc）','private']]},
  bigquery:{label:'BigQuery',fields:[['project','專案 ID'],['location','位置','asia-east1'],['datasets','允許的資料集（逗號分隔，留空＝不限制）']]},
};
const SSL_KINDS=new Set(['postgres','mysql','mssql']);
const OPTIONAL=new Set(['ip_type','datasets']);
/* 建立: a small dialog with only what this kind of database needs. Queries, views and rules are set up afterwards. */
function CreateDialog({kind,onClose,onCreated}){
  const K=DB_KINDS[kind],bq=kind==='bigquery';
  const [v,setV]=useState(()=>({name:'',user:'',password:'',ssl:'true',...Object.fromEntries(K.fields.map(([k,,d])=>[k,d||'']))}));
  const [busy,setBusy]=useState(''),[msg,setMsg]=useState(null);
  const set=(k,x)=>{setV(o=>({...o,[k]:x}));setMsg(null)};
  const fields=[['name','資料來源名稱','例：藥局資料庫'],...K.fields.map(([k,l])=>[k,l,'']),...(bq?[]:[['user','使用者名稱','建議使用唯讀帳號'],['password','密碼','']])];
  const missing=fields.some(([k])=>!OPTIONAL.has(k)&&!String(v[k]||'').trim());
  const conn=()=>({...Object.fromEntries(K.fields.map(([k])=>[k,String(v[k]||'').trim()])),...(SSL_KINDS.has(kind)?{ssl:v.ssl}:{})});
  const verify=async()=>{setBusy('t');try{setMsg(await api.testDbConnection(kind,conn(),bq?'':v.user.trim(),bq?'':v.password))}catch(e){setMsg({ok:false,message:nice(errText(e))})}finally{setBusy('')}};
  const create=async()=>{
    setBusy('c');
    try{onCreated(await api.createDbConnector({name:v.name.trim(),kind,description:'',connection:conn(),max_rows:100,
      sources:bq?[]:[{id:'main',label:v.user.trim(),user:v.user.trim(),password:v.password}],queries:[],views:[],rules:[]}))}
    catch(e){setMsg({ok:false,message:nice(errText(e))});setBusy('')}
  };
  useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal lv-db-create" role="dialog" aria-modal="true" aria-label={`新的 ${K.label} 資料來源`}>
    <header><h2>新的 {K.label} 資料來源</h2><button type="button" className="icon-btn" aria-label="關閉" onClick={onClose}><X size={16}/></button></header>
    <form onSubmit={e=>{e.preventDefault();if(!missing)create()}}>
      {fields.map(([k,l,ph],i)=><label key={k}>{l}{OPTIONAL.has(k)&&<em>（選填）</em>}
        {k==='ip_type'?<select value={v[k]} onChange={e=>set(k,e.target.value)}><option value="private">private（私有 IP）</option><option value="public">public（公有 IP）</option><option value="psc">psc（Private Service Connect）</option></select>
          :<input autoFocus={i===0} type={k==='password'?'password':'text'} autoComplete={k==='password'?'new-password':'off'} value={v[k]} placeholder={ph||(K.fields.find(f=>f[0]===k)?.[2])||''} onChange={e=>set(k,e.target.value)}/>}</label>)}
      {msg&&<p className={'lv-db-res '+(msg.ok===false?'bad':msg.ok?'ok':'')} style={msg.ok==null?{background:'#f3f6f4',color:'#4b6157'}:null}>{msg.message}</p>}
      <footer>{SSL_KINDS.has(kind)&&<label className="lv-db-ssl"><input type="checkbox" checked={v.ssl==='true'} onChange={e=>set('ssl',e.target.checked?'true':'false')}/>啟用 SSL</label>}<button type="button" className="btn" disabled={!!busy||fields.some(([k])=>['host','port','project'].includes(k)&&!String(v[k]||'').trim())} onClick={verify}>{busy==='t'?'驗證中…':'驗證連線'}</button>
        <span className="grow"/><button type="submit" className="btn primary" disabled={missing||!!busy}>{busy==='c'?'建立中…':'建立資料來源'}</button></footer>
    </form></section></div>;
}

const PH={postgres:'$1, $2…',cloud_sql_postgres:'$1, $2…',mysql:'?',cloud_sql_mysql:'?'};
let seq=0;
const nid=p=>`${p}${Date.now().toString(36).slice(-4)}${++seq}`; // default id when the name has no latin letters (e.g. a Chinese name)
const nice=m=>{ // FastAPI validation errors arrive as a JSON list
  const i=m.indexOf('[');if(i<0)return m;
  try{return JSON.parse(m.slice(i)).map(x=>`${(x.loc||[]).filter(k=>k!=='body').join(' › ')}：${x.msg}`).join('\n')}catch{return m}
};
const slug=s=>s.toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^[^a-z]+/,'').slice(0,40);
const blank=kind=>({name:'',kind,description:'',connection:Object.fromEntries(DB_KINDS[kind].fields.map(([k,,d])=>[k,d||''])),sources:[],queries:[],views:[],rules:[],max_rows:200});
const TABS=[['conn','連線'],['src','資料庫帳號'],['q','預先定義查詢'],['v','可查詢的檢視表'],['rules','存取規則']];

const BUSY=['dispatched','queued','deploying'];
/* 套用: tools.yaml is re-rendered on every save; this applies it to the Toolbox service (GitHub Actions, infra/13). */
function ApplyBar({notify,reloadKey,onDeployed}){
  const [st,setSt]=useState(null),[busy,setBusy]=useState(false),[yaml,setYaml]=useState(false);
  const load=()=>api.dbApplyState().then(setSt).catch(()=>{});
  useEffect(()=>{load()},[reloadKey]);// eslint-disable-line react-hooks/exhaustive-deps
  const running=st?.deploy&&BUSY.includes(st.deploy.status);
  const was=useRef(false);
  useEffect(()=>{if(was.current&&!running&&st?.deploy?.status==='deployed')onDeployed?.();was.current=!!running},[running,st]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!running)return;const t=setInterval(load,5000);return()=>clearInterval(t)},[running]);
  if(!st||!st.render)return null;
  const {render,deploy,pending}=st,probs=render.problems||[];
  const go=async()=>{setBusy(true);try{await api.dbApply();notify('已送出套用，部署約需 1–2 分鐘');await load()}catch(e){notify('套用失敗：'+nice(errText(e)))}finally{setBusy(false)}};
  let tone='',icon=<CloudArrowUp size={16}/>,text;
  if(running){tone='run';icon=<CircleNotch className="spin" size={16}/>;text=`正在套用版本 ${deploy.version} 到 Toolbox…`}
  else if(deploy?.status==='failed'&&deploy.version===render.version){tone='bad';icon=<Warning size={16}/>;text=`版本 ${deploy.version} 套用失敗。`}
  else if(!render.yaml){text='目前沒有可套用的內容：需要至少一條規則開放查詢或檢視表。'}
  else if(pending){text=`有尚未套用的變更（版本 ${render.version}）。套用後，使用者才會依新規則查詢。`}
  else{tone='ok';icon=<CheckCircle size={16}/>;text=`已套用到 Toolbox（版本 ${deploy.version}）。`}
  return <div className={'lv-db-apply '+tone}>
    <span className="lv-db-apply-t">{icon}<span>{text}{deploy?.run_url&&(running||tone==='bad')&&<> <a href={deploy.run_url} target="_blank" rel="noreferrer">查看執行紀錄</a></>}</span></span>
    {probs.length>0&&render.yaml&&<span className="lv-db-apply-p">{probs.join('；')}</span>}
    <span className="grow"/>
    {render.yaml&&<button className="btn sm" onClick={()=>setYaml(true)}><FileCode size={13}/>檢視 tools.yaml</button>}
    {render.yaml&&(pending||tone==='bad')&&!running&&<button className="btn sm primary" disabled={busy||probs.length>0} onClick={go}>{busy?'送出中…':'套用到 Toolbox'}</button>}
    {yaml&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setYaml(false)}}><section className="modal lv-db-yaml" role="dialog" aria-modal="true" aria-label="tools.yaml">
      <h2>產生的 tools.yaml（版本 {render.version}）</h2><p className="lv-db-note">密碼不會出現在這裡，只以 <code>{'${DBPW_n}'}</code> 參照 Secret Manager。</p>
      <pre>{render.yaml}</pre><div className="modal-actions"><button className="btn" onClick={()=>setYaml(false)}>關閉</button></div></section></div>}
  </div>;
}

const toggle=(arr,id)=>arr.includes(id)?arr.filter(x=>x!==id):[...arr,id];
const move=(arr,i,d)=>{const a=[...arr],j=i+d;if(j<0||j>=a.length)return a;[a[i],a[j]]=[a[j],a[i]];return a};

function Conn({d,set}){
  const K=DB_KINDS[d.kind];
  return <div className="lv-db-form">
    <label>名稱<input value={d.name} onChange={e=>set({name:e.target.value})} placeholder="例：藥局資料庫"/></label>
    <label>說明<input value={d.description} onChange={e=>set({description:e.target.value})} placeholder="這個資料庫裡有什麼、給誰用"/></label>
    <div className="lv-db-grid">{K.fields.map(([k,l,def])=><label key={k}>{l}<input value={d.connection[k]||''} placeholder={def||''} onChange={e=>set({connection:{...d.connection,[k]:e.target.value}})}/></label>)}</div>
    {SSL_KINDS.has(d.kind)&&<label className="lv-db-chk" style={{flexDirection:'row',gap:6}}><input type="checkbox" checked={d.connection.ssl==='true'} onChange={e=>set({connection:{...d.connection,ssl:e.target.checked?'true':'false'}})}/>啟用 SSL（加密連線）</label>}
    <label>單次查詢最多回傳列數<input type="number" min={1} max={1000} value={d.max_rows} onChange={e=>set({max_rows:+e.target.value||1})} style={{maxWidth:140}}/></label>
    {d.kind==='bigquery'&&<p className="lv-db-note ic"><Lock size={13}/> BigQuery 以使用者自己的 Google 身分查詢（瀏覽器取得的暫時授權，不儲存），因此不需要資料庫帳號；唯讀、僅限已註冊的資料集。</p>}
  </div>;
}

function Sources({d,set}){
  const up=(i,p)=>set({sources:d.sources.map((s,k)=>k===i?{...s,...p}:s)});
  if(d.kind==='bigquery')return <p className="lv-db-note ic"><Lock size={13}/> BigQuery 不使用共用帳號，每位使用者以自己的 Google 權限查詢。</p>;
  return <div className="lv-db-form">
    <p className="lv-db-note">建議為每種權限等級建立一個<b>唯讀</b>資料庫帳號（例如「藥劑部唯讀」「護理部唯讀」），再用「存取規則」決定哪個群組使用哪個帳號。密碼只存放於 Secret Manager，儲存後不會再顯示。</p>
    {d.sources.map((s,i)=><div className="lv-db-row" key={i}>
      <input aria-label="顯示名稱" placeholder="顯示名稱（例：藥劑部唯讀）" value={s.label} onChange={e=>up(i,{label:e.target.value,...(s._new&&slug(e.target.value)?{id:slug(e.target.value)}:{})})}/>
      <input aria-label="代號" placeholder="代號" value={s.id} disabled={!s._new} onChange={e=>up(i,{id:slug(e.target.value)})} style={{maxWidth:130}}/>
      <input aria-label="資料庫帳號" placeholder="資料庫帳號" value={s.user} onChange={e=>up(i,{user:e.target.value})}/>
      <input aria-label="密碼" type="password" autoComplete="new-password" placeholder={s.password_set?'已設定（留空沿用）':'密碼'} value={s.password||''} onChange={e=>up(i,{password:e.target.value})}/>
      <button className="icon-btn" aria-label="移除帳號" onClick={()=>set({sources:d.sources.filter((_,k)=>k!==i),rules:d.rules.map(r=>r.source_id===s.id?{...r,source_id:''}:r)})}><Trash size={15}/></button>
    </div>)}
    <button className="btn sm" onClick={()=>set({sources:[...d.sources,{id:nid('src_'),label:'',user:'',password:'',_new:true}]})}><Plus size={12}/>新增帳號</button>
  </div>;
}

function Queries({d,set}){
  const [open,setOpen]=useState(0);
  const up=(i,p)=>set({queries:d.queries.map((q,k)=>k===i?{...q,...p}:q)});
  const upP=(i,j,p)=>up(i,{parameters:d.queries[i].parameters.map((x,k)=>k===j?{...x,...p}:x)});
  return <div className="lv-db-form">
    <p className="lv-db-note">由管理員撰寫的<b>唯讀、參數化</b>查詢。模型只能填入參數，不能改 SQL。{PH[d.kind]?`參數以 ${PH[d.kind]} 表示，依序對應下方參數。`:'參數依序對應下方參數。'}</p>
    {d.queries.map((q,i)=><div className={'lv-db-card'+(open===i?' open':'')} key={i}>
      <div className="lv-db-card-head" onClick={()=>setOpen(open===i?-1:i)}><b>{q.name||'（未命名查詢）'}</b><span className="lv-p-meta">{q.id}</span><span className="grow"/>
        <button className="icon-btn" aria-label="刪除查詢" onClick={e=>{e.stopPropagation();set({queries:d.queries.filter((_,k)=>k!==i),rules:d.rules.map(r=>({...r,queries:r.queries.filter(x=>x!==q.id)}))})}}><Trash size={15}/></button></div>
      {open===i&&<div className="lv-db-card-body">
        <div className="lv-db-grid"><label>名稱<input value={q.name} onChange={e=>up(i,{name:e.target.value,...(q._new&&slug(e.target.value)?{id:slug(e.target.value)}:{})})}/></label>
          <label>代號<input value={q.id} disabled={!q._new} onChange={e=>up(i,{id:slug(e.target.value)})}/></label></div>
        <label>說明（模型靠這段決定何時使用）<input value={q.description} onChange={e=>up(i,{description:e.target.value})}/></label>
        <label>SQL（僅限 SELECT）<textarea rows={4} spellCheck={false} value={q.statement} onChange={e=>up(i,{statement:e.target.value})} placeholder="SELECT name, qty FROM v_stock WHERE code = $1"/></label>
        <div className="lv-db-sub">參數</div>
        {q.parameters.map((p,j)=><div className="lv-db-row" key={j}>
          <input aria-label="參數名稱" placeholder="名稱" value={p.name} onChange={e=>upP(i,j,{name:e.target.value})} style={{maxWidth:140}}/>
          <select aria-label="型別" value={p.type} onChange={e=>upP(i,j,{type:e.target.value})}>{['string','integer','float','boolean'].map(t=><option key={t}>{t}</option>)}</select>
          <input aria-label="參數說明" placeholder="說明" value={p.description} onChange={e=>upP(i,j,{description:e.target.value})}/>
          <button className="icon-btn" aria-label="移除參數" onClick={()=>up(i,{parameters:q.parameters.filter((_,k)=>k!==j)})}><Trash size={15}/></button></div>)}
        <button className="btn sm" onClick={()=>up(i,{parameters:[...q.parameters,{name:'',type:'string',description:'',required:true}]})}><Plus size={12}/>新增參數</button>
      </div>}
    </div>)}
    <button className="btn sm" onClick={()=>{set({queries:[...d.queries,{id:nid('q_'),name:'',description:'',statement:'',parameters:[],_new:true}]});setOpen(d.queries.length)}}><Plus size={12}/>新增查詢</button>
  </div>;
}

function Views({d,set}){
  const [open,setOpen]=useState(0);
  const up=(i,p)=>set({views:d.views.map((v,k)=>k===i?{...v,...p}:v)});
  const upC=(i,j,p)=>up(i,{columns:d.views[i].columns.map((x,k)=>k===j?{...x,...p}:x)});
  return <div className="lv-db-form">
    <p className="lv-db-note">自然語言查詢只能碰這裡登記的檢視表與欄位。標記「敏感」的欄位不會提供給模型，也不會出現在結果中。建議登記資料庫裡已去識別化的 <b>View</b>，而不是原始資料表。</p>
    {d.views.map((v,i)=><div className={'lv-db-card'+(open===i?' open':'')} key={i}>
      <div className="lv-db-card-head" onClick={()=>setOpen(open===i?-1:i)}><b>{v.name||'（未命名檢視表）'}</b><span className="lv-p-meta">{v.columns.length} 欄</span><span className="grow"/>
        <button className="icon-btn" aria-label="刪除檢視表" onClick={e=>{e.stopPropagation();set({views:d.views.filter((_,k)=>k!==i),rules:d.rules.map(r=>({...r,views:r.views.filter(x=>x!==v.id)}))})}}><Trash size={15}/></button></div>
      {open===i&&<div className="lv-db-card-body">
        <div className="lv-db-grid"><label>檢視表名稱（可含 schema）<input value={v.name} placeholder="public.v_stock" onChange={e=>up(i,{name:e.target.value,...(v._new&&slug(e.target.value.split('.').pop())?{id:slug(e.target.value.split('.').pop())}:{})})}/></label>
          <label>代號<input value={v.id} disabled={!v._new} onChange={e=>up(i,{id:slug(e.target.value)})}/></label></div>
        <label>說明<input value={v.description} onChange={e=>up(i,{description:e.target.value})}/></label>
        <div className="lv-db-sub">欄位</div>
        {v.columns.map((c,j)=><div className="lv-db-row" key={j}>
          <input aria-label="欄位名稱" placeholder="欄位名稱" value={c.name} onChange={e=>upC(i,j,{name:e.target.value})}/>
          <input aria-label="型別" placeholder="型別（選填）" value={c.type} onChange={e=>upC(i,j,{type:e.target.value})} style={{maxWidth:130}}/>
          <label className="lv-db-chk"><input type="checkbox" checked={!!c.sensitive} onChange={e=>upC(i,j,{sensitive:e.target.checked})}/>敏感</label>
          <button className="icon-btn" aria-label="移除欄位" onClick={()=>up(i,{columns:v.columns.filter((_,k)=>k!==j)})}><Trash size={15}/></button></div>)}
        <button className="btn sm" onClick={()=>up(i,{columns:[...v.columns,{name:'',type:'',sensitive:false}]})}><Plus size={12}/>新增欄位</button>
      </div>}
    </div>)}
    <button className="btn sm" onClick={()=>{set({views:[...d.views,{id:nid('v_'),name:'',description:'',columns:[],examples:[],_new:true}]});setOpen(d.views.length)}}><Plus size={12}/>新增檢視表</button>
  </div>;
}

function Rules({d,set,groups,cid}){
  const [email,setEmail]=useState(''),[res,setRes]=useState(null),[err,setErr]=useState(''),[sql,setSql]=useState(''),[sres,setSres]=useState(null);
  const bq=d.kind==='bigquery';
  const up=(i,p)=>set({rules:d.rules.map((r,k)=>k===i?{...r,...p}:r)});
  const checkSql=async()=>{setErr('');setSres(null);try{setSres(await api.checkDbSql(cid,email,sql))}catch(e){setErr(errText(e))}};
  const test=async()=>{setErr('');setRes(null);try{setRes(await api.resolveDbAccess(cid,email))}catch(e){setErr(errText(e))}};
  return <div className="lv-db-form">
    <p className="lv-db-note">由上而下比對，<b>第一條符合的規則生效</b>；都不符合就<b>拒絕</b>。管理員也一樣，沒有資料捷徑。共用 Agent 不等於共用資料：每個人以自己符合的規則查詢。</p>
    {d.rules.map((r,i)=><div className="lv-db-card open" key={i}><div className="lv-db-card-body">
      <div className="lv-db-rule-head"><span className="lv-db-n">{i+1}</span>
        <select aria-label="群組" value={r.group_id} onChange={e=>up(i,{group_id:e.target.value})}><option value="">選擇群組…</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}（{(g.member_emails||[]).length} 人）</option>)}</select>
        {!bq&&<select aria-label="使用的帳號" value={r.source_id} onChange={e=>up(i,{source_id:e.target.value})}><option value="">選擇資料庫帳號…</option>{d.sources.map(s=><option key={s.id} value={s.id}>{s.label||s.id}</option>)}</select>}
        <span className="grow"/>
        <button className="icon-btn" aria-label="上移" disabled={i===0} onClick={()=>set({rules:move(d.rules,i,-1)})}><ArrowUp size={15}/></button>
        <button className="icon-btn" aria-label="下移" disabled={i===d.rules.length-1} onClick={()=>set({rules:move(d.rules,i,1)})}><ArrowDown size={15}/></button>
        <button className="icon-btn" aria-label="刪除規則" onClick={()=>set({rules:d.rules.filter((_,k)=>k!==i)})}><Trash size={15}/></button></div>
      <div className="lv-db-pick"><span>預先定義查詢</span>{d.queries.length?d.queries.map(q=><label key={q.id} className="lv-db-chip"><input type="checkbox" checked={r.queries.includes(q.id)} onChange={()=>up(i,{queries:toggle(r.queries,q.id)})}/>{q.name||q.id}</label>):<em>尚未建立</em>}</div>
      <div className="lv-db-pick"><span>可查詢的檢視表</span>{d.views.length?d.views.map(v=><label key={v.id} className="lv-db-chip"><input type="checkbox" checked={r.views.includes(v.id)} onChange={()=>up(i,{views:toggle(r.views,v.id)})}/>{v.name||v.id}</label>):<em>尚未建立</em>}</div>
    </div></div>)}
    <button className="btn sm" onClick={()=>set({rules:[...d.rules,{group_id:'',source_id:'',queries:[],views:[]}]})}><Plus size={12}/>新增規則</button>
    <div className="lv-db-sub" style={{marginTop:18}}>規則測試</div>
    {cid?<><div className="lv-db-row"><input aria-label="測試 email" placeholder="輸入 email，看他會套用哪條規則" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&email&&test()}/><button className="btn sm" disabled={!email} onClick={test}><MagnifyingGlass size={12}/>測試</button></div>
      <p className="lv-db-note" style={{margin:0}}>測試的是<b>已儲存</b>的規則，修改後請先儲存。</p></>:<p className="lv-db-note">儲存後即可測試。</p>}
    {cid&&<><div className="lv-db-sub" style={{marginTop:14}}>SQL 檢查（自然語言查詢的守門）</div>
      <textarea aria-label="測試 SQL" rows={3} spellCheck={false} placeholder="貼上一段 SQL，看這位使用者（上方 email）送出時會不會通過。不會執行。" value={sql} onChange={e=>setSql(e.target.value)}/>
      <div><button className="btn sm" disabled={!email||!sql.trim()} onClick={checkSql}>檢查 SQL</button></div>
      {sres&&(sres.ok?<p className="lv-db-res ok">通過。實際送出的 SQL：<code>{sres.sql}</code></p>:<p className="lv-db-res bad">不通過：{sres.reason}</p>)}</>}
    {err&&<p className="lv-db-res bad">{err}</p>}
    {res&&(res.matched?<p className="lv-db-res ok">{res.email} → 規則 {res.rule+1}{res.source_label?`，帳號「${res.source_label}」`:''}；預先定義查詢 {res.queries.length} 個、檢視表 {res.views.length} 個。</p>:<p className="lv-db-res bad">{res.email} 沒有符合的規則：拒絕存取。</p>)}
  </div>;
}

function Editor({init,groups,onBack,onSaved,onDeleted,notify}){
  const [d,setD]=useState(init),[tab,setTab]=useState('conn'),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  const set=p=>setD(x=>({...x,...p}));
  const cid=d.id;
  const payload=()=>({name:d.name,kind:d.kind,description:d.description,connection:d.connection,max_rows:d.max_rows,
    sources:d.sources.map(({id,label,user,password})=>({id,label,user,...(password?{password}:{})})),
    queries:d.queries.map(({id,name,description,statement,parameters})=>({id,name,description,statement,parameters})),
    views:d.views.map(({id,name,description,columns,examples})=>({id,name,description,columns,examples:examples||[]})),
    rules:d.rules.map(({group_id,source_id,queries,views})=>({group_id,source_id:d.kind==='bigquery'?'':source_id,queries,views}))});
  const save=async()=>{
    setBusy(true);setErr('');
    try{const out=cid?await api.updateDbConnector(cid,payload()):await api.createDbConnector(payload());
      setD(fromServer(out));onSaved(out);notify('已儲存');
    }catch(e){setErr(nice(errText(e)))}finally{setBusy(false)}
  };
  const remove=async()=>{if(!window.confirm(`刪除「${d.name}」？已儲存的密碼也會一併刪除。`))return;try{await api.deleteDbConnector(cid);onDeleted(cid)}catch(e){setErr(errText(e))}};
  return <div className="lv-db-editor">
    <button className="lv-p-back" onClick={onBack}><ArrowLeft size={14}/>返回資料庫連接器</button>
    <div className="lv-db-title"><Database size={20}/><h2>{d.name||'新的資料庫連接器'}</h2><span className="badge">{DB_KINDS[d.kind].label}</span></div>
    <div className="lv-db-tabs" role="tablist">{TABS.map(([k,l])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'on':''} onClick={()=>setTab(k)}>{l}{k==='src'&&d.kind!=='bigquery'?` ${d.sources.length}`:k==='q'?` ${d.queries.length}`:k==='v'?` ${d.views.length}`:k==='rules'?` ${d.rules.length}`:''}</button>)}</div>
    <div className="lv-db-body">
      {tab==='conn'&&<Conn d={d} set={set}/>}{tab==='src'&&<Sources d={d} set={set}/>}{tab==='q'&&<Queries d={d} set={set}/>}
      {tab==='v'&&<Views d={d} set={set}/>}{tab==='rules'&&<Rules d={d} set={set} groups={groups} cid={cid}/>}
    </div>
    {err&&<Banner icon={<Warning size={16}/>}><span style={{whiteSpace:'pre-line'}}>{err}</span></Banner>}
    <div className="lv-p-sticky">{cid&&<button className="btn danger" disabled={busy} onClick={remove}><Trash size={14}/>刪除</button>}<span className="grow"/>
      <button className="btn primary" disabled={busy} onClick={save}>{busy?'儲存中…':'儲存設定'}</button></div>
  </div>;
}

const fromServer=c=>({...c,sources:(c.sources||[]).map(s=>({...s,password:''})),connection:c.connection||{},queries:c.queries||[],views:c.views||[],rules:c.rules||[]});

/* The catalogue: one card per database product. `kinds` = the connector kinds a click can create (Cloud SQL asks which flavour). */
const CATALOG=[
  {id:'postgres',name:'PostgreSQL',sub:'自建或雲端的 PostgreSQL',icon:postgresIcon,kinds:['postgres'],common:true},
  {id:'mysql',name:'MySQL',sub:'自建或雲端的 MySQL',icon:mysqlIcon,kinds:['mysql'],common:true},
  {id:'mssql',name:'SQL Server',sub:'Microsoft SQL Server',kinds:['mssql'],common:true},
  {id:'bigquery',name:'Google BigQuery',sub:'以使用者自己的 Google 身分查詢',service:'google_bigquery',kinds:['bigquery'],common:true},
  {id:'cloudsql',name:'Google Cloud SQL',sub:'PostgreSQL · MySQL · SQL Server',icon:cloudIcon,kinds:['cloud_sql_postgres','cloud_sql_mysql','cloud_sql_mssql'],common:true},
  {id:'oracle',name:'Oracle',sub:'院內 HIS 常見',icon:oracleIcon,soon:true},
  {id:'mariadb',name:'MariaDB',sub:'',icon:mariaIcon,soon:true},
  {id:'snowflake',name:'Snowflake',sub:'',icon:snowflakeIcon,soon:true},
];
const Logo=({c,size=40})=><span className="lv-gc-ico" style={{width:size,height:size}}>{c.service?<ProviderIcon service={c.service} name={c.name} size={size}/>:c.icon?<Icon icon={c.icon} width={size*0.6} height={size*0.6}/>:<Database size={size*0.55} color="#0b6bcb"/>}</span>;

export default function DatabaseTab({notify,mode,q,setEditing}){
  const [list,setList]=useState(null),[groups,setGroups]=useState([]),[edit,setEdit]=useState(null),[flavor,setFlavor]=useState(null),[creating,setCreating]=useState(null),[denied,setDenied]=useState('');
  useOnce(()=>{
    api.listDbConnectors().then(setList).catch(e=>{const m=errText(e);setList([]);if(m.startsWith('403'))setDenied(m);else notify('無法載入資料庫連接器：'+m)});
    api.listGroups().then(g=>setGroups(g||[])).catch(()=>{});
  });
  useEffect(()=>{setEditing?.(!!edit);return()=>setEditing?.(false)},[edit]);// eslint-disable-line react-hooks/exhaustive-deps
  const gname=useMemo(()=>Object.fromEntries(groups.map(g=>[g.id,g.name])),[groups]);
  const s=(q||'').trim().toLowerCase();
  if(list===null)return <Loading/>;
  if(edit)return <Editor key={edit.id||'new'} init={edit} groups={groups} notify={notify} onBack={()=>setEdit(null)}
    onSaved={c=>setList(a=>a.some(x=>x.id===c.id)?a.map(x=>x.id===c.id?c:x):[c,...a])} onDeleted={id=>{setList(a=>a.filter(x=>x.id!==id));setEdit(null)}}/>;
  if(denied)return <Banner icon={<Warning size={16}/>}>只有管理員可以管理資料庫連接器。</Banner>;
  const made=c=>c.kinds?.length?list.filter(x=>c.kinds.includes(x.kind)).length:0;
  const start=c=>{if(c.soon)return;c.kinds.length>1?setFlavor(c):setCreating(c.kinds[0])};
  const cat=CATALOG.filter(c=>(mode==='all'||c.common)&&(!s||(c.name+c.sub).toLowerCase().includes(s)));
  const mine=list.filter(c=>!s||(c.name+(c.description||'')+(DB_KINDS[c.kind]?.label||'')).toLowerCase().includes(s));
  return <div className="lv-db">
    <ApplyBar notify={notify} onDeployed={()=>api.listDbConnectors().then(setList).catch(()=>{})} reloadKey={list.map(c=>c.id+(c.updated_at?.seconds||c.updated_at||'')).join()}/>
    {mode==='mine'?(mine.length?<div className="lv-p-cards">{mine.map(c=><div className="lv-p-card" key={c.id}>
      <div className="lv-p-card-head"><span className="connector-icon"><Database size={24}/></span><div style={{minWidth:0}}><h3>{c.name}</h3><span className="lv-p-meta">{DB_KINDS[c.kind]?.label||c.kind}</span></div></div>
      <p>{c.description||'（無說明）'}</p>
      <p className="lv-p-meta">{c.queries.length} 個查詢 · {c.views.length} 個檢視表 · {c.rules.length} 條規則{c.rules.length?`（${[...new Set(c.rules.map(r=>gname[r.group_id]||r.group_id))].slice(0,3).join('、')}）`:''}</p>
      <div className="lv-p-card-foot"><span className="lv-p-status"><i/>{c.status==='applied'?'已套用':'草稿（尚未套用）'}</span><button className="btn sm" onClick={()=>setEdit(fromServer(c))}>設定</button></div>
    </div>)}</div>:<div className="lt"><Empty text={list.length?'沒有符合的連線':'尚未建立資料庫連線。到「常用連接器」選一種資料庫開始。'}/></div>)
    :<>
      <p className="lv-db-note">選一種資料庫來建立連線。只有管理員能建立連線、查詢與存取規則；使用者依自己所屬群組取得資料。</p>
      {cat.length?<div className="lv-gc-grid lv-db-grid4">{cat.map(c=><button key={c.id} type="button" className={'lv-gc-card lv-db-opt'+(c.soon?' soon':'')} disabled={c.soon} onClick={()=>start(c)}>
        <div className="lv-gc-head"><Logo c={c}/><div><h3>{c.name}</h3>{c.sub&&<span className="lv-p-meta">{c.sub}</span>}</div></div>
        <div className="lv-gc-foot">{c.soon?<span className="lv-gc-tag">尚未提供</span>:<span className="lv-p-meta">{made(c)?`已建立 ${made(c)} 個`:'尚未建立'}</span>}{!c.soon&&<span className="lv-db-add"><Plus size={12}/>建立</span>}</div>
      </button>)}</div>:<div className="lt"><Empty text="沒有符合的資料庫"/></div>}
    </>}
    {creating&&<CreateDialog kind={creating} onClose={()=>setCreating(null)} onCreated={c=>{setCreating(null);setList(a=>[c,...a]);notify('已建立資料來源。接著設定查詢與存取規則。');setEdit(fromServer(c))}}/>}
    {flavor&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setFlavor(null)}}><section className="modal" role="dialog" aria-modal="true" aria-label="選擇 Cloud SQL 類型"><h2>Cloud SQL 使用哪種資料庫？</h2>
      <div className="lv-db-kinds">{flavor.kinds.map(k=><button key={k} className="btn" onClick={()=>{setFlavor(null);setCreating(k)}}><Database size={14}/>{DB_KINDS[k].label.replace('Cloud SQL · ','')}</button>)}</div>
      <div className="modal-actions"><button className="btn" onClick={()=>setFlavor(null)}>取消</button></div></section></div>}
  </div>;
}

/* What the signed-in user may use (their own group's rule), without any SQL or sensitive column. */
export function MyDb({q}){
  const [list,setList]=useState(null),[err,setErr]=useState('');
  useOnce(()=>{api.myDbConnectors().then(setList).catch(e=>{setErr(errText(e));setList([])})});
  if(list===null)return <Loading/>;
  const s=(q||'').trim().toLowerCase(),rows=list.filter(c=>!s||(c.name+(c.description||'')+(DB_KINDS[c.kind]?.label||'')).toLowerCase().includes(s));
  return <div className="lv-db">
    <p className="lv-db-note">這些是你所屬群組被授權使用的資料庫。Agent 與流程以你的身分、依你符合的規則查詢；你看不到 SQL，敏感欄位也不會提供。</p>
    {err&&<Banner icon={<Warning size={16}/>}>{err}</Banner>}
    {rows.length?<div className="lv-p-cards">{rows.map(c=><div className="lv-p-card" key={c.id}>
      <div className="lv-p-card-head"><span className="connector-icon"><Database size={24}/></span><div style={{minWidth:0}}><h3>{c.name}</h3><span className="lv-p-meta">{DB_KINDS[c.kind]?.label||c.kind}</span></div></div>
      <p>{c.description||'（無說明）'}</p>
      {c.queries.length>0&&<div><div className="lv-p-meta">可用的查詢</div><div className="lv-p-chips">{c.queries.map(x=><span key={x.id} className="badge" title={x.description}>{x.name}</span>)}</div></div>}
      {c.views.length>0&&<div><div className="lv-p-meta">可查詢的資料</div><div className="lv-p-chips">{c.views.map(v=><span key={v.id} className="badge" title={v.columns.map(x=>x.name).join('、')}>{v.name}（{v.columns.length} 欄）</span>)}</div></div>}
      {!c.queries.length&&!c.views.length&&<p className="lv-p-meta">此規則尚未開放任何查詢。</p>}
    </div>)}</div>:<div className="lt"><Empty text={list.length?'沒有符合的資料庫':'目前沒有授權給你的資料庫。需要使用時，請管理員將你加入有權限的群組。'}/></div>}
  </div>;
}
