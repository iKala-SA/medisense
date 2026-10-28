import React,{useEffect,useMemo,useRef,useState} from 'react';
import {X,ListChecks,FileText,Cpu,CaretDown,CaretUp,ArrowLeft,ArrowSquareOut,CircleNotch,WarningCircle,LockKey} from '@phosphor-icons/react';
import {Steps} from './ChatAnswer';
import {modelLabel,seconds,GROUP_LABEL,locate} from './chatkit';
import {api} from '../api';
import OriginalView from './OriginalView';
import './chat.css';

const host=u=>{try{return new URL(u).hostname}catch{return u}};
function Ref({c,i,active,refEl,onOpen}){
  const [open,setOpen]=useState(false);
  useEffect(()=>{if(active)setOpen(true)},[active]);
  const long=(c.text||'').length>140,web=!c.doc_id&&/^https?:/.test(c.uri||'');
  return <article ref={refEl} className={'cx-ref'+(active?' active':'')}>
    <header><span className="n">{i}</span><b title={c.source}>{c.source}</b>{c.page!=null&&<em>第 {c.page} 頁</em>}{c.low&&<em className="low" title="與問題的相關度較低，僅供參考">低相關</em>}</header>
    {web?<p className="host">{host(c.uri)}</p>:<p className={open?'':'clamp'}>{c.text||'（無內容片段）'}</p>}
    <footer>
      {long&&<button type="button" onClick={()=>setOpen(o=>!o)}>{open?<>收合<CaretUp size={12}/></>:<>展開<CaretDown size={12}/></>}</button>}
      {c.doc_id&&<button type="button" className="open" onClick={onOpen}><ArrowSquareOut size={13}/>在文件中查看</button>}
      {web&&<a className="open" href={c.uri} target="_blank" rel="noreferrer noopener"><ArrowSquareOut size={13}/>開啟網頁</a>}
    </footer>
  </article>;
}

/* A cited document opened in the panel (Claude / Amazon Quick style): the full text the model was given, with the cited
   passage highlighted and scrolled into view. The text is the de-identified copy, never the original upload. */
function DocViewer({c,i,onBack,notify}){
  const [doc,setDoc]=useState(null),[err,setErr]=useState(''),[mode,setMode]=useState('text');
  const mark=useRef(null),box=useRef(null);
  useEffect(()=>{
    let live=true;setDoc(null);setErr('');
    api.citedDocument(c.doc_id).then(d=>live&&setDoc(d)).catch(e=>live&&setErr(e.message));
    return ()=>{live=false};
  },[c.doc_id]);
  const at=useMemo(()=>doc?locate(doc.text,c.text):null,[doc,c.text]);
  useEffect(()=>{const b=box.current,m=mark.current;if(at&&b&&m)b.scrollTo({top:Math.max(0,m.offsetTop-b.clientHeight/3),behavior:'smooth'})},[at]);
  return <div className="cx-viewer">
    <button type="button" className="cx-back" onClick={onBack}><ArrowLeft size={14}/>返回參考文件</button>
    <h4><span className="n">{i}</span>{c.source}</h4>
    {doc&&<p className="cx-docmeta">{[doc.category,doc.department,`版本 ${doc.version}`,c.page!=null&&`第 ${c.page} 頁`].filter(Boolean).join(' · ')}</p>}
    {!doc&&!err&&<p className="cx-empty"><CircleNotch className="spin" size={14}/> 載入文件…</p>}
    {err&&<p className="cx-empty"><WarningCircle size={14}/> 無法開啟文件：{err}</p>}
    {doc&&doc.original!=='none'&&<div className="cx-seg" role="tablist"><button role="tab" aria-selected={mode==='text'} className={mode==='text'?'on':''} onClick={()=>setMode('text')}>去識別化文字</button><button role="tab" aria-selected={mode==='original'} className={mode==='original'?'on':''} onClick={()=>setMode('original')}>原始檔{doc.pii!=='none'&&<LockKey size={12}/>}</button></div>}
    {doc&&mode==='original'&&<OriginalView doc={doc} page={c.page} notify={notify}/>}
    {doc&&mode==='text'&&<>
      {!at&&<blockquote className="cx-quote"><b>引用片段</b>{c.text}<small>無法在文件文字中定位此片段{doc.truncated?'（文件過長，僅顯示前段）':''}。</small></blockquote>}
      <div className="cx-doc" ref={box} tabIndex={0}>{at?<>{doc.text.slice(0,at[0])}<mark ref={mark}>{doc.text.slice(at[0],at[1])}</mark>{doc.text.slice(at[1])}</>:doc.text}</div>
      <p className="cx-hint">此為去識別化後的文字（模型實際讀到的內容）{doc.truncated?'，僅顯示前段':''}。</p>
    </>}
  </div>;
}

/* Right-hand panel. While an answer is being produced (`run`) it shows the live step list and the references found
   so far; afterwards it shows the saved steps, model, cost and references of the selected answer `m`. */
export default function ChatPanel({m,run,tab,setTab,focus,onClose,notify}){
  const live=!!run;
  const steps=live?run.steps:(m?.trace||[]);
  const trace=steps.filter(s=>(s.status||'done')==='done');
  const cites=live?run.citations:(m?.citations||[]);
  const refs=useRef({});
  const [viewing,setViewing]=useState(null);
  useEffect(()=>setViewing(null),[m,live]);
  useEffect(()=>{
    if(tab!=='refs'||!focus)return;
    if(cites[focus-1]?.doc_id)setViewing(focus);
    else refs.current[focus]?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
  },[tab,focus,m]);
  const tokens=trace.reduce((a,s)=>[a[0]+(s.prompt_tokens||0),a[1]+(s.completion_tokens||0)],[0,0]);
  const cost=trace.reduce((a,s)=>a+(s.cost_usd||0),0);
  const llm=trace.filter(s=>s.model);
  const doneCount=trace.length;
  return <section className="cx-panel" aria-label="回答詳情">
    <header><h3>{live?'處理進度':'回答詳情'}{live&&doneCount>0&&<small>已完成 {doneCount} 步</small>}</h3><button type="button" className="icon-btn" aria-label="關閉" onClick={onClose}><X/></button></header>
    <div className="cx-tabs" role="tablist">
      <button role="tab" aria-selected={tab==='steps'} className={tab==='steps'?'on':''} onClick={()=>setTab('steps')}><ListChecks size={15}/>執行步驟<span>{live?steps.length:trace.length}</span></button>
      <button role="tab" aria-selected={tab==='refs'} className={tab==='refs'?'on':''} onClick={()=>{setTab('refs');setViewing(null)}}><FileText size={15}/>參考文件<span>{cites.length}</span></button>
    </div>
    <div className="cx-pbody">
      {tab==='steps'?<>
        {!steps.length?<p className="cx-empty">{live?'正在準備…':'這則回答沒有保存執行步驟（較舊的對話）。'}</p>:<Steps trace={steps} model={live?run.model:undefined} run={live?run:undefined}/>}
        {!live&&trace.length>0&&<dl className="cx-meta">
          <div><dt><Cpu size={13}/>模型</dt><dd>{llm.length?[...new Set(llm.map(s=>modelLabel(s.model)))].join('、'):'—'}</dd></div>
          {llm[0]?.group&&<div><dt>{GROUP_LABEL[llm[0].group]?'路由群組':'選擇方式'}</dt><dd>{GROUP_LABEL[llm[0].group]||'使用者指定'}</dd></div>}
          {m?.ms>0&&<div><dt>總耗時</dt><dd>{seconds(m.ms)}</dd></div>}
          <div><dt>Token</dt><dd>輸入 {tokens[0].toLocaleString()} · 輸出 {tokens[1].toLocaleString()}</dd></div>
          {cost>0&&<div><dt>估算費用</dt><dd>US$ {cost.toFixed(4)}</dd></div>}
        </dl>}
      </>:viewing?<DocViewer c={cites[viewing-1]} i={viewing} notify={notify} onBack={()=>setViewing(null)}/>:<>
        {cites.length?cites.map((c,i)=><Ref key={i} c={c} i={i+1} active={focus===i+1} onOpen={()=>setViewing(i+1)} refEl={el=>{refs.current[i+1]=el}}/>)
          :<p className="cx-empty">{live?'檢索完成後，引用的文件會顯示在這裡。':<>這則回答沒有使用參考文件。<br/>在輸入框的資料範圍選「所有資料」，系統會先檢索已授權的院內文件，再引用來源。</>}</p>}
        {cites.length>0&&<p className="cx-hint">內容片段已去識別化；請查核原文後再使用。</p>}
      </>}
    </div>
  </section>;
}
