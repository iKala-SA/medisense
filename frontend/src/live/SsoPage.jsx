import React,{useEffect,useState} from 'react';
import {ArrowClockwise,CheckCircle,Copy,GoogleLogo,IdentificationCard,Key,Plugs,Trash,WarningCircle,WindowsLogo,X} from '@phosphor-icons/react';
import {api} from '../api';
import {Toggle} from '../ListKit';
import {errText} from './pkit';
import './ops.css';
import './sso.css';

/* 登入與 SSO (admin). Three sign-in methods, one card each:
   Google Workspace = Firebase's own Google sign-in (allowed domains, hd hint).
   Microsoft Entra ID and LDAP / AD = through Keycloak (open source), which Identity Platform trusts as one OIDC provider.
   Secrets (Entra client secret, LDAP bind password) go straight to Keycloak; the API never returns them, so the fields
   stay empty and "留空則不變" keeps the stored value. */

const ENTRA0={enabled:true,tenant_id:'',client_id:'',client_secret:'',display_name:'Microsoft'};
const LDAP0={enabled:true,vendor:'ad',connection_url:'',start_tls:false,bind_dn:'',bind_password:'',users_dn:'',username_attr:'',email_attr:'mail',user_filter:'',display_name:'院內帳號'};
const pick=(src,keys)=>Object.fromEntries(Object.keys(keys).map(k=>[k,src?.[k]??keys[k]]));
const detail=e=>errText(e).replace(/^\d{3}\s/,'');

function Status({ok,children}){return <span className={'sso-chip '+(ok?'ok':'off')}>{ok?<CheckCircle weight="fill"/>:<WarningCircle weight="fill"/>}{children}</span>}

function Field({label,hint,children,wide}){
  return <label className={'sso-field'+(wide?' wide':'')}><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;
}

function Card({icon,tone,title,sub,status,on,onToggle,disabled,children,actions}){
  return <section className={'sso-card '+(on?'':'is-off')}>
    <header><span className={'sso-ic '+tone}>{icon}</span><div className="sso-title"><h2>{title}</h2><p>{sub}</p></div>{status}<Toggle on={on} onChange={onToggle} label={`啟用${title}`} disabled={disabled}/></header>
    <div className="sso-body">{children}</div>
    {actions&&<footer>{actions}</footer>}
  </section>;
}

function GoogleCard({data,notify,reload}){
  const [f,setF]=useState(()=>({enabled:data.enabled,allowed_domains:data.allowed_domains||[],hd:data.hd||''})),[add,setAdd]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  const envDomains=data.env_domains||[];
  const push=()=>{const d=add.trim().toLowerCase().replace(/^@/,'');if(!d)return;if(!f.allowed_domains.includes(d)&&!envDomains.includes(d))setF({...f,allowed_domains:[...f.allowed_domains,d]});setAdd('')};
  const save=async()=>{setBusy(true);setErr('');try{await api.saveSsoGoogle(f);notify('已儲存 Google Workspace 設定');reload()}catch(e){setErr(detail(e))}finally{setBusy(false)}};
  const none=!envDomains.length&&!f.allowed_domains.length;
  return <Card icon={<GoogleLogo weight="bold"/>} tone="google" title="Google Workspace" sub="Firebase 原生 Google 登入，現有帳號不受影響"
    status={<Status ok={f.enabled}>{f.enabled?'使用中':'已關閉'}</Status>} on={f.enabled} onToggle={v=>setF({...f,enabled:v})}
    actions={<><span className="sso-foot-note">{f.enabled?'':'關閉後只剩下方的登入方式；環境設定的管理員仍可用 Google 登入。'}</span><button className="btn primary" disabled={busy} onClick={save}>{busy?'儲存中…':'儲存'}</button></>}>
    <Field label="允許登入的網域" wide hint={none?'目前未限制網域：任何已驗證 email 都能登入。建議至少加入醫院網域。':'這些網域的 email 才能登入（所有登入方式都適用）。'}>
      <div className="sso-tags">
        {envDomains.map(d=><span key={d} className="sso-tag locked" title="部署環境變數 ALLOWED_DOMAINS，無法在此移除">{d}<small>部署設定</small></span>)}
        {f.allowed_domains.map(d=><span key={d} className="sso-tag">{d}<button type="button" aria-label={`移除 ${d}`} onClick={()=>setF({...f,allowed_domains:f.allowed_domains.filter(x=>x!==d)})}><X/></button></span>)}
        <input value={add} placeholder="輸入網域後按 Enter，例如 hospital.org.tw" onChange={e=>setAdd(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();push()}}} onBlur={push}/>
      </div>
    </Field>
    <Field label="Google 帳號選擇提示（hd）" hint="登入視窗預先選擇這個 Workspace 網域；只是提示，真正的檢查在上方網域清單。">
      <input value={f.hd} placeholder="例如 hospital.org.tw" onChange={e=>setF({...f,hd:e.target.value})}/>
    </Field>
    {err&&<p className="sso-err" role="alert">{err}</p>}
  </Card>;
}

function Copyable({label,value,notify}){
  return <div className="sso-copy"><span>{label}</span><code>{value}</code><button type="button" className="icon-btn" aria-label={`複製${label}`} onClick={()=>{navigator.clipboard?.writeText(value);notify('已複製')}}><Copy/></button></div>;
}

function NeedKeycloak({kc}){
  if(kc.configured&&kc.ok)return null;
  return <div className="sso-banner"><WarningCircle weight="fill"/><div><b>{kc.configured?'無法連到 Keycloak':'尚未部署 Keycloak'}</b><p>{kc.configured?kc.error:'Microsoft Entra ID 與 LDAP 透過開源身分代理 Keycloak 登入。請先執行 backend/infra/15-keycloak.sh，並在後端設定 KEYCLOAK_URL 與 KEYCLOAK_CLIENT_SECRET。'}</p></div></div>;
}

function EntraCard({data,kc,notify,reload}){
  const [f,setF]=useState(()=>({...pick(data,ENTRA0),client_secret:'',enabled:data.in_keycloak?data.enabled:true})),[busy,setBusy]=useState(''),[err,setErr]=useState('');
  const ready=kc.configured&&kc.ok,exists=data.in_keycloak;
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const save=async()=>{setBusy('save');setErr('');try{await api.saveSsoEntra(f);notify('已儲存 Microsoft Entra ID 設定');reload()}catch(e){setErr(detail(e))}finally{setBusy('')}};
  const remove=async()=>{if(!window.confirm('移除 Microsoft Entra ID 登入？已用這個方式登入的人將無法再登入，帳號與資料保留。'))return;setBusy('del');setErr('');try{await api.deleteSsoEntra();notify('已移除 Microsoft Entra ID');reload()}catch(e){setErr(detail(e))}finally{setBusy('')}};
  return <Card icon={<WindowsLogo weight="bold"/>} tone="entra" title="Microsoft Entra ID" sub="Microsoft 365 / Azure AD 帳號登入（經 Keycloak）"
    status={<Status ok={exists&&data.enabled}>{!exists?'未設定':data.enabled?'使用中':'已停用'}</Status>} on={f.enabled} onToggle={v=>set('enabled',v)} disabled={!ready}
    actions={<>{exists&&<button className="btn sso-danger" disabled={!!busy||!ready} onClick={remove}><Trash/>移除</button>}<span className="sso-foot-note"/><button className="btn primary" disabled={!!busy||!ready||!f.tenant_id||!f.client_id||(!exists&&!f.client_secret)} onClick={save}>{busy==='save'?'儲存中…':exists?'儲存':'建立並啟用'}</button></>}>
    <NeedKeycloak kc={kc}/>
    {data.redirect_uri&&<Copyable label="重新導向 URI（貼到 Azure 應用程式註冊）" value={data.redirect_uri} notify={notify}/>}
    <div className="sso-grid">
      <Field label="目錄（租用戶）識別碼" hint="Azure 入口網站 → 應用程式註冊 → 概觀"><input value={f.tenant_id} disabled={!ready} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={e=>set('tenant_id',e.target.value.trim())}/></Field>
      <Field label="應用程式（用戶端）識別碼"><input value={f.client_id} disabled={!ready} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" onChange={e=>set('client_id',e.target.value.trim())}/></Field>
      <Field label="用戶端密碼（值）" hint={exists?'已儲存在 Keycloak。留空則不變。':'憑證與祕密 → 新增用戶端密碼，複製「值」。只存在 Keycloak。'}><input type="password" autoComplete="new-password" value={f.client_secret} disabled={!ready} placeholder={exists?'••••••••（留空則不變）':''} onChange={e=>set('client_secret',e.target.value)}/></Field>
      <Field label="登入按鈕名稱"><input value={f.display_name} maxLength={40} disabled={!ready} onChange={e=>set('display_name',e.target.value)}/></Field>
    </div>
    <details className="sso-steps"><summary>Azure 設定步驟</summary><ol>
      <li>Microsoft Entra 系統管理中心 → 應用程式註冊 → 新增註冊；帳戶類型選「僅此組織目錄中的帳戶」。</li>
      <li>重新導向 URI 選「Web」，貼上上方的網址。</li>
      <li>憑證與祕密 → 新增用戶端密碼，把「值」貼到這裡（到期前記得更新）。</li>
      <li>權杖設定 → 新增選用宣告 → ID → 勾選 email（Medisense 用 email 對應帳號）。</li>
      <li>API 權限保留 Microsoft Graph 的 openid、profile、email 即可，按「代表組織授與管理員同意」。</li>
    </ol></details>
    {err&&<p className="sso-err" role="alert">{err}</p>}
  </Card>;
}

function LdapCard({data,kc,notify,reload}){
  const [f,setF]=useState(()=>({...pick(data,LDAP0),bind_password:'',enabled:data.in_keycloak?data.enabled:true})),[busy,setBusy]=useState(''),[err,setErr]=useState(''),[test,setTest]=useState(null);
  const ready=kc.configured&&kc.ok,exists=data.in_keycloak;
  const set=(k,v)=>{setF(x=>({...x,[k]:v}));setTest(null)};
  const run=async action=>{setBusy(action);setErr('');setTest(null);try{setTest({action,...await api.testSsoLdap({action,connection_url:f.connection_url,start_tls:f.start_tls,bind_dn:f.bind_dn,bind_password:f.bind_password})})}catch(e){setErr(detail(e))}finally{setBusy('')}};
  const save=async()=>{setBusy('save');setErr('');try{await api.saveSsoLdap(f);notify('已儲存 LDAP 設定');reload()}catch(e){setErr(detail(e))}finally{setBusy('')}};
  const remove=async()=>{if(!window.confirm('移除 LDAP 登入？用院內帳號登入的人將無法再登入，帳號與資料保留。'))return;setBusy('del');setErr('');try{await api.deleteSsoLdap();notify('已移除 LDAP');reload()}catch(e){setErr(detail(e))}finally{setBusy('')}};
  const ad=f.vendor==='ad';
  const canSave=ready&&f.connection_url&&f.bind_dn&&f.users_dn&&(exists||f.bind_password);
  return <Card icon={<IdentificationCard weight="bold"/>} tone="ldap" title="LDAP / Active Directory" sub="院內目錄帳號密碼登入（唯讀同步，經 Keycloak）"
    status={<Status ok={exists&&data.enabled}>{!exists?'未設定':data.enabled?'使用中':'已停用'}</Status>} on={f.enabled} onToggle={v=>set('enabled',v)} disabled={!ready}
    actions={<>{exists&&<button className="btn sso-danger" disabled={!!busy||!ready} onClick={remove}><Trash/>移除</button>}<span className="sso-foot-note"/>
      <button className="btn" disabled={!!busy||!ready||!f.connection_url} onClick={()=>run('connection')}><Plugs/>{busy==='connection'?'測試中…':'測試連線'}</button>
      <button className="btn" disabled={!!busy||!ready||!f.connection_url||!f.bind_dn||(!exists&&!f.bind_password)} onClick={()=>run('auth')}><Key/>{busy==='auth'?'測試中…':'測試 Bind 帳號'}</button>
      <button className="btn primary" disabled={!!busy||!canSave} onClick={save}>{busy==='save'?'儲存中…':exists?'儲存':'建立並啟用'}</button></>}>
    <NeedKeycloak kc={kc}/>
    <div className="sso-seg" role="radiogroup" aria-label="目錄類型">{[['ad','Active Directory'],['other','OpenLDAP / 其他']].map(([v,l])=><button key={v} type="button" role="radio" aria-checked={f.vendor===v} className={f.vendor===v?'on':''} disabled={!ready} onClick={()=>set('vendor',v)}>{l}</button>)}</div>
    <div className="sso-grid">
      <Field label="連線網址" wide hint="建議使用 ldaps://（636）。Keycloak 需能從 Cloud Run 連到這台主機（VPN / Interconnect 或公開位址）。"><input value={f.connection_url} disabled={!ready} placeholder={ad?'ldaps://dc01.hospital.local:636':'ldaps://ldap.hospital.local:636'} onChange={e=>set('connection_url',e.target.value.trim())}/></Field>
      <Field label="Bind DN（唯讀服務帳號）"><input value={f.bind_dn} disabled={!ready} placeholder={ad?'CN=svc-medisense,OU=Service,DC=hospital,DC=local':'cn=medisense,ou=services,dc=hospital,dc=local'} onChange={e=>set('bind_dn',e.target.value)}/></Field>
      <Field label="Bind 密碼" hint={exists?'已儲存在 Keycloak。留空則不變。':'只存在 Keycloak。'}><input type="password" autoComplete="new-password" value={f.bind_password} disabled={!ready} placeholder={exists?'••••••••（留空則不變）':''} onChange={e=>set('bind_password',e.target.value)}/></Field>
      <Field label="使用者所在 DN" wide><input value={f.users_dn} disabled={!ready} placeholder={ad?'OU=Staff,DC=hospital,DC=local':'ou=people,dc=hospital,dc=local'} onChange={e=>set('users_dn',e.target.value)}/></Field>
      <Field label="帳號屬性" hint={`留空 = ${ad?'sAMAccountName':'uid'}`}><input value={f.username_attr} disabled={!ready} placeholder={ad?'sAMAccountName':'uid'} onChange={e=>set('username_attr',e.target.value.trim())}/></Field>
      <Field label="Email 屬性" hint="必須有值且屬於允許網域，才能登入 Medisense"><input value={f.email_attr} disabled={!ready} placeholder="mail" onChange={e=>set('email_attr',e.target.value.trim())}/></Field>
      <Field label="限定使用者（LDAP 篩選，選填）" wide hint="例如只讓某個 AD 群組的人登入"><input value={f.user_filter} disabled={!ready} placeholder="(memberOf=CN=Medisense Users,OU=Groups,DC=hospital,DC=local)" onChange={e=>set('user_filter',e.target.value)}/></Field>
      <Field label="登入按鈕名稱"><input value={f.display_name} maxLength={40} disabled={!ready} onChange={e=>set('display_name',e.target.value)}/></Field>
      <label className="sso-check"><input type="checkbox" checked={f.start_tls} disabled={!ready} onChange={e=>set('start_tls',e.target.checked)}/>使用 StartTLS（ldap:// 時）</label>
    </div>
    {test&&<p className={'sso-test '+(test.ok?'ok':'bad')} role="status">{test.ok?<CheckCircle weight="fill"/>:<WarningCircle weight="fill"/>}{test.message}</p>}
    {err&&<p className="sso-err" role="alert">{err}</p>}
  </Card>;
}

export default function SsoPage({notify}){
  const [d,setD]=useState(null),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[gen,setGen]=useState(0);
  const load=async()=>{setBusy(true);setErr('');try{setD(await api.sso());setGen(g=>g+1)}catch(e){setErr(detail(e))}finally{setBusy(false)}};
  useEffect(()=>{load()},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const kc=d?.keycloak||{},ip=d?.identity_platform||{};
  return <div className="lv-o sso-page">
    <div className="page-heading"><h1><Key/>登入與 SSO</h1><div className="lv-actions"><button className="btn" onClick={load} disabled={busy}><ArrowClockwise className={busy?'lv-spin':''}/>重新整理</button></div></div>
    {err&&<p className="sso-err" role="alert">{err}</p>}
    {!d&&!err&&<p className="muted">載入中…</p>}
    {d&&<>
      <div className="sso-health">
        <Status ok={kc.configured&&kc.ok}>Keycloak {kc.configured?(kc.ok?'已連線':'無法連線'):'未部署'}</Status>
        <Status ok={ip.ok}>Identity Platform 信任 {ip.provider_id||'oidc.medisense-sso'}{ip.ok?'':'：未建立'}</Status>
        {d.updated_by&&<span className="sso-meta">最後修改：{d.updated_by}</span>}
      </div>
      <div className="sso-cards" key={gen}>
        <GoogleCard data={d.google} notify={notify} reload={load}/>
        <EntraCard data={d.entra} kc={kc} notify={notify} reload={load}/>
        <LdapCard data={d.ldap} kc={kc} notify={notify} reload={load}/>
      </div>
      <p className="sso-foot">同一個 email 先後用兩種方式登入時，第二次會請對方用原本的方式登入一次並「連結」，帳號、對話與檔案維持同一份。關閉某個登入方式不會刪除任何帳號。</p>
    </>}
  </div>;
}
