import React,{useMemo,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjk from 'remark-cjk-friendly';
import {CaretRight,CheckCircle,Circle,CircleNotch,Copy,ListChecks,Brain,Lightning,FileText} from '@phosphor-icons/react';
import {Jelly} from '../Jelly';
import {artifactComponents} from './Artifact';
import FeedbackBar from './Feedback';
import {stepLabel,seconds,modelLabel} from './chatkit';
import './chat.css';

/* Inline [n] markers become clickable chips that open that reference in the side panel. */
const chip=(i,n)=>+i>=1&&+i<=n?`[${i}](#cite-${i})`:`[${i}]`;
const CODE=/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;  // code is never rewritten: [1] there is an index, not a citation
const withCites=(text,n)=>n?String(text).split(CODE).map((seg,i)=>i%2?seg:citeText(seg,n)).join(''):String(text);
const citeText=(text,n)=>n?String(text)
  .replace(/\[(\d{1,2}(?:\s*[,，、]\s*\d{1,2})+)\]/g,(m,list)=>list.split(/\s*[,，、]\s*/).map(i=>chip(i,n)).join(''))  // [1, 2] -> [1][2]
  .replace(/\[(\d{1,2})\](?!\()/g,(m,i)=>chip(i,n)):String(text);

/* One step per row. Finished steps show a check, the running one a spinner, upcoming ones an empty circle. */
export function Steps({trace,compact,model,run}){
  return <ol className={'cx-steps'+(compact?' compact':'')}>{trace.map((s,i)=>{
    const st=s.status||'done',llm=s.type==='llm'||s.type==='structured_output';
    return <li key={s.node_id||i} className={st}>
      <span className="ck">{st==='done'?<CheckCircle size={15} weight="fill"/>:st==='running'?<CircleNotch size={15} className="spin"/>:<Circle size={15}/>}</span>
      <div><b>{stepLabel(s.type)}</b>{(s.model||(llm&&st!=='done'&&model))&&<em>{modelLabel(s.model||model)}</em>}{s.ms>0&&<time>{seconds(s.ms)}</time>}
        {s.reason&&<p className="cx-reason" title="模型自己寫的理由">{s.reason}</p>}
        {st==='done'&&<p className="cx-facts">{s.summary}</p>}
        {st==='running'&&<p className="shimmer">{runningText(s.type)}</p>}
        {(s.type==='turn'||llm)&&st==='running'&&run?.thought&&<Thought text={run.thought}/>}
        {st==='done'&&(s.thinking?<Thought text={s.thinking}/>:llm&&<small className="cx-none">此模型未回傳思考內容</small>)}
      </div></li>})}</ol>;
}
const RUNNING={input:'讀取並去識別化問題…',turn:'模型思考中…',knowledge:'正在搜尋院內文件…',web_search:'正在搜尋網路…',llm:'模型正在撰寫回答…',structured_output:'模型正在產生結構化輸出…',tool:'正在執行連接器動作…',approval:'等待人工核准…',his_emr:'正在查詢 HIS/EMR…'};
const runningText=t=>RUNNING[t]||'處理中…';
/* Who is answering: the jellyfish and the agent name together, above the reply. */
export const Who=({name,animated})=><div className="cx-who"><Jelly size={26} animated={animated}/><b>{name||'Medisense'}</b></div>;
export function Thought({text}){return <blockquote className="cx-thought"><Brain size={13}/><div className="cx-thought-md"><Markdown remarkPlugins={[remarkGfm,remarkCjk]}>{text}</Markdown></div></blockquote>}

/* Collapsible "思考過程" (Claude / Amazon Quick style): collapsed once the answer is done. */
/* Collapsible "思考過程" (Claude / Amazon Quick style): collapsed once the answer is done. */
export function ThinkingBlock({trace,ms,defaultOpen=false}){
  const [open,setOpen]=useState(defaultOpen);
  const llm=trace.filter(s=>s.model),thought=trace.some(s=>s.thinking);
  const label=thought?'已思考':'已完成處理';
  return <div className={'cx-think'+(open?' open':'')}>
    <button type="button" aria-expanded={open} onClick={()=>setOpen(o=>!o)}>
      <CaretRight size={13} className="car"/><Lightning size={14} weight="fill"/>
      <span>{label}</span><small>{trace.length} 個步驟{ms?` · ${seconds(ms)}`:''}{llm.length?` · ${modelLabel(llm[llm.length-1].model)}`:''}</small>
    </button>
    {open&&<div className="cx-think-body"><Steps trace={trace} compact/></div>}
  </div>;
}

export function Thinking({label='正在思考…'}){
  return <div className="cx-live" role="status"><Jelly size={44} animated/><div><b>{label}</b><small>檢索資料、呼叫模型並整理回覆</small></div></div>;
}

/* The answer while it is being produced: current step as a headline, the llm draft streaming in below. */
const live=artifactComponents({canSave:false,live:true});
export function LiveRun({run,onSteps,agent}){
  const cur=run.steps.find(s=>s.status==='running')||[...run.steps].reverse().find(s=>s.status==='done');
  const done=run.steps.filter(s=>s.status==='done').length;
  const md=useMemo(()=>run.draft,[run.draft]);
  return <div className="cx-answer">
    <Who name={agent} animated/>
    <button type="button" className="cx-livehead" onClick={onSteps} aria-label="在右側查看執行步驟">
      <span className="shimmer">{cur?runningText(cur.type):'正在思考…'}</span>
      {done>0&&<small>已完成 {done} 步</small>}<CaretRight size={13}/>
    </button>
    {md&&<div className="cx-md streaming"><Markdown remarkPlugins={[remarkGfm,remarkCjk]} components={live}>{md}</Markdown></div>}
  </div>;
}

export default function ChatAnswer({m,onCite,onSteps,notify,sessionId,canSave,mock}){
  const n=m.citations?.length||0;
  const md=useMemo(()=>withCites(m.ans,n),[m.ans,n]);
  const comps=useMemo(()=>({
    a:({href,children})=>href?.startsWith('#cite-')?<button type="button" className="cx-cite" onClick={()=>onCite(+href.slice(6))}>{children}</button>:<a href={href} target="_blank" rel="noreferrer">{children}</a>,
    table:({children})=><div className="cx-table"><table>{children}</table></div>,
    ...artifactComponents({canSave,notify,mock})
  }),[onCite,canSave,notify,mock]);
  return <div className="cx-answer">
    <Who name={m.agent}/>
    <div className="cx-md"><Markdown remarkPlugins={[remarkGfm,remarkCjk]} components={comps}>{md}</Markdown></div>
    {n>0&&<div className="cx-refs">{m.citations.map((c,i)=><button key={i} type="button" onClick={()=>onCite(i+1)} title={c.source}><FileText size={13}/><b>{i+1}</b><span>{c.source}</span></button>)}</div>}
    <div className="cx-foot">
      <button type="button" onClick={()=>onSteps()}><ListChecks size={15}/>{m.used&&m.used!=='—'?m.used:'執行步驟'}<CaretRight size={13}/></button>
      <button type="button" aria-label="複製回覆" onClick={()=>{navigator.clipboard?.writeText(m.ans);notify('已複製回覆')}}><Copy size={15}/></button>
      <FeedbackBar sessionId={sessionId} msgIndex={m.msgIndex} rating={m.fb} question={m.text} answer={m.ans} notify={notify} mock={mock}/>
    </div>
  </div>;
}
