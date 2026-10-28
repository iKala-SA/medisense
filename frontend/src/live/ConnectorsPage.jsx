import React,{useEffect,useMemo,useState} from 'react';
import {MagnifyingGlass,Plugs,Plus,CaretRight,ArrowLeft,Lock,Eye,EyeSlash,Trash,Play,ShieldCheck,Lightning,ChatCircleDots,UsersThree,Notebook,EnvelopeSimple,CalendarBlank,HardDrives,House,Image,ListChecks,Warning,Info} from '@phosphor-icons/react';
import {Icon} from '@iconify/react';
import gmailIcon from '@iconify-icons/logos/google-gmail';
import calendarIcon from '@iconify-icons/logos/google-calendar';
import driveIcon from '@iconify-icons/logos/google-drive';
import teamsIcon from '@iconify-icons/logos/microsoft-teams';
import slackIcon from '@iconify-icons/logos/slack-icon';
import notionIcon from '@iconify-icons/logos/notion-icon';
import {api} from '../api';
import {ListToolbar,Empty,Field} from '../ListKit';
import {errText,isBuilder,isAdmin,fmtTime,useOnce,Loading,Banner} from './pkit';
import {ShareChip,ShareDialog} from './ShareLive';
import {connectAccount,connectErr} from './connectFlow';
import GatewayCatalog from './GatewayCatalog';
import EnableService from './EnableService';
import ProviderIcon from './ProviderIcon';
import './pages.css';
import './gatewaycatalog.css';

const ICONS={mcp:Plugs,webhook:Lightning,slack:ChatCircleDots,teams:UsersThree,notion:Notebook,gmail:EnvelopeSimple,calendar:CalendarBlank,drive:HardDrives,his_fhir:House,pacs:Image};
// Official brand logos where one exists; generic icons for protocol-level connectors.
const BRAND={gmail:gmailIcon,calendar:calendarIcon,drive:driveIcon,teams:teamsIcon,slack:slackIcon,notion:notionIcon};
export const SHORT={mcp:'MCP',webhook:'Webhook',slack:'Slack',teams:'Teams',notion:'Notion',gmail:'Gmail',calendar:'Google Calendar',drive:'Google Drive',his_fhir:'HIS',pacs:'PACS'};
export const shortName=t=>SHORT[t.id]||t.label;
const TypeIcon=({id,size=24})=>{if(BRAND[id])return <Icon icon={BRAND[id]} width={size} height={size}/>;const I=ICONS[id]||Plugs;return <I size={size}/>};

const STATUS={active:['ok','已連線（測試通過）'],error:['err','連線失敗'],unverified:['','尚未驗證']};
export const StatusPill=({status})=>{const [c,t]=STATUS[status]||STATUS.unverified;return <span className={'lv-p-status '+c}><i/>{t}</span>};
const isOauth=t=>t?.auth==='user_oauth';
const canEdit=(me,c,t)=>!!me&&(c.type==='gateway'?me.role==='admin':true)&&(me.role==='admin'||(c.owner_uid===me.uid&&!isOauth(t)));
const PERM_TITLE={allowed_actions:'管理讀取許可',write_actions:'管理寫入許可（尚未開放）'};
const MY_STATE={connected:['ok','已連線'],not_connected:['','未連線'],reauth_required:['warn','需重新授權'],unavailable:['err','暫時無法使用'],shared:['ok','可使用（管理員共用）']};
const myChip=c=>c.state==='unavailable'?MY_STATE.unavailable:(c.state==='shared'||(c.mode==='none'&&c.state!=='connected'))?(c.mode==='none'?['ok','無需授權']:MY_STATE.shared):MY_STATE[c.state]||['','狀態未知'];
// 常用連接器: custom MCP servers plus the Open Connector services of Google, Microsoft and Slack.
const MCP_TYPES=new Set(['mcp']);
const COMMON_GROUPS=[
  {title:'Google',services:['gmail','googlecalendar','googledrive','googledocs','googlesheets','googleslides','googleforms','googlemeet','googlechat','googletasks']},
  {title:'Microsoft',services:['outlook','outlook_calendar','one_drive','excel','microsoft_teams','microsoft_todo']},
  {title:'Slack',services:['slack']}];
const GW_TYPE={id:'gateway',label:'Open Connector',protocol:'Open Connector 閘道',available:true,description:'',auth:null};
const gwType=c=>({...GW_TYPE,label:c.label,description:c.config?.description||'',protocol:'Open Connector · '+(c.config?.service||'')});
const AUTH_SHORT={oauth2:'每位使用者各自授權',api_key:'共用 API Key',custom_credential:'共用憑證',no_auth:'無需授權'};

/* 我的連線: per-user OAuth connectors shared with the caller; every role sees this. */
function MyConnections({notify,onChanged,reloadKey,query=''}){
  const [items,setItems]=useState(null),[busy,setBusy]=useState('');
  const load=async()=>{try{setItems(await api.myConnectors()||[])}catch(e){setItems([]);notify('無法載入我的連線：'+connectErr(e))}};
  useEffect(()=>{load()},[reloadKey]);// eslint-disable-line
  const connect=async c=>{
    setBusy(c.id);
    try{const r=await connectAccount(c.id,notify);if(r){await load();onChanged?.()}}finally{setBusy('')}
  };
  const disconnect=async c=>{
    if(!window.confirm(`中斷「${c.label}」的連線？將撤銷 Medisense 對 ${c.account_label||'您的帳號'} 的存取授權。`))return;
    setBusy(c.id);
    try{await api.disconnectMine(c.id);notify('已中斷連線');await load();onChanged?.()}catch(e){notify('中斷失敗：'+connectErr(e))}finally{setBusy('')}
  };
  const nq=query.trim().toLowerCase(),shown=(items||[]).filter(c=>!nq||(c.label+(c.service||'')+(c.description||'')).toLowerCase().includes(nq));
  return <section className="lv-mc">
    <p>授權後，Medisense 只會以您自己的帳號讀取資料；其他人看不到您的內容，您可隨時中斷連線。</p>
    {items===null?<Loading/>:shown.length?<div className="lv-p-cards">{shown.map(c=>{
      const [cls,txt]=myChip(c),ok=c.state==='connected',working=busy===c.id,actionable=c.mode==='user_oauth'&&(c.state==='not_connected'||c.state==='reauth_required');
      return <div key={c.id} className="lv-p-card">
        <div className="lv-p-card-head">{c.service?<ProviderIcon service={c.service} name={c.label} size={40}/>:<span className="connector-icon"><TypeIcon id={c.type}/></span>}<div style={{minWidth:0}}><h3>{c.label}</h3></div></div>
        {c.description&&<p>{c.description}</p>}
        {c.problem&&c.state!=='connected'&&c.state!=='shared'&&<p style={{color:'#8a5a00'}}>{c.problem}</p>}
        <div className="lv-p-card-foot"><span className={'lv-p-status '+cls}><i/>{txt}{ok&&c.account_label?' · '+c.account_label:''}</span>
          {ok&&c.mode!=='shared'&&c.mode!=='none'?<button className="btn sm" disabled={working} onClick={()=>disconnect(c)}>中斷連線</button>
            :!actionable?null
            :<button className="btn sm primary" disabled={working} onClick={()=>connect(c)}>{working?'等待授權…':c.state==='reauth_required'?'重新授權':'連線我的帳號'}</button>}
        </div></div>})}</div>
      :<div className="lt"><Empty text={items?.length?'沒有符合的連線':'目前沒有分享給您的個人連線。請管理員將行事曆等連接器分享給您。'}/></div>}
  </section>;
}

/* Field renderer generated from the backend field spec. Secret values are write-only: never read back from the server. */
function SpecField({f,cfg,setCfg,secrets,setSecret,stored,disabled}){
  const [show,setShow]=useState(false);
  const secret=f.kind==='secret',has=secret&&stored.includes(f.key);
  const label=<>{f.label}{f.required&&<span style={{color:'#b3261e'}}> *</span>}{secret&&<span className="lv-p-lock"><Lock size={12}/>{has?'已加密保存 · 留空保留':'存於 Secret Manager，儲存後不再顯示'}</span>}</>;
  let input;
  if(f.kind==='select')input=<select disabled={disabled} value={String(cfg[f.key]??f.default??'')} onChange={e=>setCfg(f.key,e.target.value)}>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  else if(f.kind==='textarea')input=<textarea rows={3} disabled={disabled} value={String(cfg[f.key]??'')} placeholder={f.placeholder} onChange={e=>setCfg(f.key,e.target.value)}/>;
  else if(f.kind==='checkboxes'){
    const sel=cfg[f.key]??f.default??[];
    input=<div className="lv-p-checks">{f.options.map(o=><label key={o.value} className={o.disabled?'off':''}><input type="checkbox" disabled={disabled||o.disabled} checked={sel.includes(o.value)} onChange={e=>setCfg(f.key,e.target.checked?[...sel,o.value]:sel.filter(x=>x!==o.value))}/><span>{o.label}</span></label>)}</div>;
  }else if(secret)input=<div className="lv-p-secret"><input type={show?'text':'password'} autoComplete="off" disabled={disabled} value={secrets[f.key]??''} placeholder={has?'••••••••（已保存，輸入新值可覆寫）':f.placeholder} onChange={e=>setSecret(f.key,e.target.value)}/><button type="button" className="icon-btn" aria-label={show?'隱藏':'顯示輸入內容'} onClick={()=>setShow(s=>!s)}>{show?<EyeSlash/>:<Eye/>}</button></div>;
  else input=<input type="text" disabled={disabled} value={String(cfg[f.key]??'')} placeholder={f.placeholder} onChange={e=>setCfg(f.key,e.target.value)}/>;
  return <div className="field"><label>{label}</label>{input}{f.hint&&<span className="lv-p-hint">{f.hint}</span>}</div>;
}

function Setup({me,notify,types,typeId,existing,onBack,onSaved,onDeleted}){
  const spec=types.find(t=>t.id===typeId);
  const isNew=!existing;
  const editable=isNew||canEdit(me,existing,spec);
  const oauth=isOauth(spec);
  const [sharing,setSharing]=useState(false);
  const [form,setForm]=useState(()=>{
    const cfg={};
    if(isNew)for(const f of spec.fields)if(f.kind!=='secret'&&f.default!=null)cfg[f.key]=f.default;
    return existing?{label:existing.label,scope:existing.scope||'',config:existing.config||{},secrets:{},redact_pii:existing.redact_pii,redact_off_reason:'',audit_payloads:existing.audit_payloads}
      :{label:shortName(spec),scope:'',config:cfg,secrets:{},redact_pii:true,redact_off_reason:'',audit_payloads:true};
  });
  const [cur,setCur]=useState(existing);
  const [busy,setBusy]=useState('');
  const [test,setTest]=useState(existing?.last_test||null);
  const [actions,setActions]=useState(null);
  const stored=cur?.secret_fields||[];
  const setCfg=(k,v)=>setForm(x=>({...x,config:{...x.config,[k]:v}}));
  const setSecret=(k,v)=>setForm(x=>({...x,secrets:{...x.secrets,[k]:v}}));
  const dirtySecrets=Object.values(form.secrets).some(Boolean);

  const save=async()=>{
    if(!form.label.trim()){notify('請填寫連接器識別名稱');return null}
    if(!form.redact_pii&&existing?.redact_pii!==false&&!form.redact_off_reason.trim()){notify('關閉去識別化需要填寫原因');return null}
    const missing=spec.fields.filter(f=>f.required&&(f.kind==='secret'?!(form.secrets[f.key]||stored.includes(f.key)):!form.config[f.key]||(Array.isArray(form.config[f.key])&&!form.config[f.key].length)));
    if(missing.length){notify('必填欄位：'+missing.map(f=>f.label).join('、'));return null}
    setBusy('save');
    try{
      const secrets=Object.fromEntries(Object.entries(form.secrets).filter(([,v])=>v));
      const body={type:spec.id,label:form.label.trim(),scope:form.scope,config:form.config,secrets,redact_pii:form.redact_pii,redact_off_reason:form.redact_off_reason,audit_payloads:form.audit_payloads};
      const c=isNew&&!cur?await api.createConnector(body):await api.updateConnector(cur.id,body);
      setCur(c);setForm(x=>({...x,secrets:{}}));notify('連接器已儲存');onSaved(c);return c;
    }catch(e){notify('儲存失敗：'+errText(e));return null}finally{setBusy('')}
  };
  const runTest=async()=>{
    const c=cur&&!dirtySecrets?cur:await save();
    if(!c)return;
    setBusy('test');
    try{const r=await api.testConnector(c.id);setTest(r);setCur(x=>({...x,status:r.ok?'active':'error',last_test:r}));onSaved({...c,status:r.ok?'active':'error',last_test:r})}
    catch(e){notify('測試失敗：'+errText(e))}finally{setBusy('')}
  };
  const loadActions=async()=>{
    setBusy('actions');
    try{setActions(await api.connectorActions(cur.id))}catch(e){notify('無法取得動作清單：'+errText(e))}finally{setBusy('')}
  };
  const remove=async()=>{
    if(!window.confirm(`刪除「${cur.label}」？Secret Manager 中的憑證將一併刪除。`))return;
    setBusy('delete');
    try{await api.deleteConnector(cur.id);notify('已刪除連接器');onDeleted(cur.id)}catch(e){notify('刪除失敗：'+errText(e));setBusy('')}
  };
  const perms=spec.fields.filter(f=>f.section==='permissions');
  const server=spec.fields.filter(f=>f.section==='server'),cred=spec.fields.filter(f=>f.section!=='server'&&f.section!=='permissions');
  const doShare=async share=>{try{const c=await api.shareConnector(cur.id,share);setCur(c);onSaved(c);setSharing(false);notify('分享設定已更新')}catch(e){notify('分享失敗：'+errText(e))}};
  const fp={cfg:form.config,setCfg,secrets:form.secrets,setSecret,stored,disabled:!editable||!!busy};
  return <div className="lv-p-form">
    <button className="lv-p-back" onClick={onBack}><ArrowLeft size={14}/>返回連接器</button>
    <div className="page-heading"><h1><TypeIcon id={spec.id} size={26}/> {form.label||shortName(spec)}</h1>{cur&&<StatusPill status={cur.status}/>}{oauth&&cur&&<ShareChip share={cur.share} disabled={!editable} onClick={()=>setSharing(true)}/>}</div>
    <p className="subtitle">{spec.protocol}</p>
    {!editable&&cur&&<Banner icon={<Warning size={16}/>}>此連接器由 {cur.owner_email} 建立。您可在 Agent 中使用，但只有建立者或管理員可以修改或刪除。</Banner>}
    {oauth?<Banner info icon={<ShieldCheck size={16}/>}>每位使用者各自授權，只看得到自己的日曆。管理員在此設定可用的動作與分享對象，使用者再於「我的連線」授權自己的帳號。{!cur&&'儲存後即可設定分享對象。'}</Banner>:<Banner info icon={<ShieldCheck size={16}/>}>憑證由後端存入 Secret Manager，瀏覽器儲存後不再取回；清單與詳細頁只顯示「已保存」。此頁面未驗證任何外部系統，連線狀態僅以「測試」結果為準。</Banner>}
    <section className="panel"><h2>基本資訊</h2>
      <Field label="連接器識別名稱 *"><input type="text" disabled={!editable||!!busy} value={form.label} onChange={e=>setForm(x=>({...x,label:e.target.value}))}/></Field>
      <Field label="適用情境與範圍"><input type="text" disabled={!editable||!!busy} value={form.scope} placeholder="例如：心導管室異常警報通知" onChange={e=>setForm(x=>({...x,scope:e.target.value}))}/></Field>
      <p className="lv-p-hint" style={{margin:0}}>{spec.description}</p>
    </section>
    {oauth?<>{server.length>0&&<section className="panel"><h2>伺服器與端點</h2>{server.map(f=><SpecField key={f.key} f={f} {...fp}/>)}</section>}
      <section className="panel lv-p-perm"><h2>權限</h2>{perms.map(f=><div key={f.key}><h3>{PERM_TITLE[f.key]||f.label}</h3><SpecField f={{...f,label:''}} {...fp}/></div>)}</section></>
    :<><section className="panel"><h2>伺服器與端點</h2>{server.length?server.map(f=><SpecField key={f.key} f={f} {...fp}/>):<p className="muted small">此類型沒有非機密的端點設定。</p>}</section>
    <section className="panel"><h2>授權憑證</h2>{cred.length?cred.map(f=><SpecField key={f.key} f={f} {...fp}/>):<p className="muted small">此類型不需要憑證。</p>}</section></>}
    <section className="panel"><h2>合規設定</h2>
      {[['redact_pii','送出前去識別化','以 Sensitive Data Protection 取代姓名、病歷號、身分證等識別資訊。'],['audit_payloads','記錄 Payload 至稽核日誌','每次工具呼叫的參數與結果狀態寫入稽核集合。']].map(([k,t,d])=><div className="lv-p-switch-row" key={k}><div><b>{t}</b>{d}</div><input type="checkbox" role="switch" aria-label={t} disabled={!editable||!!busy||(k==='redact_pii'&&me?.role!=='admin'&&form.redact_pii)} checked={form[k]} onChange={e=>{
        const on=e.target.checked;
        if(k==='redact_pii'&&!on&&!window.confirm('關閉後，這個連接器回傳的內容會「原樣」送給模型（可能是雲端模型），其中的病人姓名、病歷號等不會被遮蔽。確定要關閉嗎？'))return;
        setForm(x=>({...x,[k]:on}))}}/></div>)}
      {me?.role!=='admin'&&form.redact_pii&&<p className="lv-p-hint">只有管理員可以關閉去識別化。</p>}
      {!form.redact_pii&&<div className="lv-o-banner bad" style={{marginTop:10}} role="alert"><Warning size={15}/><div><b>去識別化已關閉。</b>此連接器的結果會原樣送給模型，且每次呼叫都在稽核記錄標註「未去識別化」。{existing?.redact_pii===false?'':<><br/>原因（必填，會寫入稽核）：<input style={{width:'100%',marginTop:6}} maxLength={200} value={form.redact_off_reason} onChange={e=>setForm(x=>({...x,redact_off_reason:e.target.value}))} placeholder="例如：此系統只回傳設備狀態，不含任何個資" aria-label="關閉去識別化的原因"/></>}</div></div>}
    </section>
    {test&&<div className={'lv-p-test'+(test.ok?'':' err')}><b>{test.ok?'測試通過':'測試失敗'}</b>：{test.message} <span className="lv-p-meta">{test.ms} ms{test.at?' · '+fmtTime(test.at):''}</span>
      {test.tools?.length>0&&<div className="lv-p-chips">{test.tools.map(t=><span key={t.id} className="badge" title={t.description}>{t.id}</span>)}</div>}</div>}
    {actions&&<section className="panel"><h2>可用動作（{actions.length}）</h2>{actions.length?<div className="lv-p-chips" style={{marginTop:0}}>{actions.map(a=><span key={a.id} className="badge" title={a.description||''}>{a.label||a.id}{a.write?' · 寫入':' · 唯讀'}</span>)}</div>:<p className="muted small">沒有可用動作。MCP 連接器需先測試成功才會列出伺服器工具。</p>}</section>}
    {sharing&&<ShareDialog title={cur.label} value={cur.share} owner={cur.owner_email||'你'} onClose={()=>setSharing(false)} onDone={doShare}/>}
    <div className="lv-p-sticky">
      {cur&&editable&&<button className="btn danger" disabled={!!busy} onClick={remove}><Trash size={14}/>刪除</button>}
      <span className="grow"/>
      {cur&&<button className="btn" disabled={!!busy} onClick={loadActions}><ListChecks size={14}/>{busy==='actions'?'讀取中…':'檢視動作'}</button>}
      {editable&&spec.available&&<button className="btn" disabled={!!busy} onClick={runTest}><Play size={14}/>{busy==='test'?'測試中…':'測試連線'}</button>}
      {editable&&<button className="btn primary" disabled={!!busy} onClick={save}>{busy==='save'?'儲存中…':'儲存設定'}</button>}
    </div>
  </div>;
}

export default function ConnectorsPage({me,notify}){
  const [types,setTypes]=useState(null),[conns,setConns]=useState(null),[denied,setDenied]=useState('');
  const [q,setQ]=useState(''),[tab,setTab]=useState('全部');
  const [view,setView]=useState(null); // {typeId, id?}
  const [wizard,setWizard]=useState(null),[summary,setSummary]=useState(null),[mcKey,setMcKey]=useState(0);
  const [mode,setMode]=useState('mine'),[gwTotal,setGwTotal]=useState(null);
  const builder=isBuilder(me),admin=isAdmin(me),[sharing,setSharing]=useState(null);
  const catalog=builder;

  const load=async()=>{
    if(!catalog){setTypes([]);setConns([]);return}
    try{
      const [t,c]=await Promise.all([api.connectorTypes(),api.listConnectors()]);
      setTypes(t.types||[]);setConns(c||[]);
    }catch(e){
      const m=errText(e);setTypes([]);setConns([]);
      if(m.startsWith('403'))setDenied(m);else notify('無法載入連接器：'+m);
    }
  };
  useOnce(load);
  useOnce(()=>{if(catalog)api.gatewayCatalog({limit:1}).then(r=>setGwTotal(r.gateway_total)).catch(()=>{})});

  const byType=useMemo(()=>Object.fromEntries((types||[]).map(t=>[t.id,t])),[types]);
  const rows=useMemo(()=>{
    if(!types)return [];
    const s=q.trim().toLowerCase();
    const items=[
      ...(conns||[]).filter(c=>MCP_TYPES.has(c.type)).map(c=>({key:c.id,kind:'conn',c,t:c.type==='gateway'?gwType(c):byType[c.type]})),
      ...types.filter(t=>MCP_TYPES.has(t.id)&&t.available&&!(conns||[]).some(c=>c.type===t.id)).map(t=>({key:'t-'+t.id,kind:'avail',t})),
    ];
    return items.filter(r=>(!s||((r.c?.label||'')+shortName(r.t)+r.t.label+r.t.description).toLowerCase().includes(s))&&(tab==='全部'||(tab==='已建立'&&r.kind==='conn')));
  },[types,conns,q,tab,byType]);

  if(types===null)return <div className="lv-p"><Loading/></div>;

  const doShare=async share=>{try{const c=await api.shareConnector(sharing.id,share);setConns(a=>a.map(x=>x.id===c.id?c:x));setSharing(null);notify('分享設定已更新')}catch(e){notify('分享失敗：'+errText(e))}};
  if(!catalog)return <div className="lv-p"><div className="page-heading"><h1><Plugs/>連接器</h1></div>
    <p className="subtitle">連接您自己的工作帳號，讓 Medisense 在您的授權下協助處理日程等事務。</p>
    <MyConnections notify={notify}/></div>;

  if(wizard)return <div className="lv-p"><EnableService key={wizard.service+(wizard.id||'')} service={wizard.service} connectorId={wizard.id} me={me} notify={notify} onBack={()=>setWizard(null)}
    onDone={async()=>{setWizard(null);setMode('common');setMcKey(k=>k+1);await load()}}/></div>;

  if(view){
    const existing=view.id?conns.find(c=>c.id===view.id):null;
    return <div className="lv-p"><Setup key={view.id||view.typeId} me={me} notify={notify} types={types} typeId={view.typeId} existing={existing}
      onBack={()=>setView(null)}
      onSaved={c=>{setConns(a=>a.some(x=>x.id===c.id)?a.map(x=>x.id===c.id?c:x):[c,...a]);setView(v=>v.id?v:{typeId:c.type,id:c.id})}}
      onDeleted={id=>{setConns(a=>a.filter(x=>x.id!==id));setView(null)}}/></div>;
  }

  const open=r=>{
    if(r.kind==='conn'&&r.c.type==='gateway'){if(admin)setWizard({service:r.c.config?.service,id:r.c.id});else setSummary(r.c)}
    else if(r.kind==='conn')setView({typeId:r.t.id,id:r.c.id});
    else if(r.kind==='avail'&&builder&&(admin||!isOauth(r.t)))setView({typeId:r.t.id});
  };
  return <div className="lv-p">
    <div className="page-heading"><h1><Plugs/>連接器</h1></div>
    <p className="subtitle">連接 MCP 伺服器、Webhook 與協作工具。連接器為全院共用物件，憑證僅存放於 Secret Manager。</p>
    {denied&&<Banner icon={<Warning size={16}/>}>您目前的角色（{me?.role||'未知'}）沒有連接器的存取權限：後端要求建置者（builder）或管理員。如需使用請聯絡管理員調整角色。</Banner>}
    <div className="lv-gc-switch" role="tablist"><button role="tab" aria-selected={mode==='mine'} className={mode==='mine'?'on':''} onClick={()=>setMode('mine')}>我的連線</button><button role="tab" aria-selected={mode==='common'} className={mode==='common'?'on':''} onClick={()=>setMode('common')}>常用連接器</button><button role="tab" aria-selected={mode==='all'} className={mode==='all'?'on':''} onClick={()=>setMode('all')}>全部連接器{gwTotal!=null?`（${gwTotal.toLocaleString('en-US')}）`:''}</button></div>
    <label className="search lv-top-search"><MagnifyingGlass size={16}/><input aria-label="搜尋連接器" placeholder="搜尋連接器" value={q} onChange={e=>setQ(e.target.value)}/></label>
    {mode==='mine'?<MyConnections notify={notify} reloadKey={mcKey} query={q}/>:null}
    {mode==='mine'?null:mode==='all'?<GatewayCatalog query={q} admin={admin} onEnable={service=>setWizard({service})} onEdit={(service,id)=>setWizard({service,id})} onSetup={typeId=>{setMode('common');const c=(conns||[]).find(x=>x.type===typeId);setView(c?{typeId,id:c.id}:{typeId})}}/>:<>
    <h2 className="lv-gc-group" style={{marginTop:0}}>自訂</h2>
    {rows.length?<div className="lv-p-cards">{rows.map(r=>{
      const soon=r.kind==='soon',own=r.c&&canEdit(me,r.c,r.t),oauth=isOauth(r.t);
      return <div key={r.key} className={'lv-p-card'+(soon?' muted-card':'')}>
        <div className="lv-p-card-head">{r.c?.type==='gateway'?<ProviderIcon service={r.c.config?.service} name={r.c.label} size={40}/>:<span className="connector-icon"><TypeIcon id={r.t.id}/></span>}<div style={{minWidth:0}}><h3>{r.c?.label||shortName(r.t)}</h3><span className="lv-p-meta">{r.t.protocol}</span></div></div>
        <p>{r.t.description}</p>
        {soon&&<p style={{color:'#8a5a00'}}>{r.t.coming||'下一階段提供。'}</p>}
        {r.c&&<p className="lv-p-meta">建立者 {r.c.owner_email} · {r.c.agents_count||0} 個 Agent 使用{r.c.secret_fields?.length?` · 已保存 ${r.c.secret_fields.length} 項憑證`:''}</p>}
        {oauth&&<p className="lv-p-meta">每位使用者各自授權，只看得到自己的日曆。</p>}
        {r.c&&(oauth||r.c.type==='gateway')&&<div><ShareChip share={r.c.share} disabled={!own} onClick={()=>setSharing(r.c)}/></div>}
        {r.c?.type==='gateway'&&<p className="lv-p-meta">{AUTH_SHORT[r.c.config?.auth_mode]||'Open Connector'} · 已開放 {r.c.config?.allowed_actions?.length||0} 個動作</p>}
        <div className="lv-p-card-foot">
          {soon?<span className="lv-p-status warn"><i/>尚未開放</span>:r.c?(r.c.type==='gateway'&&r.c.status!=='error'?<span className="lv-p-status ok"><i/>已啟用</span>:<StatusPill status={r.c.status}/>):<span className="lv-p-status"><i/>尚未建立</span>}
          {soon?null:r.c?<button className="btn sm" onClick={()=>open(r)}>{own?'設定':'檢視'}<CaretRight size={12}/></button>:builder&&(admin||!oauth)?<button className="btn sm" onClick={()=>open(r)}><Plus size={12}/>連線</button>:oauth&&builder?<span className="lv-p-meta">僅管理員可建立</span>:null}
        </div>
      </div>})}</div>:<div className="lt"><Empty text={denied?'沒有存取權限':'沒有符合的連接器'}/></div>}
    {!denied&&<GatewayCatalog query={q} groups={COMMON_GROUPS} admin={admin} onEnable={service=>setWizard({service})} onEdit={(service,id)=>setWizard({service,id})} onSetup={typeId=>{const c=(conns||[]).find(x=>x.type===typeId);setView(c?{typeId,id:c.id}:{typeId})}}/>}
    </>}
    {summary&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSummary(null)}}><section className="modal" role="dialog" aria-modal="true" aria-label={summary.label}><h2>{summary.label}</h2>
      <p className="lv-p-meta">{summary.config?.service} · {AUTH_SHORT[summary.config?.auth_mode]||''}</p>{summary.config?.description&&<p>{summary.config.description}</p>}
      <p>已開放 {summary.config?.allowed_actions?.length||0} 個動作。只有管理員可以修改此連接器。</p><div className="modal-actions"><button className="btn" onClick={()=>setSummary(null)}>關閉</button></div></section></div>}
    {sharing&&<ShareDialog title={sharing.label} value={sharing.share} owner={sharing.owner_email||'你'} onClose={()=>setSharing(null)} onDone={doShare}/>}
    <div className="notice"><ShieldCheck/>狀態來自後端紀錄與最近一次連線測試；「已連線」僅代表該次測試通過，並非持續監控。</div>
  </div>;
}
