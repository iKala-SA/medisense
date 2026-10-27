import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Check,Copy,Eye,EyeSlash,Info,Warning,MagnifyingGlass,Lock,ShieldWarning} from '@phosphor-icons/react';
import {api} from '../api';
import {emptyShare} from '../ShareKit';
import ProviderIcon from './ProviderIcon';
import {Loading,Banner} from './pkit';
import {ShareChip,ShareDialog,shareSummary} from './ShareLive';
import './enableservice.css';

const AUTH_LABEL={oauth2:'每位使用者各自授權（OAuth）',api_key:'共用 API Key（由管理員保管）',custom_credential:'共用憑證（由管理員保管）',no_auth:'無需授權'};
const STEPS=['連接詳細資訊','管理寫入許可','管理讀取許可','分享與完成'];
const msg=e=>String(e?.message||e).replace(/^Error:\s*/,'').replace(/^\d{3}\s+/,'');
const OPS=[['read','讀取'],['write','寫入'],['destructive','破壞性']];

function CredField({f,value,onChange,optional,hint}){
  const [show,setShow]=useState(false);
  const secret=f.secret||f.inputType==='password';
  const id='es-f-'+f.key;
  return <div className="lv-es-field"><label htmlFor={id}>{f.label}{f.required&&!optional&&<span className="lv-es-req" aria-label="必填"> *</span>}{optional&&<span className="lv-es-opt">{hint}</span>}</label>
    {f.inputType==='textarea'?<textarea id={id} rows={4} value={value||''} placeholder={f.placeholder} onChange={e=>onChange(e.target.value)}/>
      :secret?<div className="lv-es-secret"><input id={id} type={show?'text':'password'} autoComplete="off" value={value||''} placeholder={f.placeholder} onChange={e=>onChange(e.target.value)}/><button type="button" className="icon-btn" aria-label={show?'隱藏':'顯示輸入內容'} onClick={()=>setShow(s=>!s)}>{show?<EyeSlash/>:<Eye/>}</button></div>
      :<input id={id} type="text" autoComplete="off" value={value||''} placeholder={f.placeholder} onChange={e=>onChange(e.target.value)}/>}
    {f.description&&<span className="lv-es-hint">{f.description}</span>}</div>;
}

function ActionGroup({title,tone,items,sel,setSel,empty}){
  const [q,setQ]=useState('');
  const s=q.trim().toLowerCase();
  const list=items.filter(a=>!s||(a.id+a.name+(a.description||'')).toLowerCase().includes(s));
  const picked=items.filter(a=>sel.has(a.id)).length;
  const bulk=on=>setSel(prev=>{const n=new Set(prev);list.forEach(a=>on?n.add(a.id):n.delete(a.id));return n});
  const toggle=id=>setSel(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n});
  return <section className={'lv-es-group'+(tone?' '+tone:'')}>
    <header><h3>{title}<em>{picked}/{items.length}</em></h3>
      {items.length>0&&<div className="lv-es-bulk"><label className="lv-es-search"><MagnifyingGlass size={13}/><input aria-label={'搜尋'+title} placeholder="搜尋" value={q} onChange={e=>setQ(e.target.value)}/></label>
        <button type="button" onClick={()=>bulk(true)}>全選</button><button type="button" onClick={()=>bulk(false)}>全不選</button></div>}</header>
    {items.length?<div className="lv-es-acts">{list.map(a=><label key={a.id} className="lv-es-act"><input type="checkbox" checked={sel.has(a.id)} onChange={()=>toggle(a.id)}/><span><b>{a.name||a.id}</b>{a.description&&<small>{a.description}</small>}</span></label>)}{!list.length&&<p className="lv-es-none">沒有符合的動作</p>}</div>
      :<p className="lv-es-none">{empty}</p>}
  </section>;
}

function ScopeCard({auth,preview,loading,err}){
  if(auth!=='oauth2')return null;
  return <aside className="lv-es-scopes" aria-live="polite"><h3>將向使用者要求的權限</h3>
    {preview?.grants_write&&<div className="lv-es-warn"><ShieldWarning size={16}/><div><b>此設定包含寫入權限</b><span>使用者授權時將同意此服務對其帳號進行修改。</span></div></div>}
    {err?<p className="lv-es-none">無法預覽權限：{err}</p>:!preview?<p className="lv-es-none">{loading?'計算中…':'選擇動作後會顯示所需權限。'}</p>:<>
      {preview.data_scopes?.length?<div className="lv-es-chips">{preview.data_scopes.map(x=><span key={x} className="lv-es-chip">{x}</span>)}</div>:<p className="lv-es-none">不需要額外的資料權限。</p>}
      {preview.identity_scopes?.length>0&&<><h4>身分識別（僅用於辨識帳號）</h4><div className="lv-es-chips">{preview.identity_scopes.map(x=><span key={x} className="lv-es-chip muted">{x}</span>)}</div></>}
      <p className="lv-es-hint">共 {preview.data_scopes?.length||0} 項資料權限{loading?'（更新中…）':''}</p></>}
  </aside>;
}

export default function EnableService({service,connectorId,me,notify,onBack,onDone}){
  const edit=!!connectorId;
  const [setup,setSetup]=useState(null),[existing,setExisting]=useState(null),[loadErr,setLoadErr]=useState('');
  const [step,setStep]=useState(0),[reached,setReached]=useState(0);
  const [label,setLabel]=useState(''),[desc,setDesc]=useState(''),[showDesc,setShowDesc]=useState(false);
  const [authType,setAuthType]=useState(''),[vals,setVals]=useState({});
  const [sel,setSel]=useState(()=>new Set());
  const [share,setShare]=useState(emptyShare()),[sharing,setSharing]=useState(false);
  const [err,setErr]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
  const [preview,setPreview]=useState(null),[pvLoading,setPvLoading]=useState(false),[pvErr,setPvErr]=useState('');
  const topRef=useRef(null);

  useEffect(()=>{
    let live=true;
    (async()=>{
      try{
        const [s,c]=await Promise.all([api.gatewaySetup(service),edit?api.getConnector(connectorId):null]);
        if(!live)return;
        setSetup(s);setExisting(c);
        const opts=s.auth_options||[];
        if(c){
          setLabel(c.label||s.name);setDesc(c.config?.description||'');setShowDesc(!!c.config?.description);
          setAuthType(c.config?.auth_mode||opts[0]?.type||'');setSel(new Set(c.config?.allowed_actions||[]));setShare(c.share||emptyShare());
        }else{
          setLabel(s.name);setAuthType(opts[0]?.type||'no_auth');
          setSel(new Set((s.actions||[]).filter(a=>a.operation==='read').map(a=>a.id)));
        }
      }catch(e){if(live)setLoadErr(msg(e))}
    })();
    return()=>{live=false};
  },[service,connectorId]);// eslint-disable-line

  const opts=setup?.auth_options||[];
  const option=opts.find(o=>o.type===authType)||null;
  const actions=setup?.actions||[];
  const byOp=op=>actions.filter(a=>a.operation===op);
  const count=op=>byOp(op).filter(a=>sel.has(a.id)).length;
  const oc=setup?.oauth_client;
  const optionalClient=authType==='oauth2'&&(oc?.configured||edit);
  const fieldOptional=f=>edit||optionalClient;
  const setVal=(k,v)=>setVals(x=>({...x,[authType]:{...(x[authType]||{}),[k]:v}}));
  const cur=vals[authType]||{};

  const selKey=[...sel].sort().join(',');
  useEffect(()=>{
    if(authType!=='oauth2'||!setup)return;
    if(!sel.size){setPreview(null);setPvErr('');return}
    let live=true;setPvLoading(true);
    const t=setTimeout(()=>{
      api.previewScopes({service,allowed_actions:[...sel]}).then(r=>{if(live){setPreview(r);setPvErr('')}}).catch(e=>{if(live)setPvErr(msg(e))}).finally(()=>live&&setPvLoading(false));
    },300);
    return()=>{live=false;clearTimeout(t)};
  },[selKey,authType,setup,service]);// eslint-disable-line

  const go=i=>{setStep(i);setReached(r=>Math.max(r,i));topRef.current?.scrollIntoView?.({block:'start'})};
  const copy=async()=>{try{await navigator.clipboard.writeText(oc.expected_redirect_uri);setCopied(true);setTimeout(()=>setCopied(false),1500)}catch{notify('無法複製，請手動選取')}};

  const validate=()=>{
    if(!label.trim())return [0,'請填寫名稱'];
    if(!edit&&option){
      const miss=oc?.platform&&authType==='oauth2'?[]:(option.fields||[]).filter(f=>f.required&&!fieldOptional(f)&&!(cur[f.key]||'').trim());
      if(miss.length)return [0,'必填欄位：'+miss.map(f=>f.label).join('、')];
    }
    if(!sel.size)return [2,'請至少開放一個動作'];
    return null;
  };
  const submit=async()=>{
    setErr('');
    const bad=validate();
    if(bad){setErr(bad[1]);go(bad[0]);return}
    setBusy(true);
    const filled=Object.fromEntries(Object.entries(cur).filter(([,v])=>String(v).trim()!==''));
    const common={label:label.trim(),description:desc.trim(),allowed_actions:[...sel],...(authType==='oauth2'?{client:filled}:{credentials:filled})};
    try{
      let c;
      if(edit){
        c=await api.updateEnabledService(connectorId,{...common,description:desc.trim()});
        if(JSON.stringify(share)!==JSON.stringify(existing?.share||emptyShare()))c=await api.shareConnector(connectorId,share);
      }else c=await api.enableService({service,auth_mode:authType,share,...common});
      notify(edit?'連接器已儲存':`已啟用 ${setup.name}`);
      onDone?.(c);
    }catch(e){setErr(msg(e));topRef.current?.scrollIntoView?.({block:'start'})}finally{setBusy(false)}
  };

  if(loadErr)return <div className="lv-es"><button className="lv-p-back" onClick={onBack}><ArrowLeft size={14}/>返回連接器</button><Banner icon={<Warning size={16}/>}>無法載入服務設定：{loadErr}</Banner></div>;
  if(!setup||(edit&&!existing))return <div className="lv-es"><Loading/></div>;

  const title=(edit?'編輯 ':'啟用 ')+setup.name;
  const dis=busy;
  const owner=me?.email||'你';
  return <div className="lv-es" ref={topRef}>
    <button className="lv-p-back" onClick={onBack}><ArrowLeft size={14}/>返回連接器</button>
    <header className="lv-es-head"><ProviderIcon service={service} name={setup.name} size={44}/><div><h1>{title}</h1><span className="lv-p-meta">{service}</span></div></header>
    {err&&<div className="lv-es-error" role="alert"><Warning size={16}/><div><b>無法完成{edit?'儲存':'啟用'}</b><span>{err}</span></div></div>}
    <div className="lv-es-body">
      <div className="lv-es-steps" role="navigation" aria-label="設定步驟"><ol>{STEPS.map((t,i)=><li key={t}><button type="button" disabled={i>reached} aria-current={i===step?'step':undefined} className={(i===step?'on ':'')+(i<reached&&i!==step?'done':'')} onClick={()=>go(i)}><span className="lv-es-num">{i<step?<Check size={12} weight="bold"/>:i+1}</span><span className="lv-es-st">{t}</span></button></li>)}</ol></div>
      <div className="lv-es-panel">
        {step===0&&<div className="lv-es-sec">
          <h2>連接詳細資訊</h2>
          <div className="lv-es-field"><label htmlFor="es-label">名稱<span className="lv-es-req"> *</span></label><input id="es-label" type="text" value={label} onChange={e=>setLabel(e.target.value)}/></div>
          {showDesc?<div className="lv-es-field"><label htmlFor="es-desc">說明</label><textarea id="es-desc" rows={3} value={desc} placeholder="這個連接器的用途" onChange={e=>setDesc(e.target.value)}/></div>
            :<button type="button" className="lv-es-link" onClick={()=>setShowDesc(true)}>+ 新增說明</button>}
          <div className="lv-es-field"><label htmlFor="es-auth">授權方式</label>
            {edit?<div className="lv-es-ro" id="es-auth">{AUTH_LABEL[authType]||authType}</div>
              :<select id="es-auth" value={authType} onChange={e=>setAuthType(e.target.value)}>{opts.map(o=><option key={o.type} value={o.type}>{AUTH_LABEL[o.type]||o.label||o.type}</option>)}</select>}
            {option?.description&&<span className="lv-es-hint">{option.description}</span>}
            {edit&&<span className="lv-es-hint">授權方式建立後無法變更。</span>}</div>
          {authType==='oauth2'&&oc?.expected_redirect_uri&&!oc.platform&&<div className="lv-es-field"><label>重新導向網址</label>
            <div className="lv-es-copy"><code>{oc.expected_redirect_uri}</code><button type="button" className="btn sm" onClick={copy}>{copied?<Check size={13}/>:<Copy size={13}/>}{copied?'已複製':'複製'}</button></div>
            <span className="lv-es-hint">請在 {setup.name} 的開發者後台，將此網址登錄為授權的重新導向 URI（Authorized redirect URI）。</span></div>}
          {authType==='no_auth'?<div className="lv-es-info"><Info size={16}/>不需要其他憑證。</div>
            :authType==='oauth2'&&oc?.platform&&!edit?<div className="lv-es-info"><Info size={16}/>使用平台統一的 {setup.name} 授權應用程式，不需再填寫 Client ID 與密鑰。使用者之後按「連線我的帳號」即可開啟登入畫面。</div>
            :(option?.fields||[]).map(f=><CredField key={f.key} f={f} value={cur[f.key]} onChange={v=>setVal(f.key,v)} optional={fieldOptional(f)} hint={'（已設定，留空沿用）'}/>)}
          {authType==='oauth2'&&oc&&!oc.configured&&!edit&&<p className="lv-es-hint">尚未設定此服務的 OAuth 用戶端，請填入向 {setup.name} 申請的 Client ID 與密鑰。</p>}
          {(option?.fields||[]).some(f=>f.secret||f.inputType==='password')&&<p className="lv-es-note"><Lock size={13}/>憑證直接存入連接器閘道並加密，本平台不保存。</p>}
        </div>}
        {step===1&&<div className="lv-es-sec">
          <h2>管理寫入許可</h2>
          <div className="lv-es-info"><Info size={16}/>預設不開放寫入。開放後，建議在 Agent 流程中將寫入動作放在核准節點之後。</div>
          {!byOp('write').length&&!byOp('destructive').length&&<p className="lv-es-none">此服務沒有寫入類動作。</p>}
          {byOp('write').length>0&&<ActionGroup title="寫入" items={byOp('write')} sel={sel} setSel={setSel}/>}
          {byOp('destructive').length>0&&<ActionGroup title="破壞性" tone="danger" items={byOp('destructive')} sel={sel} setSel={setSel}/>}
        </div>}
        {step===2&&<div className="lv-es-sec lv-es-split"><div>
          <h2>管理讀取許可</h2>
          <ActionGroup title="讀取" items={byOp('read')} sel={sel} setSel={setSel} empty="此服務沒有讀取類動作。"/></div>
          <ScopeCard auth={authType} preview={preview} loading={pvLoading} err={pvErr}/></div>}
        {step===3&&<div className="lv-es-sec">
          <h2>分享與完成</h2>
          <div className="lv-es-field"><label>分享對象</label><div><ShareChip share={share} onClick={()=>setSharing(true)}/></div>
            <span className="lv-es-hint">{authType==='oauth2'?'分享後，被分享者可在「我的連線」授權自己的帳號。':'分享後，被分享者可直接使用（以管理員保管的憑證執行）。'}</span></div>
          <dl className="lv-es-sum">
            <dt>服務</dt><dd>{setup.name}</dd><dt>名稱</dt><dd>{label||'—'}</dd>{desc&&<><dt>說明</dt><dd>{desc}</dd></>}
            <dt>授權方式</dt><dd>{AUTH_LABEL[authType]||authType}</dd>
            <dt>開放動作</dt><dd>{OPS.map(([k,l])=><span key={k} className={'lv-es-count'+(k==='destructive'&&count(k)?' danger':k==='write'&&count(k)?' warn':'')}>{l} {count(k)}/{byOp(k).length}</span>)}</dd>
            <dt>分享給</dt><dd>{shareSummary(share)}</dd></dl>
          {authType==='oauth2'&&<ScopeCard auth={authType} preview={preview} loading={pvLoading} err={pvErr}/>}
        </div>}
      </div>
    </div>
    <footer className="lv-es-foot"><button className="btn" disabled={dis} onClick={onBack}>取消</button><span className="grow"/>
      {step>0&&<button className="btn" disabled={dis} onClick={()=>go(step-1)}>上一步</button>}
      {step<3?<button className="btn primary" onClick={()=>go(step+1)}>下一步</button>:<button className="btn primary" disabled={dis} onClick={submit}>{busy?(edit?'儲存中…':'啟用中…'):edit?'儲存':'啟用'}</button>}
    </footer>
    {sharing&&<ShareDialog title={label||setup.name} value={share} owner={owner} onClose={()=>setSharing(false)} onDone={s=>{setShare(s);setSharing(false)}}/>}
  </div>;
}
