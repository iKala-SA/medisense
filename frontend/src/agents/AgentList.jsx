import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Plus,MagnifyingGlass,DotsThree,Chat,PencilSimple,Copy,DownloadSimple,Export,Trash,Sparkle,FileArrowUp,FilePlus,ListChecks,Cube} from '@phosphor-icons/react';
import {api} from '../api';
import {ShareDialog} from '../live/ShareLive';
import {canEditAgent,errText,isMine} from '../live/kit';
import {agentToIn,blankAgent} from './stepkit';

const TABS=[['all','全部'],['mine','我的'],['published','已發布']];
const ago=t=>{if(!t)return '';const d=new Date(t);if(isNaN(d))return '';const m=(Date.now()-d)/60000;return m<1?'剛剛':m<60?`${Math.round(m)} 分鐘前`:m<1440?`${Math.round(m/60)} 小時前`:`${Math.round(m/1440)} 天前`};
const download=(name,obj)=>{const u=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u)};

function Row({flow,a,me,onOpen,onChat,onDup,onShare,onDelete}){
  const [menu,setMenu]=useState(false),edit=canEditAgent(a,me),mine=isMine(a,me),pub=a.status==='published';
  const st=a.review?.state==='pending'?['待審核','warn']:a.review?.state==='rejected'?['已退回','bad']:pub?[`已發布 v${a.version}`,'ok']:['草稿',''];
  return <div className="ag-row2" role="row">
    <button className="nm" onClick={flow?onOpen:edit?onOpen:pub?onChat:undefined}><span className="ag-icon-tile">{a.icon||<Cube size={20}/>}</span>
      <span className="tx"><b title={a.name}>{a.name}</b><small>{a.description||'（尚無說明）'}</small>
        {(a.steps?.length>0||a.capabilities?.web_search||a.capabilities?.connectors?.length>0)&&<span className="tags">{a.steps?.length>0&&<span className="ag-chip"><ListChecks size={12}/>{a.steps.length} 步流程</span>}{a.capabilities?.web_search&&<span className="ag-chip">網路搜尋</span>}{a.capabilities?.connectors?.length>0&&<span className="ag-chip">{a.capabilities.connectors.length} 個連接器</span>}</span>}</span></button>
    <span className="st"><span className={'ag-badge '+st[1]}>{st[0]}</span></span>
    <span className="own">{mine?'我':(a.owner_email||'').split('@')[0]}</span><span className="when">{ago(a.updated_at)}</span>
    <span className="act">{pub&&!flow&&<button className="ag-btn primary" onClick={onChat}><Chat size={15}/>對話</button>}{edit?<button className="ag-btn" onClick={onOpen}>編輯</button>:flow&&<button className="ag-btn primary" onClick={onOpen}>執行</button>}
      <span className="ag-menuwrap"><button className="ag-icon" aria-label={`「${a.name}」的更多選項`} aria-haspopup="menu" onClick={()=>setMenu(m=>!m)}><DotsThree size={20} weight="bold"/></button>
        {menu&&<><div className="ag-dismiss" onClick={()=>setMenu(false)}/><div className="ag-menu" role="menu" onClick={()=>setMenu(false)}>
          {edit&&<button role="menuitem" onClick={onOpen}><PencilSimple size={16}/>編輯</button>}
          {pub&&!flow&&<button role="menuitem" onClick={onChat}><Chat size={16}/>開始對話</button>}
          <button role="menuitem" onClick={onDup}><Copy size={16}/>複製為新草稿</button>
          <button role="menuitem" onClick={()=>download(a.name+'.json',agentToIn(a))}><DownloadSimple size={16}/>匯出 JSON</button>
          {edit&&<button role="menuitem" onClick={onShare}><Export size={16}/>分享</button>}
          {edit&&<><hr/><button role="menuitem" className="danger" onClick={onDelete}><Trash size={16}/>刪除</button></>}</div></>}</span></span>
  </div>;
}

const kindOf=a=>a.kind||(a.steps?.length?'flow':'agent');
export default function AgentList({kind='agent',me,notify,onOpen,onCreateChat,onChat,refreshKey}){
  const flow=kind==='flow',noun=flow?'流程':'Agent';
  const builder=me.role==='admin'||me.role==='builder';
  const [agents,setAgents]=useState(null),[err,setErr]=useState(''),[q,setQ]=useState(''),[tab,setTab]=useState('all'),[sharing,setSharing]=useState(null),[create,setCreate]=useState(false),[busy,setBusy]=useState(false);
  const file=useRef(null);
  const load=()=>api.listAgents().then(l=>{l=l.filter(a=>kindOf(a)===kind);setAgents(builder?l:l.filter(a=>a.status==='published'));setErr('')}).catch(e=>{setAgents([]);setErr(errText(e))});
  useEffect(()=>{load()},[refreshKey]);// eslint-disable-line
  const shown=useMemo(()=>{const n=q.trim().toLowerCase();return (agents||[]).filter(a=>tab==='all'||(tab==='mine'?isMine(a,me):a.status==='published'))
    .filter(a=>!n||[a.name,a.description,a.owner_email].some(t=>(t||'').toLowerCase().includes(n)))},[agents,tab,q,me.uid]);
  const blank=async()=>{setBusy(true);try{const a=await api.createAgent(blankAgent(kind));onOpen(a.id)}catch(e){notify(errText(e));setBusy(false)}};
  const importJson=async f=>{
    try{const j=JSON.parse(await f.text());if(!j||typeof j!=='object'||!j.name)throw new Error('檔案不是 Agent 定義（缺少 name）');
      const {share,...rest}=j;const a=await api.createAgent({...blankAgent(kind),...rest,kind,name:String(rest.name).slice(0,50)});notify('已匯入為新草稿');onOpen(a.id)}
    catch(e){notify('匯入失敗：'+errText(e))}
  };
  const dup=async a=>{try{const n=await api.createAgent({...agentToIn(a),name:(a.name+' (複本)').slice(0,50)});notify('已複製為新草稿');load();onOpen(n.id)}catch(e){notify(errText(e))}};
  const del=async a=>{if(!window.confirm(`刪除「${a.name}」？此動作無法復原。`))return;try{await api.deleteAgent(a.id);setAgents(l=>l.filter(x=>x.id!==a.id))}catch(e){notify(errText(e))}};
  const sharingAgent=sharing&&agents?.find(x=>x.id===sharing);
  return <div className="ag-catalog">
    <header className="ag-lhead"><div><h1>{noun}</h1><p>{flow?'把固定的工作做成流程：輸入、查資料、產出、寄送，一次設定，反覆執行。':'探索專科助理，或建立你自己的 Agent。'}</p></div>
      {builder&&<div className="ag-menuwrap"><button className="ag-btn primary" disabled={busy} onClick={()=>setCreate(c=>!c)}><Plus size={16}/>建立{flow?'':' '}{noun}</button>
        {create&&<><div className="ag-dismiss" onClick={()=>setCreate(false)}/><div className="ag-menu wide" role="menu" onClick={()=>setCreate(false)}>
          <button role="menuitem" onClick={onCreateChat}><Sparkle size={17}/><span><b>用對話建立</b><small>{flow?'描述你要的流程，系統產生步驟草稿':'描述你要的助理，系統產生設定草稿'}</small></span></button>
          <button role="menuitem" onClick={blank}><FilePlus size={17}/><span><b>空白建立</b><small>從空白表單開始</small></span></button>
          <button role="menuitem" onClick={()=>file.current?.click()}><FileArrowUp size={17}/><span><b>匯入 JSON</b><small>匯入匯出的定義檔</small></span></button></div></>}
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={e=>{e.target.files[0]&&importJson(e.target.files[0]);e.target.value=''}}/></div>}</header>
    <div className="ag-toolbar"><label className="ag-search"><MagnifyingGlass size={16}/><input aria-label="搜尋" placeholder={`搜尋${noun}、說明或負責人`} value={q} onChange={e=>setQ(e.target.value)}/></label>
      <div className="ag-seg">{TABS.map(([v,l])=><button key={v} className={tab===v?'on':''} onClick={()=>setTab(v)}>{l}</button>)}</div></div>
    {agents===null?<p className="ag-muted center">載入中…</p>
      :err&&!agents.length?<p className="ag-muted center">無法載入{noun}：{err}<br/><button className="ag-link" onClick={()=>{setAgents(null);load()}}>重試</button></p>
      :!shown.length?<p className="ag-muted center">{agents.length?`沒有符合的${noun}`:builder?`還沒有${noun}。按「建立${flow?'':' '}${noun}」開始。`:`目前沒有已發布的${noun}。`}</p>
      :<div className="ag-rows" role="table"><div className="ag-rowh" role="row"><span>名稱</span><span>狀態</span><span>負責人</span><span>更新</span><span/></div>{shown.map(a=><Row key={a.id} flow={flow} a={a} me={me} onOpen={()=>onOpen(a.id)} onChat={()=>onChat(a)} onDup={()=>dup(a)} onShare={()=>setSharing(a.id)} onDelete={()=>del(a)}/>)}</div>}
    {sharingAgent&&<ShareDialog title={sharingAgent.name} value={sharingAgent.share} owner={sharingAgent.owner_email} onClose={()=>setSharing(null)} onDone={async v=>{try{const r=await api.shareAgent(sharingAgent.id,v);setAgents(l=>l.map(x=>x.id===sharingAgent.id?{...x,share:r?.share||v}:x));notify('已更新分享設定');setSharing(null)}catch(e){notify(errText(e))}}}/>}
  </div>;
}
