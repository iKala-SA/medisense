import React,{useEffect,useRef,useState} from 'react';
import {MagnifyingGlass,X,CaretDown,CaretUp,Warning,ArrowSquareOut} from '@phosphor-icons/react';
import ProviderIcon from './ProviderIcon';
import {api} from '../api';
import {errText,Loading,Banner} from './pkit';
import './gatewaycatalog.css';

const AUTH={oauth2:'OAuth',api_key:'API Key',custom_credential:'自訂憑證',no_auth:'免授權'};
const AUTH_ORDER=['oauth2','api_key','custom_credential','no_auth'];
const PAGE=48;
const fmt=n=>(n??0).toLocaleString('en-US');
const catLabel=id=>String(id).replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

const SvcIcon=({svc,name,url,homepage})=><ProviderIcon service={svc} name={name} iconUrl={url} homepage={homepage}/>;
const AuthBadges=({types})=><>{(types||[]).map(a=><span key={a} className="lv-gc-auth">{AUTH[a]||a}</span>)}</>;

const GROUPS=[['read','讀取'],['write','寫入'],['destructive','破壞性']];
function Detail({service,admin,onClose,onSetup,onEnable,onEdit}){
  const [d,setD]=useState(null),[err,setErr]=useState(''),[q,setQ]=useState(''),[open,setOpen]=useState({read:true});
  useEffect(()=>{let live=true;api.gatewayProvider(service.service).then(r=>live&&setD(r)).catch(e=>live&&setErr(errText(e)));return()=>{live=false}},[service.service]);
  useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
  const s=q.trim().toLowerCase();
  const info=d||service;
  return <div className="lv-gc-side" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="lv-gc-panel" role="dialog" aria-modal="true" aria-label={service.name}>
    <button type="button" className="icon-btn modal-close" aria-label="關閉" onClick={onClose}><X/></button>
    <div className="lv-gc-head"><SvcIcon svc={service.service} name={service.name} url={service.icon_url} homepage={info.homepage||service.homepage}/><div><h2>{info.name||service.name}</h2><span className="lv-p-meta">{service.service}</span></div></div>
    {info.homepage&&<a href={info.homepage} target="_blank" rel="noreferrer" style={{color:'#239660',fontSize:13,display:'inline-flex',gap:5,alignItems:'center',overflowWrap:'anywhere'}}><ArrowSquareOut size={14}/>{info.homepage}</a>}
    <div className="lv-gc-tags">{(info.categories||[]).map(c=><span key={c} className="lv-gc-tag">{catLabel(c)}</span>)}<AuthBadges types={info.auth_types}/></div>
    {err?<Banner icon={<Warning size={16}/>}>無法載入服務詳情：{err}</Banner>:!d?<Loading/>:<>
      <div className="lv-gc-nums"><span className="badge">動作 {d.action_count}（可執行 {d.executable_count}）</span><span className="badge">觸發器 {d.trigger_count}</span></div>
      {d.actions?.length>0&&<label className="search" style={{minWidth:0,height:36}}><MagnifyingGlass size={14}/><input aria-label="搜尋動作" placeholder="搜尋動作" value={q} onChange={e=>setQ(e.target.value)}/></label>}
      {GROUPS.map(([k,label])=>{
        const all=(d.actions||[]).filter(a=>a.operation===k),list=all.filter(a=>!s||(a.id+a.name+(a.description||'')).toLowerCase().includes(s));
        if(!all.length)return null;
        const isOpen=s?list.length>0:!!open[k];
        return <div key={k} className="lv-gc-grp"><button type="button" aria-expanded={isOpen} onClick={()=>setOpen(o=>({...o,[k]:!o[k]}))}><span>{label}（{s?`${list.length}/`:''}{all.length}）</span>{isOpen?<CaretUp size={14}/>:<CaretDown size={14}/>}</button>
          {isOpen&&<div className="lv-gc-list">{list.map(a=><div key={a.id} className="lv-gc-act"><b>{a.name||a.id}</b>{a.description&&<span>{a.description}</span>}</div>)}{!list.length&&<div className="lv-gc-act"><span>沒有符合的動作</span></div>}</div>}</div>})}
    </>}
    <div className="lv-gc-pfoot">{(()=>{
      const et=info.enabled_type??service.enabled_type,cid=info.connector_id??service.connector_id;
      if(!admin)return <div className="lv-gc-note">{et?'此服務已由管理員啟用，可在「常用連接器」或「我的連線」使用。':'此服務尚未啟用，需由管理員啟用後才能使用。'}</div>;
      if(et==='calendar')return <button className="btn primary" onClick={()=>onSetup(et)}>前往設定</button>;
      if(et==='gateway')return <button className="btn primary" onClick={()=>onEdit(service.service,cid)}>編輯連接器</button>;
      return <button className="btn primary" onClick={()=>onEnable(service.service)}>啟用此服務</button>;
    })()}</div>
  </section></div>;
}

export default function GatewayCatalog({admin,onSetup,onEnable,onEdit,groups,query=''}){
  const curated=groups?groups.flatMap(g=>g.services).join(','):'';
  const [q,setQ]=useState(query),[cat,setCat]=useState(''),[auth,setAuth]=useState(''),[enOnly,setEnOnly]=useState(false);
  const [items,setItems]=useState([]),[meta,setMeta]=useState(null),[facets,setFacets]=useState(null),[busy,setBusy]=useState(true),[err,setErr]=useState(null),[sel,setSel]=useState(null);
  const seq=useRef(0);
  useEffect(()=>{const t=setTimeout(()=>setQ(query.trim()),300);return()=>clearTimeout(t)},[query]);
  const fetchPage=async(offset,append)=>{
    const id=++seq.current;setBusy(true);setErr(null);
    try{
      const r=await api.gatewayCatalog({q,category:cat,auth,enabled_only:enOnly?'true':'',services:curated,offset,limit:curated?200:PAGE});
      if(id!==seq.current)return;
      setItems(a=>append?[...a,...r.items]:r.items);setMeta({total:r.total,gateway_total:r.gateway_total});
      setFacets(f=>(!f||!append)?r.facets:f);
    }catch(e){if(id!==seq.current)return;setErr(errText(e));if(!append)setItems([])}
    finally{if(id===seq.current)setBusy(false)}
  };
  useEffect(()=>{fetchPage(0,false)},[q,cat,auth,enOnly]);// eslint-disable-line
  const cats=facets?.categories||[],top=cats.slice(0,10),authCount=Object.fromEntries((facets?.auth||[]).map(a=>[a.id,a.count]));
  const card=it=><div key={it.service} className="lv-gc-card" role="button" tabIndex={0} onClick={()=>setSel(it)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSel(it)}}}>
      <div className="lv-gc-head"><SvcIcon svc={it.service} name={it.name} url={it.icon_url} homepage={it.homepage}/><div><h3 title={it.name}>{it.name}</h3></div></div>
      <div className="lv-gc-tags">{(it.categories||[]).slice(0,2).map(c=><span key={c} className="lv-gc-tag">{catLabel(c)}</span>)}</div>
      <div className="lv-gc-foot"><div className="lv-gc-tags"><AuthBadges types={it.auth_types}/></div>
        {it.enabled_type?<span className="lv-p-status ok"><i/>已啟用</span>:<span className="lv-p-status"><i/>尚未啟用</span>}</div>
    </div>;
  const unreachable=err&&/^50[23]/.test(err);
  return <div className="lv-gc">
    <div className="lv-gc-bar">
      <label className="lv-gc-toggle"><input type="checkbox" role="switch" checked={enOnly} onChange={e=>setEnOnly(e.target.checked)}/>只看已啟用</label>
    </div>
    {!groups&&<><div className="lv-gc-chips" aria-label="分類">
      <button className={'lv-gc-chip'+(!cat?' on':'')} onClick={()=>setCat('')}>全部</button>
      {top.map(c=><button key={c.id} className={'lv-gc-chip'+(cat===c.id?' on':'')} onClick={()=>setCat(c.id)}>{catLabel(c.id)}<em>{fmt(c.count)}</em></button>)}
      {cats.length>0&&<select aria-label="更多分類" value={cat} onChange={e=>setCat(e.target.value)}><option value="">更多分類</option>{cats.map(c=><option key={c.id} value={c.id}>{catLabel(c.id)}（{fmt(c.count)}）</option>)}</select>}
    </div>
    <div className="lv-gc-chips" aria-label="授權方式">
      <button className={'lv-gc-chip'+(!auth?' on':'')} onClick={()=>setAuth('')}>全部</button>
      {AUTH_ORDER.map(a=><button key={a} className={'lv-gc-chip'+(auth===a?' on':'')} onClick={()=>setAuth(a)}>{AUTH[a]}{authCount[a]!=null&&<em>{fmt(authCount[a])}</em>}</button>)}
    </div></>}
    {unreachable&&<Banner icon={<Warning size={16}/>}>目前無法連線到連接器閘道（Open Connector gateway），可能尚未設定或暫時無法使用。請稍後再試，或聯絡管理員。<div className="lv-p-meta">{err}</div></Banner>}
    {err&&!unreachable&&<Banner icon={<Warning size={16}/>}>無法載入服務目錄：{err}</Banner>}
    {meta&&!err&&!groups&&<div className="lv-gc-count">共 {fmt(meta.total)} 項</div>}
    {groups?groups.map(g=>{const list=g.services.map(id=>items.find(i=>i.service===id)).filter(Boolean);return list.length?<section key={g.title}><h2 className="lv-gc-group">{g.title}</h2><div className="lv-gc-grid">{list.map(card)}</div></section>:null}):items.length>0&&<div className="lv-gc-grid">{items.map(card)}</div>}
    {busy&&<Loading/>}
    {!busy&&!err&&meta&&!items.length&&<div className="lv-gc-state">沒有符合的服務</div>}
    {!busy&&!groups&&meta&&items.length<meta.total&&<div className="lv-gc-more"><button className="btn" onClick={()=>fetchPage(items.length,true)}>載入更多</button></div>}
    {sel&&<Detail service={sel} admin={admin} onClose={()=>setSel(null)} onSetup={t=>{setSel(null);onSetup(t)}} onEnable={x=>{setSel(null);onEnable(x)}} onEdit={(x,id)=>{setSel(null);onEdit(x,id)}}/>}
  </div>;
}
