import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,CaretDown,CaretRight,Check,CircleNotch,Warning,DotsThree,Info,X,TextB,TextItalic,TextStrikethrough,ListBullets,ListNumbers,Code,Quotes,ArrowCounterClockwise,ArrowClockwise,
  Sparkle,UploadSimple,FileText,Plus,Trash,Copy,DownloadSimple,Eye,PaperPlaneRight,BookOpen,Plugs,Database,Sliders,SlidersHorizontal,ArrowsClockwise,Globe,Lock} from '@phosphor-icons/react';
import {api} from '../api';
import {ShareDialog} from '../live/ShareLive';
import {PublishTab,VersionsTab} from '../live/PublishTab';
import {statusBadges,errText} from '../live/kit';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useAgentDoc from './useAgentDoc';
import {agentToIn} from './stepkit';
import '../live/agents.css';

const clock=d=>d?new Date(d).toLocaleTimeString('zh-TW',{hour:'numeric',minute:'2-digit',hour12:true}):'';
const download=(name,obj)=>{const u=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const x=document.createElement('a');x.href=u;x.download=name;x.click();URL.revokeObjectURL(u)};
const DEPTS=['內科部','外科部','急診醫學部','心臟血管中心','神經醫學中心','新陳代謝科','放射線部','護理部','藥劑部','感染管制中心','臨床試驗與轉譯研究中心','智慧醫療組 (IT)'];
const Switch=({on,onChange,disabled,label})=><button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={'ag-switch'+(on?' on':'')} onClick={()=>onChange(!on)}><span/></button>;
const Seg=({value,onChange,options,disabled})=><div className="ag-seg" role="radiogroup">{options.map(([v,l])=><button key={v} type="button" role="radio" aria-checked={value===v} disabled={disabled} className={value===v?'on':''} onClick={()=>onChange(v)}>{l}</button>)}</div>;

/* markdown toolbar over a plain textarea: the instructions stay plain text the model reads as-is */
function Instructions({value,onChange,disabled,onImprove,improving}){
  const ta=useRef(null),hist=useRef([]),fut=useRef([]);
  const set=(v,keep=false)=>{if(!keep){hist.current.push(value);fut.current=[]}onChange(v)};
  const wrap=(pre,post=pre,block=false)=>{
    const el=ta.current;if(!el||disabled)return;const s=el.selectionStart,e=el.selectionEnd,sel=value.slice(s,e)||'文字';
    let out;if(block){const ls=value.lastIndexOf('\n',s-1)+1;out=value.slice(0,ls)+pre+value.slice(ls);setTimeout(()=>{el.focus();el.setSelectionRange(s+pre.length,e+pre.length)})}
    else{out=value.slice(0,s)+pre+sel+post+value.slice(e);setTimeout(()=>{el.focus();el.setSelectionRange(s+pre.length,s+pre.length+sel.length)})}
    set(out);
  };
  const undo=()=>{if(!hist.current.length)return;fut.current.push(value);onChange(hist.current.pop())},redo=()=>{if(!fut.current.length)return;hist.current.push(value);onChange(fut.current.pop())};
  const B=({t,onClick,children})=><button type="button" title={t} aria-label={t} disabled={disabled} onClick={onClick}>{children}</button>;
  return <div className="ad-editor">
    <div className="ad-tools" role="toolbar" aria-label="格式">
      <B t="粗體" onClick={()=>wrap('**')}><TextB size={16}/></B><B t="斜體" onClick={()=>wrap('*')}><TextItalic size={16}/></B><B t="刪除線" onClick={()=>wrap('~~')}><TextStrikethrough size={16}/></B><i/>
      <B t="標題 1" onClick={()=>wrap('# ','',true)}><b>T<sub>1</sub></b></B><B t="標題 2" onClick={()=>wrap('## ','',true)}><b>T<sub>2</sub></b></B><B t="標題 3" onClick={()=>wrap('### ','',true)}><b>T<sub>3</sub></b></B><i/>
      <B t="項目符號" onClick={()=>wrap('- ','',true)}><ListBullets size={16}/></B><B t="編號清單" onClick={()=>wrap('1. ','',true)}><ListNumbers size={16}/></B><B t="程式碼" onClick={()=>wrap('`')}><Code size={16}/></B><B t="引用" onClick={()=>wrap('> ','',true)}><Quotes size={16}/></B>
      <span className="sp"/><B t="復原" onClick={undo}><ArrowCounterClockwise size={16}/></B><B t="重做" onClick={redo}><ArrowClockwise size={16}/></B></div>
    <textarea ref={ta} rows={11} maxLength={8000} disabled={disabled} value={value} placeholder="這個 Agent 的身分、語氣、工作方式、一步一步怎麼引導使用者、禁止事項…" onChange={e=>set(e.target.value)} aria-label="代理程式人物角色說明"/>
    <button type="button" className="ad-improve" disabled={disabled||improving||!value.trim()} onClick={onImprove}>{improving?<CircleNotch className="spin" size={15}/>:<Sparkle size={15} weight="fill"/>}改進</button>
  </div>;
}

function Section({title,sub,count,open,onToggle,action,children}){
  return <section className={'ad-sec'+(open?' open':'')}>
    <div className="ad-sech"><button type="button" className="ad-tog" aria-expanded={open} onClick={onToggle}>{open?<CaretDown size={16}/>:<CaretRight size={16}/>}<span><b>{title}{count!=null&&` (${count})`}</b><small>{sub}</small></span></button>{action&&<span className="ad-act">{action}</span>}</div>
    {open&&<div className="ad-secb">{children}</div>}
  </section>;
}

function Preview({a,flush,save,notify,tick}){
  const [msgs,setMsgs]=useState([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),sid=useRef(null),end=useRef(null);
  useEffect(()=>{setMsgs([]);sid.current=null},[tick]);
  useEffect(()=>{end.current?.scrollIntoView({block:'end'})},[msgs,busy]);
  const send=async t=>{
    t=(t??text).trim();if(!t||busy||!a.id)return;setText('');setMsgs(m=>[...m,{role:'user',text:t}]);setBusy(true);
    try{await flush();const r=await api.run(a.id,t,sid.current||undefined,false);sid.current=r.session_id;setMsgs(m=>[...m,{role:'assistant',text:r.reply}])}
    catch(e){setMsgs(m=>[...m,{role:'error',text:errText(e)}])}finally{setBusy(false)}
  };
  return <div className="ad-prev">
    <div className="ad-prevban"><Info size={16}/>您正在預覽 {a.name}。</div>
    <div className="ad-prevbody">
      {!msgs.length?<div className="ad-welcome"><svg width="44" height="44" viewBox="0 0 24 24"><path fill="#239660" d="M12 1c.6 5.6 5.4 10.4 11 11-5.6.6-10.4 5.4-11 11-.6-5.6-5.4-10.4-11-11C6.6 11.4 11.4 6.6 12 1z"/></svg><h2>{a.name}</h2><p>{a.description||'（尚未填寫說明）'}</p></div>
        :<div className="ad-msgs">{msgs.map((m,i)=><div key={i} className={'mc-msg '+m.role}>{m.role==='assistant'?<ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>:m.text}</div>)}{busy&&<div className="mc-msg assistant"><CircleNotch className="spin" size={14}/> 思考中…</div>}<div ref={end}/></div>}
    </div>
    <div className="ad-prevbox"><div className="ad-prevhead">{a.name}<em>預覽</em></div>
      <div className="ad-previn"><textarea rows={2} value={text} placeholder="詢問問題…" onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/>
        <div><button className="ad-pill" disabled>代理程式<CaretDown size={13}/></button><span className="sp"/><button className="ag-icon primary" aria-label="送出" disabled={busy||!text.trim()||save==='saving'} onClick={()=>send()}><PaperPlaneRight size={16} weight="fill"/></button></div></div></div>
    {!msgs.length&&<div className="ad-chips">{a.opening_questions.filter(Boolean).map((q,i)=><button key={i} type="button" onClick={()=>send(q)}><Sparkle size={14}/>{q}</button>)}</div>}
    <button className="ag-icon" aria-label="重新開始預覽" title="重新開始預覽" onClick={()=>{setMsgs([]);sid.current=null}}><ArrowsClockwise size={18}/></button>
    <p className="ad-prevnote">預覽使用目前的草稿，不會影響已發布的版本。</p>
  </div>;
}

export default function AgentDetail({id,me,notify,onBack,onChat,onDeleted}){
  const {a,setA,edit,save,savedAt,flush,canEdit,lib}=useAgentDoc(id,me,notify,onBack);
  const [open,setOpen]=useState({role:true,know:false,act:false,custom:false}),[banner,setBanner]=useState(true),[menu,setMenu]=useState(false),[share,setShare]=useState(false),[pub,setPub]=useState(false),[prompt,setPrompt]=useState(false);
  const [improving,setImproving]=useState(false),[tick,setTick]=useState(0),[stale,setStale]=useState(false),[uploading,setUploading]=useState(false),[pick,setPick]=useState(null),file=useRef(null);
  if(!a)return <div className="ag-loading"><CircleNotch className="spin" size={20}/>載入中…</div>;
  const cap=a.capabilities,dis=!canEdit,tog=k=>setOpen(o=>({...o,[k]:!o[k]}));
  const e2=p=>{setStale(true);edit(p)};
  const setCap=p=>e2({capabilities:{...cap,...p}});
  const status=a.review?.state==='pending'?'待審核':a.review?.state==='rejected'?'已退回':a.status==='published'?`已發布 v${a.version}`:'草稿';
  const docs=a.knowledge_doc_ids||[];
  const improve=async()=>{setImproving(true);try{const r=await api.improveInstructions({name:a.name,description:a.description,instructions:a.instructions});e2({instructions:r.instructions});notify('已改進角色指令，可以再手動調整')}catch(e){notify(errText(e))}finally{setImproving(false)}};
  const upload=async files=>{
    const room=10-docs.length;if(room<=0){notify('最多可以附加 10 份文件');return}
    setUploading(true);
    try{const ids=[];for(const f of [...files].slice(0,room)){const d=await api.uploadDoc(f,'other',a.department||'');ids.push(d.id)}
      e2({knowledge_doc_ids:[...docs,...ids]});notify(`已上傳 ${ids.length} 份文件，將先去識別化再建立索引`)}
    catch(e){notify(errText(e))}finally{setUploading(false)}
  };
  const conns=cap.connectors;const setConn=(i,p)=>setCap({connectors:conns.map((c,j)=>j===i?{...c,...p}:c)});
  return <div className="ad">
    <div className="ad-main">
      <button className="ag-back" onClick={async()=>{await flush();onBack()}}><ArrowLeft size={14}/>所有 Agent</button>
      <header className="ad-head">
        <div className="ad-title"><span className="ad-ic">{a.icon||<Sparkle size={30} weight="fill"/>}</span>
          <div className="grow"><input className="ag-name big" value={a.name} maxLength={50} disabled={dis} aria-label="名稱" onChange={e=>e2({name:e.target.value})}/>
            <textarea className="ad-desc" rows={2} value={a.description||''} maxLength={300} disabled={dis} placeholder="新增說明（顯示在目錄、切換器與對話起始畫面）" aria-label="描述" onChange={e=>e2({description:e.target.value})}/></div></div>
        <div className="ad-tools2"><span className={'ag-save '+save} role="status">{save==='saving'?<><CircleNotch className="spin" size={14}/>儲存中</>:save==='dirty'?'編輯中…':save==='error'?<><Warning size={14}/>未儲存</>:<><Check size={14}/>儲存於 {clock(savedAt)}</>}</span>
          <button className="ag-status" onClick={async()=>{await flush();setPub(true)}}>{status}<CaretDown size={13} weight="bold"/></button>
          <button className="ag-btn big" disabled={dis} onClick={()=>setShare(true)}>分享</button>
          {a.status==='published'?<button className="ag-btn big primary" onClick={()=>onChat(a)}>啟動聊天</button>:<button className="ag-btn big primary" onClick={async()=>{await flush();setPub(true)}}>發布</button>}
          <div className="ag-menuwrap"><button className="ag-icon" aria-label="更多" aria-haspopup="menu" onClick={()=>setMenu(m=>!m)}><DotsThree size={22} weight="bold"/></button>
            {menu&&<><div className="ag-dismiss" onClick={()=>setMenu(false)}/><div className="ag-menu" role="menu" onClick={()=>setMenu(false)}>
              {a.original_prompt&&<button role="menuitem" onClick={()=>setPrompt(true)}><Eye size={16}/>查看原始提示詞</button>}
              <button role="menuitem" onClick={()=>download((a.name||'agent')+'.json',agentToIn(a))}><DownloadSimple size={16}/>匯出 JSON</button>
              <button role="menuitem" onClick={async()=>{try{const n=await api.createAgent({...agentToIn(a),name:(a.name+' (複本)').slice(0,50),share:undefined});notify('已複製為新草稿');onBack(n.id)}catch(e){notify(errText(e))}}}><Copy size={16}/>複製為新草稿</button>
              {canEdit&&<><hr/><button role="menuitem" className="danger" onClick={async()=>{if(!window.confirm(`刪除「${a.name}」？此動作無法復原。`))return;try{await api.deleteAgent(id);onDeleted?.()}catch(e){notify(errText(e))}}}><Trash size={16}/>刪除</button></>}</div></>}</div></div>
      </header>
      <div className="ad-card">
        <div className="ad-cardh"><h2><Sliders size={20}/>設定 Agent</h2><button className="ad-upd" disabled={!stale} onClick={async()=>{await flush();setStale(false);setTick(t=>t+1)}}>更新預覽</button></div>
        {banner&&<div className="ag-info"><Info size={18}/><span>輸入與輸出都會先去識別化再交給模型；寫入類動作預設要使用者核准後才會執行。</span><button aria-label="關閉" onClick={()=>setBanner(false)}><X size={16}/></button></div>}
        <Section title="代理程式人物角色" sub="協助您的代理程式了解其身分、行為和溝通風格" open={open.role} onToggle={()=>tog('role')}>
          <label className="ad-lab">說明</label>
          <Instructions value={a.instructions||''} onChange={v=>e2({instructions:v})} disabled={dis} onImprove={improve} improving={improving}/>
          <label className="ad-lab">參考文件</label><p className="ag-muted">連接回應範本、工作流程、方法和範例，以指引代理程式的行為。</p>
          <div className={'ad-drop'+(uploading?' busy':'')} onDragOver={ev=>{ev.preventDefault()}} onDrop={ev=>{ev.preventDefault();if(!dis&&ev.dataTransfer.files.length)upload(ev.dataTransfer.files)}}>
            <FileText size={22}/>{uploading?<span><CircleNotch className="spin" size={14}/> 上傳中…</span>:<span><button type="button" disabled={dis} onClick={()=>file.current?.click()}>上傳檔案</button><em>或拖放您的文件</em></span>}
            <input ref={file} type="file" multiple hidden accept=".pdf,.txt,.md,.docx,.pptx,.html,.csv,.json" onChange={e=>{if(e.target.files.length)upload(e.target.files);e.target.value=''}}/></div>
          <p className="ag-muted small">最多可以附加 10 份文件（.pdf、.txt、.md、.docx、.pptx、.html、.csv、.json）。系統會先擷取文字並去識別化，再建立索引；這些文件會放進院內知識庫。</p>
          {docs.length>0&&<div className="ag-chips">{docs.map(d=>{const it=lib.docs.find(x=>x.id===d);return <span className="ag-chip big" key={d}><FileText size={13}/>{it?.name||'（處理中或已不存在）'}{!dis&&<button aria-label="移除" onClick={()=>e2({knowledge_doc_ids:docs.filter(x=>x!==d)})}><X size={11}/></button>}</span>})}</div>}
          {!dis&&<button type="button" className="ag-add" onClick={()=>setPick(pick==='doc'?null:'doc')}><Plus size={13}/>從知識庫選擇文件</button>}
          {pick==='doc'&&<div className="ag-pop static">{lib.docs.filter(x=>!docs.includes(x.id)).slice(0,40).map(x=><button key={x.id} onClick={()=>{e2({knowledge_doc_ids:[...docs,x.id]});setPick(null)}}><FileText size={15}/>{x.name}</button>)}{!lib.docs.filter(x=>!docs.includes(x.id)).length&&<p className="ag-muted">沒有可加入的文件</p>}</div>}
        </Section>
        <Section title="知識來源" count={cap.spaces.length} sub="支援這個 Agent 洞見的相關知識（執行時仍依使用者本人的權限）" open={open.know} onToggle={()=>tog('know')}
          action={<button className="ad-link" disabled={dis} onClick={()=>{setOpen(o=>({...o,know:true}));setPick(pick==='space'?null:'space')}}>連結空間</button>}>
          <div className="ag-chips">{cap.spaces.map(s=>{const it=lib.spaces.find(x=>x.id===s);return <span className="ag-chip big" key={s}><BookOpen size={13}/>{it?.name||'（已不存在）'}{!dis&&<button aria-label="移除" onClick={()=>setCap({spaces:cap.spaces.filter(x=>x!==s)})}><X size={11}/></button>}</span>})}{!cap.spaces.length&&<span className="ag-muted">沒有連結知識空間，這個 Agent 不會讀取內部知識。</span>}</div>
          {pick==='space'&&<div className="ag-pop static">{lib.spaces.filter(x=>!cap.spaces.includes(x.id)).map(x=><button key={x.id} onClick={()=>{setCap({spaces:[...cap.spaces,x.id]});setPick(null)}}><BookOpen size={15}/>{x.name}</button>)}{!lib.spaces.filter(x=>!cap.spaces.includes(x.id)).length&&<p className="ag-muted">沒有可連結的空間</p>}</div>}
        </Section>
        <Section title="動作" count={conns.length} sub="這個 Agent 有權存取的工具" open={open.act} onToggle={()=>tog('act')}
          action={<button className="ad-link" disabled={dis} onClick={()=>{setOpen(o=>({...o,act:true}));setCap({connectors:[...conns,{connector_id:'',action:'',require_approval:true}]})}}>連結動作</button>}>
          {conns.map((c,i)=><ConnRow key={i} c={c} lib={lib} dis={dis} onChange={p=>setConn(i,p)} onRemove={()=>setCap({connectors:conns.filter((_,j)=>j!==i)})}/>)}
          {!conns.length&&<span className="ag-muted">沒有連結動作。</span>}
        </Section>
        <Section title="資料庫" count={(cap.db_connectors||[]).length} sub="可查詢的院內資料庫。能查到什麼，由「使用者本人」所屬群組的規則決定，分享 Agent 不會分享資料" open={open.db} onToggle={()=>tog('db')}
          action={<button className="ad-link" disabled={dis} onClick={()=>{setOpen(o=>({...o,db:true}));setPick(pick==='db'?null:'db')}}>連結資料庫</button>}>
          <div className="ag-chips">{(cap.db_connectors||[]).map(s=>{const it=(lib.dbs||[]).find(x=>x.id===s);return <span className="ag-chip big" key={s}><Database size={13}/>{it?.name||'（已不存在）'}{!dis&&<button aria-label="移除" onClick={()=>setCap({db_connectors:cap.db_connectors.filter(x=>x!==s)})}><X size={11}/></button>}</span>})}{!(cap.db_connectors||[]).length&&<span className="ag-muted">沒有連結資料庫。</span>}</div>
          {pick==='db'&&<div className="ag-pop static">{(lib.dbs||[]).filter(x=>!(cap.db_connectors||[]).includes(x.id)).map(x=><button key={x.id} onClick={()=>{setCap({db_connectors:[...(cap.db_connectors||[]),x.id]});setPick(null)}}><Database size={15}/>{x.name}</button>)}{!(lib.dbs||[]).filter(x=>!(cap.db_connectors||[]).includes(x.id)).length&&<p className="ag-muted">沒有可連結的資料庫（管理員需先在「連接器 → Database」建立）</p>}</div>}
        </Section>
        <Section title="自訂" sub="協助識別這個 Agent 的詳細資訊" open={open.custom} onToggle={()=>tog('custom')}>
          <div className="ag-row"><div className="ag-field narrow"><label>圖示</label><input className="ag-emoji" maxLength={4} value={a.icon||''} placeholder="🩺" disabled={dis} onChange={e=>e2({icon:e.target.value})}/></div>
            <div className="ag-field grow"><label>部門</label><select value={a.department||''} disabled={dis} onChange={e=>e2({department:e.target.value})}><option value="">（不指定）</option>{DEPTS.map(d=><option key={d}>{d}</option>)}</select></div></div>
          <div className="ag-field"><label>開場訊息／範例問題 <small>最多 4 則，顯示在對話起始畫面</small></label>
            <div className="ag-list">{a.opening_questions.map((q,i)=><div key={i} className="ag-li"><input value={q} maxLength={120} disabled={dis} onChange={e=>e2({opening_questions:a.opening_questions.map((x,j)=>j===i?e.target.value:x)})}/>{!dis&&<button className="ag-icon" aria-label="刪除" onClick={()=>e2({opening_questions:a.opening_questions.filter((_,j)=>j!==i)})}><X size={14}/></button>}</div>)}
              {!dis&&a.opening_questions.length<4&&<button type="button" className="ag-add" onClick={()=>e2({opening_questions:[...a.opening_questions,'']})}><Plus size={13}/>新增範例問題</button>}</div></div>
          <div className="ag-field"><label>模型偏好</label><Seg value={cap.model_pref} disabled={dis} onChange={v=>setCap({model_pref:v})} options={[['fast','快速'],['balanced','平衡'],['quality','高品質']]}/></div>
          <div className="ag-field"><label>思考深度</label><Seg value={cap.thinking} disabled={dis} onChange={v=>setCap({thinking:v})} options={[['off','關'],['low','低'],['medium','中'],['high','高']]}/></div>
          <div className="ag-cap"><Globe size={18}/><div><b>網路搜尋</b><small>{lib.features?.web_search===false?'管理員尚未開放網路搜尋':'需要即時或院外公開資訊時使用'}</small></div><Switch on={cap.web_search&&lib.features?.web_search!==false} disabled={dis||lib.features?.web_search===false} label="網路搜尋" onChange={v=>setCap({web_search:v})}/></div>
          <div className="ag-cap"><Lock size={18}/><div><b>僅院內模型</b><small>開啟後只使用院內模型，不回退雲端；圖片與網路搜尋無法使用</small></div><Switch on={!!a.routing?.sovereign_only} disabled={dis} label="僅院內模型" onChange={v=>e2({routing:{...a.routing,sovereign_only:v}})}/></div>
        </Section>
      </div>
    </div>
    <div className="ad-side" role="complementary" aria-label="預覽"><Preview a={a} flush={flush} save={save} notify={notify} tick={tick}/></div>
    {pub&&<div className="ag-modal" onClick={()=>setPub(false)}><div className="ag-dialog wide" onClick={e=>e.stopPropagation()}><h3>發布與版本</h3>
      <PublishTab agent={a} me={me} editable={canEdit} dirty={save==='dirty'||save==='saving'} onSave={flush} notify={notify} onAgent={r=>{setA(x=>({...x,...r,steps:x.steps,capabilities:x.capabilities,opening_questions:x.opening_questions}))}}/><VersionsTab agent={a}/>
      <div><button className="ag-btn" onClick={()=>setPub(false)}>關閉</button></div></div></div>}
    {prompt&&<div className="ag-modal" onClick={()=>setPrompt(false)}><div className="ag-dialog" onClick={e=>e.stopPropagation()}><h3>原始提示詞</h3><p className="ag-muted">建立這個 Agent 時你輸入的內容（唯讀）。</p><pre>{a.original_prompt}</pre><div><button className="ag-btn" onClick={()=>setPrompt(false)}>關閉</button></div></div></div>}
    {share&&<ShareDialog title={a.name} value={a.share} owner={a.owner_email} onClose={()=>setShare(false)} onDone={async v=>{try{const r=await api.shareAgent(id,v);setA(x=>({...x,share:r?.share||v}));notify('已更新分享設定');setShare(false)}catch(e){notify(errText(e))}}}/>}
  </div>;
}

function ConnRow({c,lib,dis,onChange,onRemove}){
  const [acts,setActs]=useState([]);
  useEffect(()=>{if(c.connector_id)api.connectorActions(c.connector_id).then(l=>setActs(l||[])).catch(()=>setActs([]));else setActs([])},[c.connector_id]);
  return <div className="ag-conn"><select value={c.connector_id} disabled={dis} onChange={e=>onChange({connector_id:e.target.value,action:''})}><option value="">選擇連接器</option>{lib.connectors.map(x=><option key={x.id} value={x.id}>{x.name||x.label||x.type}</option>)}</select>
    <select value={c.action} disabled={dis||!c.connector_id} onChange={e=>onChange({action:e.target.value})}><option value="">選擇動作</option>{acts.map(x=><option key={x.id} value={x.id}>{x.label||x.id}</option>)}</select>
    <label className="ag-inline"><Switch on={c.require_approval} disabled={dis} label="需要核准" onChange={v=>onChange({require_approval:v})}/>需核准</label>{!dis&&<button className="ag-icon" aria-label="移除" onClick={onRemove}><X size={14}/></button>}</div>;
}
