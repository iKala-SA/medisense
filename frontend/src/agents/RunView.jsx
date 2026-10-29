import React,{useState} from 'react';
import {CheckCircle,XCircle,CircleNotch,Circle,SkipForward,HandPalm,CaretDown,CaretRight,Warning} from '@phosphor-icons/react';
import {STATUS_LABEL,STEP_TYPES} from './stepkit';
import {api} from '../api';

const Dot=({s})=>s==='succeeded'?<CheckCircle size={18} weight="fill" className="ok"/>:s==='failed'?<XCircle size={18} weight="fill" className="bad"/>
  :s==='running'?<CircleNotch size={18} className="spin"/>:s==='waiting_approval'?<HandPalm size={18} weight="fill" className="wait"/>:s==='skipped'||s==='cancelled'?<SkipForward size={18}/>:<Circle size={18}/>;
const secs=ms=>ms?`${(ms/1000).toFixed(1)} 秒`:'';

/** One run: the step timeline (each step opens to its input, output and sources), the result, and the approve / reject buttons. */
export default function RunView({run,onChange,notify}){
  const [open,setOpen]=useState({}),[busy,setBusy]=useState(false);
  const decide=async ok=>{setBusy(true);try{onChange(await api.approveStepRun(run.id,ok))}catch(e){notify?.(e.message)}finally{setBusy(false)}};
  return <div className="rv">
    <div className={'rv-head '+run.status}><Dot s={run.status==='waiting_approval'?'waiting_approval':run.status}/><b>{STATUS_LABEL[run.status]||run.status}</b>
      {run.draft&&<span className="ag-chip">草稿測試</span>}<span className="rv-sub">{run.triggered_by}</span></div>
    {run.error&&<p className="rv-err"><Warning size={14}/>{run.error}</p>}
    {run.status==='waiting_approval'&&run.pending&&<div className="rv-approve">
      <b>需要你的核准</b><p>{run.pending.label}：將以下列參數執行</p>
      <pre>{JSON.stringify(run.pending.args,null,2)}</pre>
      <div><button className="ag-btn" disabled={busy} onClick={()=>decide(false)}>拒絕</button><button className="ag-btn primary" disabled={busy} onClick={()=>decide(true)}>核准並執行</button></div>
    </div>}
    <ol className="rv-steps">{run.steps.map(s=>{const meta=STEP_TYPES[s.type]||{},I=meta.icon,o=open[s.step_id];return <li key={s.step_id} className={s.status}>
      <button type="button" className="rv-row" onClick={()=>setOpen(x=>({...x,[s.step_id]:!o}))}><Dot s={s.status}/>{I&&<I size={16} className="ic"/>}<b>{s.title}</b>
        <em>{STATUS_LABEL[s.status]||s.status}</em><small>{secs(s.duration_ms)}</small>{o?<CaretDown size={13}/>:<CaretRight size={13}/>}</button>
      {o&&<div className="rv-body">
        {s.input&&<><label>輸入</label><pre>{s.input}</pre></>}
        {s.output&&<><label>輸出</label><pre>{s.output}</pre></>}
        {s.sources?.length>0&&<><label>來源</label><ul>{s.sources.map((x,i)=><li key={i}>{x.url?<a href={x.url} target="_blank" rel="noreferrer noopener">{x.title||x.url}</a>:x.title}</li>)}</ul></>}
        {s.error&&<p className="rv-err">{s.error}</p>}
      </div>}
    </li>})}</ol>
    {run.status==='succeeded'&&run.result&&<div className="rv-result"><label>結果</label><pre>{run.result}</pre></div>}
  </div>;
}
