import React,{useMemo,useState} from 'react';
import {Plugs,Plus,CaretRight,ArrowLeft,Lock,Eye,EyeSlash,Trash,Play,ShieldCheck,Lightning,ChatCircleDots,UsersThree,Notebook,EnvelopeSimple,CalendarBlank,HardDrives,House,Image,ListChecks,Warning,Info} from '@phosphor-icons/react';
import {api} from '../api';
import {ListToolbar,Empty,Field} from '../ListKit';
import {errText,isBuilder,isAdmin,fmtTime,useOnce,Loading,Banner} from './pkit';
import './pages.css';

const ICONS={mcp:Plugs,webhook:Lightning,slack:ChatCircleDots,teams:UsersThree,notion:Notebook,gmail:EnvelopeSimple,calendar:CalendarBlank,drive:HardDrives,his_fhir:House,pacs:Image};
const TypeIcon=({id,size=24})=>{const I=ICONS[id]||Plugs;return <I size={size}/>};

const STATUS={active:['ok','已連線（測試通過）'],error:['err','連線失敗'],unverified:['','尚未驗證']};
export const StatusPill=({status})=>{const [c,t]=STATUS[status]||STATUS.unverified;return <span className={'lv-p-status '+c}><i/>{t}</span>};
const canEdit=(me,c)=>!!me&&(me.role==='admin'||c.owner_uid===me.uid);

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
  const editable=isNew||canEdit(me,existing);
  const [form,setForm]=useState(()=>{
    const cfg={};
    if(isNew)for(const f of spec.fields)if(f.kind!=='secret'&&f.default!=null)cfg[f.key]=f.default;
    return existing?{label:existing.label,scope:existing.scope||'',config:existing.config||{},secrets:{},redact_pii:existing.redact_pii,audit_payloads:existing.audit_payloads}
      :{label:spec.label,scope:'',config:cfg,secrets:{},redact_pii:true,audit_payloads:true};
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
    const missing=spec.fields.filter(f=>f.required&&(f.kind==='secret'?!(form.secrets[f.key]||stored.includes(f.key)):!form.config[f.key]||(Array.isArray(form.config[f.key])&&!form.config[f.key].length)));
    if(missing.length){notify('必填欄位：'+missing.map(f=>f.label).join('、'));return null}
    setBusy('save');
    try{
      const secrets=Object.fromEntries(Object.entries(form.secrets).filter(([,v])=>v));
      const body={type:spec.id,label:form.label.trim(),scope:form.scope,config:form.config,secrets,redact_pii:form.redact_pii,audit_payloads:form.audit_payloads};
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
  const server=spec.fields.filter(f=>f.section==='server'),cred=spec.fields.filter(f=>f.section!=='server');
  const fp={cfg:form.config,setCfg,secrets:form.secrets,setSecret,stored,disabled:!editable||!!busy};
  return <div className="lv-p-form">
    <button className="lv-p-back" onClick={onBack}><ArrowLeft size={14}/>返回連接器</button>
    <div className="page-heading"><h1><TypeIcon id={spec.id} size={26}/> {form.label||spec.label}</h1>{cur&&<StatusPill status={cur.status}/>}</div>
    <p className="subtitle">{spec.protocol}</p>
    {!editable&&cur&&<Banner icon={<Warning size={16}/>}>此連接器由 {cur.owner_email} 建立。您可在 Agent 中使用，但只有建立者或管理員可以修改或刪除。</Banner>}
    <Banner info icon={<ShieldCheck size={16}/>}>憑證由後端存入 Secret Manager，瀏覽器儲存後不再取回；清單與詳細頁只顯示「已保存」。此頁面未驗證任何外部系統，連線狀態僅以「測試」結果為準。</Banner>
    <section className="panel"><h2>基本資訊</h2>
      <Field label="連接器識別名稱 *"><input type="text" disabled={!editable||!!busy} value={form.label} onChange={e=>setForm(x=>({...x,label:e.target.value}))}/></Field>
      <Field label="適用情境與範圍"><input type="text" disabled={!editable||!!busy} value={form.scope} placeholder="例如：心導管室異常警報通知" onChange={e=>setForm(x=>({...x,scope:e.target.value}))}/></Field>
      <p className="lv-p-hint" style={{margin:0}}>{spec.description}</p>
    </section>
    <section className="panel"><h2>伺服器與端點</h2>{server.length?server.map(f=><SpecField key={f.key} f={f} {...fp}/>):<p className="muted small">此類型沒有非機密的端點設定。</p>}</section>
    <section className="panel"><h2>授權憑證</h2>{cred.length?cred.map(f=><SpecField key={f.key} f={f} {...fp}/>):<p className="muted small">此類型不需要憑證。</p>}</section>
    <section className="panel"><h2>合規設定</h2>
      {[['redact_pii','送出前去識別化','以 Sensitive Data Protection 取代姓名、病歷號、身分證等識別資訊。'],['audit_payloads','記錄 Payload 至稽核日誌','每次工具呼叫的參數與結果狀態寫入稽核集合。']].map(([k,t,d])=><div className="lv-p-switch-row" key={k}><div><b>{t}</b>{d}</div><input type="checkbox" role="switch" aria-label={t} disabled={!editable||!!busy} checked={form[k]} onChange={e=>setForm(x=>({...x,[k]:e.target.checked}))}/></div>)}
    </section>
    {test&&<div className={'lv-p-test'+(test.ok?'':' err')}><b>{test.ok?'測試通過':'測試失敗'}</b>：{test.message} <span className="lv-p-meta">{test.ms} ms{test.at?' · '+fmtTime(test.at):''}</span>
      {test.tools?.length>0&&<div className="lv-p-chips">{test.tools.map(t=><span key={t.id} className="badge" title={t.description}>{t.id}</span>)}</div>}</div>}
    {actions&&<section className="panel"><h2>可用動作（{actions.length}）</h2>{actions.length?<div className="lv-p-chips" style={{marginTop:0}}>{actions.map(a=><span key={a.id} className="badge" title={a.description||''}>{a.label||a.id}{a.write?' · 寫入':' · 唯讀'}</span>)}</div>:<p className="muted small">沒有可用動作。MCP 連接器需先測試成功才會列出伺服器工具。</p>}</section>}
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
  const [picking,setPicking]=useState(false);
  const builder=isBuilder(me);

  const load=async()=>{
    try{
      const [t,c]=await Promise.all([api.connectorTypes(),api.listConnectors()]);
      setTypes(t.types||[]);setConns(c||[]);
    }catch(e){
      const m=errText(e);setTypes([]);setConns([]);
      if(m.startsWith('403'))setDenied(m);else notify('無法載入連接器：'+m);
    }
  };
  useOnce(load);

  const byType=useMemo(()=>Object.fromEntries((types||[]).map(t=>[t.id,t])),[types]);
  const rows=useMemo(()=>{
    if(!types)return [];
    const s=q.trim().toLowerCase();
    const items=[
      ...(conns||[]).filter(c=>byType[c.type]).map(c=>({key:c.id,kind:'conn',c,t:byType[c.type]})),
      ...types.filter(t=>t.available&&!(conns||[]).some(c=>c.type===t.id)).map(t=>({key:'t-'+t.id,kind:'avail',t})),
      ...types.filter(t=>!t.available).map(t=>({key:'t-'+t.id,kind:'soon',t}))];
    return items.filter(r=>(!s||((r.c?.label||'')+r.t.label+r.t.description).toLowerCase().includes(s))&&(tab==='全部'||(tab==='已建立'&&r.kind==='conn')||(tab==='尚未開放'&&r.kind==='soon')));
  },[types,conns,q,tab,byType]);

  if(types===null)return <div className="lv-p"><Loading/></div>;

  if(view){
    const existing=view.id?conns.find(c=>c.id===view.id):null;
    return <div className="lv-p"><Setup key={view.id||view.typeId} me={me} notify={notify} types={types} typeId={view.typeId} existing={existing}
      onBack={()=>setView(null)}
      onSaved={c=>{setConns(a=>a.some(x=>x.id===c.id)?a.map(x=>x.id===c.id?c:x):[c,...a]);setView(v=>v.id?v:{typeId:c.type,id:c.id})}}
      onDeleted={id=>{setConns(a=>a.filter(x=>x.id!==id));setView(null)}}/></div>;
  }

  const open=r=>{
    if(r.kind==='conn')setView({typeId:r.t.id,id:r.c.id});
    else if(r.kind==='avail'&&builder)setView({typeId:r.t.id});
  };
  return <div className="lv-p">
    <div className="page-heading"><h1><Plugs/>連接器</h1>{builder&&<button className="btn primary" onClick={()=>setPicking(p=>!p)}><Plus/>新增連接器</button>}</div>
    <p className="subtitle">連接 MCP 伺服器、Webhook 與協作工具。連接器為全院共用物件，憑證僅存放於 Secret Manager。</p>
    {denied&&<Banner icon={<Warning size={16}/>}>您目前的角色（{me?.role||'未知'}）沒有連接器的存取權限：後端要求建置者（builder）或管理員。如需使用請聯絡管理員調整角色。</Banner>}
    {!denied&&!builder&&<Banner info icon={<Info size={16}/>}>您的角色為一般使用者，僅能檢視清單，無法新增、修改或刪除連接器。</Banner>}
    {picking&&builder&&<section className="panel" style={{padding:16,marginBottom:16}}><b style={{fontSize:13}}>選擇連接器類型</b><div className="lv-p-chips">{types.filter(t=>t.available).map(t=><button key={t.id} className="btn sm" onClick={()=>{setPicking(false);setView({typeId:t.id})}}><TypeIcon id={t.id} size={16}/>{t.label}</button>)}</div><p className="lv-p-hint" style={{marginTop:8}}>Gmail、Calendar、Drive、HIS FHIR、PACS 尚未開放，無法建立。</p></section>}
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋連接器" tabs={['全部','已建立','尚未開放']} tab={tab} onTab={setTab}/>
    {rows.length?<div className="lv-p-cards">{rows.map(r=>{
      const soon=r.kind==='soon',own=r.c&&canEdit(me,r.c);
      return <div key={r.key} className={'lv-p-card'+(soon?' muted-card':'')}>
        <div className="lv-p-card-head"><span className="connector-icon"><TypeIcon id={r.t.id}/></span><div style={{minWidth:0}}><h3>{r.c?.label||r.t.label}</h3><span className="lv-p-meta">{r.t.protocol}</span></div></div>
        <p>{r.t.description}</p>
        {soon&&<p style={{color:'#8a5a00'}}>{r.t.coming||'下一階段提供。'}</p>}
        {r.c&&<p className="lv-p-meta">建立者 {r.c.owner_email} · {r.c.agents_count||0} 個 Agent 使用{r.c.secret_fields?.length?` · 已保存 ${r.c.secret_fields.length} 項憑證`:''}</p>}
        <div className="lv-p-card-foot">
          {soon?<span className="lv-p-status warn"><i/>尚未開放</span>:r.c?<StatusPill status={r.c.status}/>:<span className="lv-p-status"><i/>尚未建立</span>}
          {soon?null:r.c?<button className="btn sm" onClick={()=>open(r)}>{own?'設定':'檢視'}<CaretRight size={12}/></button>:builder?<button className="btn sm" onClick={()=>open(r)}><Plus size={12}/>設定</button>:null}
        </div>
      </div>})}</div>:<div className="lt"><Empty text={denied?'沒有存取權限':'沒有符合的連接器'}/></div>}
    <div className="notice"><ShieldCheck/>狀態來自後端紀錄與最近一次連線測試；「已連線」僅代表該次測試通過，並非持續監控。</div>
  </div>;
}
