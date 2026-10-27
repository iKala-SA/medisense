import React,{useEffect,useRef,useState} from 'react';
import {PaperPlaneTilt,ArrowCounterClockwise,Check,X} from '@phosphor-icons/react';
import {api} from '../api';
import {errText} from './kit';

export default function SandboxTab({agent,me,editable,dirty,onSave,notify}){
  const pending=agent.review?.state==='pending'?agent.review:null;
  const hasLive=agent.version>0;
  const [target,setTarget]=useState(editable?'draft':'published');
  const [msgs,setMsgs]=useState([]),[text,setText]=useState(''),[session,setSession]=useState(),[busy,setBusy]=useState(false),[trace,setTrace]=useState(null);
  const bottom=useRef();
  useEffect(()=>{bottom.current?.scrollIntoView?.({behavior:'smooth'})},[msgs,busy]);
  const reset=()=>{setMsgs([]);setSession(undefined);setTrace(null)};
  const switchTarget=t=>{setTarget(t);reset()};
  const add=r=>setMsgs(m=>[...m,{role:'ai',text:r.reply,trace:r.trace,citations:r.citations,structured:r.structured,latency:r.latency_ms,pending:r.pending_approval}]);

  const send=async(content=text)=>{
    if(!content.trim()||busy)return;
    setText('');setMsgs(m=>[...m,{role:'me',text:content}]);setBusy(true);
    try{
      const r=await api.run(agent.id,content,session,target==='published',target==='review'?pending?.version:undefined);
      setSession(r.session_id);add(r);
    }catch(e){notify('執行失敗：'+errText(e))}finally{setBusy(false)}
  };
  const decide=async(i,approve)=>{
    if(!session||busy)return;setBusy(true);
    try{
      const r=await api.approve(agent.id,session,approve);
      setMsgs(m=>[...m.map((x,j)=>j===i?{...x,decided:approve?'approved':'rejected'}:x),{role:'ai',text:r.reply,trace:r.trace,citations:r.citations,structured:r.structured,latency:r.latency_ms,pending:r.pending_approval}]);
    }catch(e){notify('核准失敗：'+errText(e))}finally{setBusy(false)}
  };

  if(!editable&&!hasLive)return <div className="lv-card"><div className="lv-state">此 Agent 尚未發布，目前無法對話。</div></div>;
  const last=msgs.length-1;
  return <div className="lv-wrap">
    {dirty&&editable&&target==='draft'&&<div className="lv-banner warn">有未儲存的變更；沙盒執行的是已儲存的草稿。<button type="button" className="lv-linkbtn" onClick={onSave}>先儲存</button></div>}
    <div className="lv-card lv-chat">
      <div className="lv-flowbar" style={{padding:'12px 16px 0',marginBottom:0}}>
        {editable?<label className="small muted">測試版本 <select aria-label="測試版本" value={target} onChange={e=>switchTarget(e.target.value)}>
          <option value="draft">草稿（已儲存）</option>{hasLive&&<option value="published">已發布 v{agent.version}</option>}{pending&&<option value="review">待審 v{pending.version}</option>}</select></label>
          :<span className="badge">已發布 v{agent.version}</span>}
        {agent.test_cases?.length>0&&<select aria-label="預載個案" value="" onChange={e=>{const t=agent.test_cases[Number(e.target.value)];if(t)send(t.message)}}><option value="">預載個案…</option>{agent.test_cases.map((t,i)=><option key={i} value={i}>{t.title}</option>)}</select>}
        <span style={{flex:1}}/><button type="button" className="text-button" onClick={reset}><ArrowCounterClockwise/>重設對話</button>
      </div>
      <div className="lv-msgs">
        {!msgs.length&&!busy&&<div className="lv-state">輸入測試提問開始。{agent.knowledge_count>0&&'已掛載知識庫，回答會附上引用來源。'}<br/>請使用合成資料測試。</div>}
        {msgs.map((m,i)=>m.role==='me'?<div key={i} className="lv-m me">{m.text}</div>:
          <div key={i} className="lv-m ai">
            {m.structured?<pre>{JSON.stringify(m.structured,null,2)}</pre>:m.text}
            {m.pending&&<div className="lv-approval">
              {m.decided==='approved'?'已核准，流程已繼續':m.decided==='rejected'?'已拒絕，流程停止':`等待人工核准：${m.pending.message}`}
              {!m.decided&&(editable?<div className="lv-actions" style={{marginTop:6}}>
                <button className="btn primary" disabled={busy||i!==last} onClick={()=>decide(i,true)}><Check/>核准並繼續</button>
                <button className="btn" disabled={busy||i!==last} onClick={()=>decide(i,false)}><X/>拒絕</button></div>
                :<div className="lv-hint">需由 Agent 負責人 {agent.owner_email} 核准。</div>)}
            </div>}
            {m.citations?.length>0&&<div className="lv-cites">{m.citations.map((c,j)=><span key={j} title={c.text}>[{j+1}] {c.source}{c.score!=null?` · ${Number(c.score).toFixed(2)}`:''}</span>)}</div>}
            {m.trace?.length>0&&<div style={{marginTop:6}}>
              <button type="button" className="lv-linkbtn" onClick={()=>setTrace(trace===i?null:i)}>{trace===i?'隱藏':'顯示'}推論軌跡（{m.trace.length} 步{m.latency?` · ${(m.latency/1000).toFixed(1)}s`:''}）</button>
              {trace===i&&<ol className="lv-trace">{m.trace.map((t,k)=><li key={k}>{t.type} {t.node_id}{t.group?` [${t.group} → ${t.model}]`:''} · {t.summary}{t.ms?` · ${t.ms} ms`:''}</li>)}</ol>}
            </div>}
          </div>)}
        {busy&&<div className="small muted"><span className="lv-spin"/>推論中…</div>}
        <div ref={bottom}/>
      </div>
      <div className="lv-compose">
        <textarea rows={2} aria-label="測試提問" placeholder="輸入測試提問（Enter 送出，Shift+Enter 換行）" value={text} onChange={e=>setText(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/>
        <button className="btn primary" disabled={busy||!text.trim()} onClick={()=>send()}><PaperPlaneTilt/>送出</button>
      </div>
    </div>
  </div>;
}
