import React,{useState,useMemo,useEffect} from 'react';
import {Sparkle,CheckCircle,Cpu,Plus,PencilSimple,Trash,ArrowRight,Info,Warning,Lock,UploadSimple,ClockCounterClockwise,ArrowSquareOut} from '@phosphor-icons/react';
import {api} from '../api';
import {Toggle,ListToolbar,Empty} from '../ListKit';
import {errText,useOnce,fmtTime} from './pkit';
import './ops.css';

const GROUPS=['fast','reasoning','budget','sovereign'];
const chainText=f=>f.models?.length&&f.models.join()!==f.name?`${f.name}（${f.models.join('、')}）`:f.name;
const blank={name:'',provider:'',litellm_model:'',group:'fast',deploy:'cloud',enabled:true,secret_name:'',api_base:'',input_price_per_m:0,output_price_per_m:0,notes:''};
const pick=m=>Object.fromEntries(Object.keys(blank).map(k=>[k,m[k]??blank[k]]));
const DEPLOY_LABEL={dispatched:'已送出',queued:'排隊中',deploying:'部署中',deployed:'已部署',failed:'失敗'};
const deployDone=d=>!d||d.status==='deployed'||d.status==='failed';

export function LiveGroupTable({groups,failed}){
  if(groups===null)return <div className="lv-o-loading">載入中…</div>;
  const by=Object.fromEntries(groups.map(g=>[g.id,g]));
  return <div className="lt" style={{'--cols':'130px minmax(180px,1.4fr) minmax(220px,2fr) 100px'}}>
    <div className="lt-head"><span>群組</span><span>目前成員</span><span>備援順序</span><span>狀態</span></div>
    {GROUPS.map(id=>{const g=by[id];const ok=!failed&&g?.configured;return <div className="lt-row" key={id}>
      <b>{id}</b>
      <span>{ok?((g.models||[]).join(' / ')||'（無成員）'):'—'}</span>
      <span>{ok?(g.fallbacks?.length?<span className="lv-o-chain">{g.fallbacks.map((f,i)=><React.Fragment key={i}>{i>0&&<ArrowRight size={12}/>}<span className="badge">{chainText(f)}</span></React.Fragment>)}</span>:'無備援'):'—'}</span>
      <span className={'lv-o-status '+(failed?'':ok?'ok':'warn')}><i/>{failed?'未取得':ok?'已設定':'未設定'}</span>
    </div>})}
  </div>;
}

/* 可選模型: models that can be registered with one click. Registering adds it to the registry; 套用到 Medisense Model Gateway makes it usable. */
function CatalogView({items,onRegister,pending,onApply,busy}){
  const [ask,setAsk]=useState(null),[f,setF]=useState({api_base:'',secret_name:'',deployment:''}),[err,setErr]=useState('');
  const needs=m=>m.needs_api_base||m.needs_secret||m.needs_deployment;
  if(items===null)return <div className="lv-o-loading">載入中…</div>;
  const reg=async(m,body={})=>{setErr('');try{await onRegister(m,body);setAsk(null);setF({api_base:'',secret_name:'',deployment:''})}catch(e){setErr(errText(e))}};
  return <>
    {pending&&<div className="lv-o-banner"><Info size={16}/><div>已註冊的模型<b>尚未套用到 Medisense Model Gateway</b>，套用後才能在對話中選用。</div><button className="btn primary" disabled={!!busy} onClick={onApply} style={{marginLeft:'auto'}}><UploadSimple/>套用到 Medisense Model Gateway</button></div>}
    <div className="mc-grid">{items.map(m=><div className={'mc-card'+(m.registered?' on':'')} key={m.key}>
      <span className="mc-ico">{m.deploy==='onprem'||m.provider==='Azure'?<Cpu size={20}/>:<Sparkle size={20} weight="fill" color={m.provider==='Anthropic'?'#d97757':'#4285f4'}/>}</span>
      <div className="mc-txt"><b>{m.name}</b><small>{m.description}</small>
        <span className="mc-tags"><span className="badge">{m.provider}</span><span className="badge">{m.deploy==='onprem'?'地端':'雲端'}</span><span className="badge">{m.group}</span></span></div>
      {m.registered?<span className="mc-done"><CheckCircle size={18} weight="fill"/>已註冊</span>
        :<button className="btn primary mc-btn" disabled={!!busy} onClick={()=>needs(m)?(setAsk(m),setF({api_base:'',secret_name:'',deployment:''}),setErr('')):reg(m)}>註冊</button>}
    </div>)}</div>
    {err&&!ask&&<p className="lv-o-err" role="alert" style={{marginTop:10}}>{err}</p>}
    {ask&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAsk(null)}}><form className="modal" role="dialog" aria-modal="true" aria-label={'註冊 '+ask.name} onSubmit={e=>{e.preventDefault();
      if(ask.needs_deployment&&!f.deployment.trim())return setErr('請填寫部署名稱');if(ask.needs_api_base&&!f.api_base.trim())return setErr('請填寫位址');if(ask.needs_secret&&!f.secret_name.trim())return setErr('請填寫 Secret 名稱');
      reg(ask,{api_base:f.api_base.trim(),secret_name:f.secret_name.trim(),deployment:f.deployment.trim()})}}>
      <h2>註冊 {ask.name}</h2><p className="muted small">{ask.description}</p>
      {ask.needs_deployment&&<div className="field"><label>部署名稱（deployment）</label><input autoFocus value={f.deployment} onChange={e=>setF({...f,deployment:e.target.value})} placeholder="例如：gpt-5"/></div>}
      {ask.needs_api_base&&<div className="field"><label>{ask.deploy==='onprem'?'API 位址（OpenAI 相容）':'資源位址（endpoint）'}</label><input autoFocus={!ask.needs_deployment} value={f.api_base} onChange={e=>setF({...f,api_base:e.target.value})} placeholder={ask.deploy==='onprem'?'http://vllm.internal:8000/v1':'https://貴院資源.openai.azure.com'}/></div>}
      {ask.needs_secret&&<div className="field"><label>Secret 名稱</label><input value={f.secret_name} autoComplete="off" onChange={e=>setF({...f,secret_name:e.target.value})} placeholder="例如：azure-openai-key"/><span className="lv-o-help"><Lock size={11}/> 只填 Secret Manager 的「名稱」，金鑰內容請由維運人員在 Secret Manager 建立，絕不在此輸入。</span></div>}
      {err&&<p className="lv-o-err" role="alert">{err}</p>}
      <div className="modal-actions"><button type="button" className="btn" onClick={()=>setAsk(null)}>取消</button><button className="btn primary">註冊</button></div>
    </form></div>}
  </>;
}

function validate(f){
  if(!f.name.trim())return '請輸入名稱';
  if(!f.provider.trim())return '請輸入供應商';
  if(!f.litellm_model.trim())return '請輸入 Medisense Model Gateway 模型字串';
  if(f.deploy==='onprem'&&f.group!=='sovereign')return '地端模型只能使用 sovereign 群組';
  if(f.deploy==='cloud'&&f.group==='sovereign')return '雲端模型不可使用 sovereign 群組';
  if(f.deploy==='onprem'&&!f.api_base.trim())return '地端模型需填寫 API 位址（api_base）';
  if(f.secret_name&&!/^[A-Za-z0-9_-]+$/.test(f.secret_name))return 'secret_name 只能包含英數字、底線與連字號（請填 Secret Manager 的名稱，不是金鑰內容）';
  if(!(f.input_price_per_m>=0)||!(f.output_price_per_m>=0))return '價格不可為負數';
  return '';
}

function Editor({init,onClose,onSave}){
  const [f,setF]=useState(init),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const set=(k,v)=>setF(a=>{const n={...a,[k]:v};if(k==='deploy')n.group=v==='onprem'?'sovereign':(a.group==='sovereign'?'fast':a.group);return n});
  async function submit(e){e.preventDefault();const m=validate(f);setErr(m);if(m)return;setBusy(true);try{await onSave({...f,name:f.name.trim(),provider:f.provider.trim(),litellm_model:f.litellm_model.trim(),secret_name:f.secret_name.trim(),api_base:f.api_base.trim(),input_price_per_m:Number(f.input_price_per_m)||0,output_price_per_m:Number(f.output_price_per_m)||0})}catch(x){setErr(errText(x))}finally{setBusy(false)}}
  const inp=(k,props={})=><input value={f[k]} onChange={e=>set(k,e.target.value)} {...props}/>;
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><form className="modal lv-o-modal-wide" role="dialog" aria-modal="true" aria-label={init.name?'編輯模型':'新增模型'} onSubmit={submit}>
    <h2>{init.name?'編輯模型':'新增模型'}</h2>
    <div className="lv-o-form2">
      <div className="field"><label>名稱</label>{inp('name',{autoFocus:true,placeholder:'例如：Gemini 2.5 Flash'})}</div>
      <div className="field"><label>供應商</label>{inp('provider',{placeholder:'例如：vertex_ai、vllm'})}</div>
      <div className="field"><label>Medisense Model Gateway 模型字串</label>{inp('litellm_model',{placeholder:'例如：vertex_ai/gemini-2.5-flash'})}<span className="lv-o-help">開源／自架模型（vLLM、Ollama 等 OpenAI 相容 API）請用 <span className="lv-o-mono">openai/&lt;模型名稱&gt;</span>，並填 API 位址。</span></div>
      <div className="field"><label>部署位置</label><select value={f.deploy} onChange={e=>set('deploy',e.target.value)}><option value="cloud">雲端</option><option value="onprem">地端</option></select></div>
      <div className="field"><label>模型群組</label><select value={f.group} onChange={e=>set('group',e.target.value)}>{GROUPS.map(g=><option key={g} value={g} disabled={(f.deploy==='onprem')!==(g==='sovereign')}>{g}</option>)}</select><span className="lv-o-help">地端僅能用 sovereign；雲端不可用 sovereign。</span></div>
      <div className="field"><label>API 位址（api_base）{f.deploy==='onprem'&&' *'}</label>{inp('api_base',{placeholder:'http://vllm.internal:8000/v1'})}</div>
      <div className="field"><label>Secret 名稱（secret_name）</label>{inp('secret_name',{placeholder:'例如：openai-api-key',autoComplete:'off'})}<span className="lv-o-help"><Lock size={11}/> 僅填 Secret Manager 的「名稱」。金鑰內容絕不在此輸入，請由維運人員於 Secret Manager 建立。</span></div>
      <div className="field"><label>啟用</label><div><Toggle on={f.enabled} label="啟用" onChange={v=>set('enabled',v)}/></div></div>
      <div className="field"><label>輸入價格（每百萬 token，USD）</label>{inp('input_price_per_m',{type:'number',min:0,step:'any'})}</div>
      <div className="field"><label>輸出價格（每百萬 token，USD）</label>{inp('output_price_per_m',{type:'number',min:0,step:'any'})}</div>
    </div>
    <div className="field"><label>備註</label><textarea rows={2} value={f.notes} onChange={e=>set('notes',e.target.value)}/></div>
    {err&&<p className="lv-o-err" role="alert">{err}</p>}
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={busy}>{busy?'儲存中…':'儲存'}</button></div>
  </form></div>;
}

function CodePanel({title,data}){
  return <section className="panel lv-o-card" style={{marginBottom:16}}>
    <h3>{title}</h3>
    <p className="muted small">版本 v{data.version??'—'}{data.status?` · ${DEPLOY_LABEL[data.status]||data.status}`:''}{data.requested_by?` · ${data.requested_by}`:''}{data.requested_at?` · ${fmtTime(data.requested_at)}`:''}{data.run_url&&<> · <a href={data.run_url} target="_blank" rel="noreferrer">GitHub Actions 執行紀錄 <ArrowSquareOut size={11}/></a></>}</p>
    <pre className="lv-o-code" aria-label="LiteLLM config.yaml（唯讀）">{data.yaml}</pre>
    <b style={{fontSize:13}}>需掛載的 Secret</b>
    {data.secrets?.length?<div className="lt" style={{'--cols':'1fr 1fr',marginTop:8}}><div className="lt-head"><span>Secret 名稱</span><span>環境變數</span></div>{data.secrets.map((s,i)=><div className="lt-row" key={i}><span className="lv-o-mono">{s.secret}</span><span className="lv-o-mono">{s.env}</span></div>)}</div>:<p className="muted small">無需額外掛載的 Secret。</p>}
  </section>;
}

const TIERS=[['simple','簡單','問候、定義、短問答'],['medium','中等','一般查詢'],['complex','複雜','技術性、多段落需求'],['reasoning','推理','逐步分析、深度推論']];

/* 智慧路由: the gateway's `smart-router` model scores each request locally and serves it from the model chosen for its tier. */
function SmartRouterCard({items,smart,onSaved,notify}){
  const [f,setF]=useState(null),[busy,setBusy]=useState(false);
  useEffect(()=>{if(smart)setF({enabled:!!smart.enabled,simple:smart.simple||'',medium:smart.medium||'',complex:smart.complex||'',reasoning:smart.reasoning||''})},[smart]);
  if(!f)return null;
  const live=(items||[]).filter(m=>m.enabled);
  const liveIds=new Set(live.map(m=>m.id));
  const missing=TIERS.filter(([k])=>!liveIds.has(f[k])).map(([,n])=>n);
  const dirty=!smart||['enabled',...TIERS.map(t=>t[0])].some(k=>f[k]!==(k==='enabled'?!!smart[k]:smart[k]||''));
  async function save(){
    setBusy(true);
    try{const r=await api.saveSmartRouter(f);onSaved(r);notify('智慧路由已儲存，設定檔已更新（尚未套用到 Medisense Model Gateway）')}catch(e){notify('儲存失敗：'+errText(e))}finally{setBusy(false)}
  }
  return <section className="panel lv-o-card" style={{marginTop:26}}>
    <div className="inline" style={{justifyContent:'space-between'}}><h2 style={{fontSize:16,margin:0}}>智慧路由（smart-router）</h2><Toggle on={f.enabled} label="啟用智慧路由" onChange={v=>setF(a=>({...a,enabled:v}))}/></div>
    <p className="lv-o-help" style={{margin:'6px 0 12px'}}>依問題難度自動挑選模型：Medisense Model Gateway 在本機以規則評分（不額外呼叫模型、延遲 &lt;1ms），再交給下列各難度所選的模型。呼叫時使用模型名稱 <span className="lv-o-mono">smart-router</span>。</p>
    <div className="lv-o-form2">
      {TIERS.map(([k,name,hint])=><div className="field" key={k}><label>{name}<span className="lv-o-help"> · {hint}</span></label>
        <select value={f[k]} onChange={e=>setF(a=>({...a,[k]:e.target.value}))}>
          <option value="">請選擇模型…</option>
          {live.map(m=><option key={m.id} value={m.id}>{m.name}（{m.group}）</option>)}
        </select></div>)}
    </div>
    {f.enabled&&missing.length>0&&<p className="lv-o-err" role="alert">請為「{missing.join('、')}」選擇啟用中的模型。</p>}
    <div className="inline" style={{marginTop:10}}><button className="btn primary" disabled={busy||!dirty||(f.enabled&&missing.length>0)} onClick={save}>{busy?'儲存中…':'儲存智慧路由'}</button><span className="lv-o-help">儲存後仍需按下方「套用到 Medisense Model Gateway」才會部署。</span></div>
  </section>;
}

export default function ModelRegistryPage({me,notify}){
  const admin=me?.role==='admin';
  const [groups,setGroups]=useState(null),[gfail,setGfail]=useState(false);
  const [items,setItems]=useState(null),[search,setSearch]=useState(''),[tab,setTab]=useState('全部'),[view,setView]=useState('catalog'),[cat,setCat]=useState(null),[pending,setPending]=useState(false),[smart,setSmart]=useState(null);
  const [editing,setEditing]=useState(null),[del,setDel]=useState(null),[deploy,setDeploy]=useState(null),[confirmApply,setConfirmApply]=useState(false),[last,setLast]=useState(undefined),[busy,setBusy]=useState('');
  async function loadCat(){try{setCat(await api.modelCatalog())}catch(e){setCat([]);notify('無法載入可選模型：'+errText(e))}}
  async function register(m,body){await api.registerCatalogModel(m.key,body);notify(`已註冊 ${m.name}，尚未套用到 Medisense Model Gateway`);setPending(true);setLast(undefined);await Promise.all([loadCat(),load()])}
  async function load(){try{const r=await api.listModelRegistry();setItems(Array.isArray(r)?r:(r.models||r.items||[]))}catch(e){setItems([]);notify('無法載入模型清單：'+errText(e))}}
  useOnce(async()=>{
    try{const r=await api.modelGroups();setGroups(r.groups||[])}catch(e){setGroups([]);setGfail(true);notify('無法載入模型路由表：'+errText(e))}
    if(admin){load();loadCat();api.litellmDeploy().then(setDeploy).catch(()=>{});api.getSmartRouter().then(setSmart).catch(()=>{})}
  });
  // Follow the GitHub Actions run until it finishes.
  useEffect(()=>{
    if(deployDone(deploy))return;
    const t=setTimeout(async()=>{try{const d=await api.litellmDeploy();setDeploy(d);if(d?.status==='deployed')notify(`Medisense Model Gateway 已更新為 v${d.version}`);else if(d?.status==='failed')notify('Medisense Model Gateway 部署失敗，請查看執行紀錄')}catch{setDeploy(d=>({...d}))}},10000);
    return()=>clearTimeout(t);
  },[deploy]);
  const shown=useMemo(()=>(items||[]).filter(m=>(tab==='全部'||(tab==='雲端'?m.deploy==='cloud':m.deploy==='onprem'))&&(!search.trim()||[m.name,m.provider,m.litellm_model,m.group].some(s=>(s||'').toLowerCase().includes(search.trim().toLowerCase())))),[items,tab,search]);
  const heading=<div className="page-heading"><h1><Cpu/>模型</h1>{admin&&view==='registry'&&<button className="btn primary" onClick={()=>setEditing({...blank})}><Plus/>新增模型</button>}</div>;
  if(!admin)return <div className="lv-o">{heading}<p className="subtitle">各模型群組目前使用的模型與備援順序（即時、唯讀）。模型登錄與編輯僅限管理員。</p><LiveGroupTable groups={groups} failed={gfail}/></div>;

  async function save(f){
    if(editing.id)await api.updateModelEntry(editing.id,f);else await api.createModelEntry(f);
    notify((editing.id?'已更新模型':'已新增模型')+'，設定檔已更新（尚未套用到 Medisense Model Gateway）');setEditing(null);await load();setLast(undefined);
  }
  async function toggle(m,v){
    try{await api.updateModelEntry(m.id,{...pick(m),enabled:v});setItems(a=>a.map(x=>x.id===m.id?{...x,enabled:v}:x));setLast(undefined)}catch(e){notify('更新失敗：'+errText(e))}
  }
  async function remove(){
    try{await api.deleteModelEntry(del.id);notify('已刪除模型，設定檔已更新（尚未套用到 Medisense Model Gateway）');setDel(null);await load();setLast(undefined)}catch(e){notify('刪除失敗：'+errText(e));setDel(null)}
  }
  async function apply(){
    setConfirmApply(false);setBusy('apply');
    try{const r=await api.applyModelRegistry();setDeploy(r);notify(`已送出部署 v${r.version}，Medisense Model Gateway 約需數分鐘更新`)}catch(e){notify('套用失敗：'+errText(e))}finally{setBusy('')}
  }
  async function showLast(){
    setBusy('last');
    try{const r=await api.renderedModelConfig();setLast(r);if(!r)notify('尚未產生任何設定檔')}catch(e){notify('無法取得設定檔：'+errText(e))}finally{setBusy('')}
  }
  const price=m=>`${m.input_price_per_m??0} / ${m.output_price_per_m??0}`;
  return <div className="lv-o">{heading}
    <p className="subtitle">從「可選模型」挑選並註冊，再按「套用到 Medisense Model Gateway」就能在對話中使用。目錄沒有的模型，可到「已註冊」手動新增。</p>
    <div className="lv-o-viewtabs"><button className={view==='catalog'?'selected':''} onClick={()=>setView('catalog')}>可選模型</button><button className={view==='registry'?'selected':''} onClick={()=>setView('registry')}>已註冊</button><button className={view==='groups'?'selected':''} onClick={()=>setView('groups')}>即時群組</button></div>
    {view==='groups'?<LiveGroupTable groups={groups} failed={gfail}/>:view==='catalog'?<CatalogView items={cat} onRegister={register} pending={pending} onApply={()=>setConfirmApply(true)} busy={busy}/>:<>
      <ListToolbar search={search} onSearch={setSearch} placeholder="搜尋名稱、供應商、模型" tabs={['全部','雲端','地端']} tab={tab} onTab={setTab}/>
      {items===null?<div className="lv-o-loading">載入中…</div>:<div className="lt" style={{'--cols':'minmax(130px,1.3fr) minmax(90px,.8fr) minmax(160px,1.5fr) 100px 70px 60px 110px 84px'}}>
        <div className="lt-head"><span>名稱</span><span>供應商</span><span>Medisense Model Gateway 模型</span><span>群組</span><span>部署</span><span>啟用</span><span>價格 輸入/輸出</span><span/></div>
        {shown.map(m=><div className="lt-row" key={m.id}>
          <span><b>{m.name}</b>{m.secret_name&&<span className="lv-o-sub">Secret：{m.secret_name}</span>}</span>
          <span>{m.provider}</span><span className="lv-o-mono">{m.litellm_model}</span>
          <span><span className="badge">{m.group}</span></span><span>{m.deploy==='onprem'?'地端':'雲端'}</span>
          <Toggle on={!!m.enabled} label={'啟用 '+m.name} onChange={v=>toggle(m,v)}/>
          <span className="small">{price(m)}</span>
          <span className="lt-actions"><button className="icon-btn" aria-label={'編輯 '+m.name} onClick={()=>setEditing({...pick(m),id:m.id})}><PencilSimple/></button><button className="icon-btn" aria-label={'刪除 '+m.name} onClick={()=>setDel(m)}><Trash/></button></span>
        </div>)}
        {!shown.length&&<Empty text={items.length?'沒有符合條件的模型。':'尚未登錄任何模型。'}/>}
      </div>}
      <p className="lv-o-help" style={{marginTop:6}}>價格單位為每百萬 token（USD），僅在內建價格表查無該模型時用於成本估算。</p>
      <SmartRouterCard items={items} smart={smart} notify={notify} onSaved={r=>{setSmart(r);setLast(undefined)}}/>
      <h2 style={{fontSize:16,margin:'26px 0 10px'}}>套用到 Medisense Model Gateway</h2>
      <div className="lv-o-banner"><Warning size={16}/><div><b>此按鈕會重新部署 Medisense Model Gateway。</b>透過 GitHub Actions 執行 <span className="lv-o-mono">infra/09-apply-litellm-config.sh</span>：重建映像檔、更新 Cloud Run，並把 <span className="lv-o-mono">litellm/config.yaml</span> 提交到 main。fast、reasoning、budget 每組至少需一個啟用的模型。</div></div>
      <div className="inline" style={{marginBottom:16}}><button className="btn primary" disabled={!!busy||!deployDone(deploy)} onClick={()=>setConfirmApply(true)}><UploadSimple/>{busy==='apply'?'送出中…':!deployDone(deploy)?'部署中…':'套用到 Medisense Model Gateway'}</button><button className="btn" disabled={!!busy} onClick={showLast}><ClockCounterClockwise/>{busy==='last'?'讀取中…':'查看目前設定檔'}</button></div>
      {deploy&&<section className="panel lv-o-card" style={{marginBottom:16}}><h3>最近一次部署</h3><p className="small"><span className={'lv-o-status '+(deploy.status==='deployed'?'ok':deploy.status==='failed'?'bad':'warn')}><i/>{DEPLOY_LABEL[deploy.status]||deploy.status}</span> · v{deploy.version} · {deploy.requested_by}{deploy.requested_at?` · ${fmtTime(deploy.requested_at)}`:''}{deploy.run_url&&<> · <a href={deploy.run_url} target="_blank" rel="noreferrer">GitHub Actions 執行紀錄 <ArrowSquareOut size={11}/></a></>}</p></section>}
      {last===null&&<p className="muted small">尚未產生任何設定檔。</p>}
      {last&&<CodePanel title="目前設定檔（下次套用的內容）" data={last}/>}
    </>}
    <div className="notice"><Info/>金鑰內容不會經過此頁；登錄只記錄 Secret Manager 的名稱。</div>
    {editing&&<Editor init={editing} onClose={()=>setEditing(null)} onSave={save}/>}
    {confirmApply&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirmApply(false)}}><div className="modal" role="dialog" aria-modal="true" aria-label="確認套用"><h2>套用到 Medisense Model Gateway</h2><p>將以目前的模型登錄重新部署 Medisense Model Gateway（約數分鐘）。部署期間進行中的請求可能短暫失敗；新設定會提交到 GitHub main。確定要套用嗎？</p><div className="modal-actions"><button className="btn" onClick={()=>setConfirmApply(false)}>取消</button><button className="btn primary" onClick={apply}>套用並部署</button></div></div></div>}
    {del&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDel(null)}}><div className="modal" role="dialog" aria-modal="true" aria-label="確認刪除"><h2>刪除模型</h2><p>確定要刪除「{del.name}」？此動作無法復原；需按「套用到 Medisense Model Gateway」後才會反映於 Medisense Model Gateway。</p><div className="modal-actions"><button className="btn" onClick={()=>setDel(null)}>取消</button><button className="btn primary" onClick={remove}>刪除</button></div></div></div>}
  </div>;
}
