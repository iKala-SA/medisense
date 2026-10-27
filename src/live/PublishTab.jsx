import React,{useState} from 'react';
import {PaperPlaneTilt,ArrowUUpLeft,SealCheck,CloudArrowUp,CloudSlash,Lock,ClockCounterClockwise} from '@phosphor-icons/react';
import {api} from '../api';
import {AddModal,Field} from '../ListKit';
import {errText,fmtTime} from './kit';

export function PublishTab({agent,me,editable,dirty,onSave,onAgent,notify}){
  const [busy,setBusy]=useState(false),[rejecting,setRejecting]=useState(false);
  const admin=me.role==='admin';
  const rv=agent.review,pending=rv?.state==='pending'?rv:null,rejected=rv?.state==='rejected'?rv:null;
  const published=agent.status==='published';
  // 0 draft, 1 in review, 2 live
  const stage=pending?1:published?2:0;
  const run=async(fn,ok)=>{
    if(busy)return;setBusy(true);
    try{onAgent(await fn());notify(ok)}catch(e){notify(errText(e))}finally{setBusy(false)}
  };
  const steps=[['草稿','編輯並於沙盒測試'],['管理員審核','申請後凍結該版本'],['全院發布','全院同仁可使用']];
  return <div className="lv-wrap">
    <div className="lv-card">
      <h3 style={{margin:0}}>受控發布</h3>
      <p className="lv-hint">builder 申請發布，由管理員核准後該版本才會上線；審核的是申請當下的快照，之後的草稿修改不包含在內。</p>
      <div className="lv-pipe">{steps.map(([n,s],i)=><div key={n} className={i<stage||(i===2&&stage===2)?'done':i===stage?'cur':''}><span>{i+1}</span><b>{n}</b><div className="lv-hint">{s}</div></div>)}</div>
      <div className="lv-hint" style={{display:'flex',gap:6,alignItems:'center'}}><Lock size={14}/>未發布前僅負責人與管理員可使用。</div>
    </div>
    {published&&<div className="lv-banner ok">v{agent.version} 已於 {fmtTime(agent.published_at)} 發布{agent.approved_by_email?`（核准：${agent.approved_by_email}）`:''}。草稿的後續修改需再次發布才會生效。</div>}
    {pending&&<div className="lv-banner warn">v{pending.version} 由 {pending.requested_by_email} 於 {fmtTime(pending.requested_at)} 申請發布，等待管理員審核。</div>}
    {rejected&&<div className="lv-banner bad">v{rejected.version} 被 {rejected.decided_by_email||'管理員'} 退回：{rejected.reason}。修改草稿後可重新申請。</div>}
    {!editable?<div className="lv-card"><div className="lv-hint" style={{margin:0}}>只有負責人與管理員可管理發布。</div></div>:
    <div className="lv-card">
      {dirty&&<div className="lv-banner warn" style={{marginBottom:12}}>有未儲存的變更，請先儲存再發布或申請。<button type="button" className="lv-linkbtn" onClick={onSave}>立即儲存</button></div>}
      <div className="lv-actions" style={{marginTop:0}}>
        {!pending&&<button className="btn primary" disabled={busy||dirty} onClick={()=>run(()=>api.requestPublish(agent.id),'已送出發布申請')}><PaperPlaneTilt/>申請全院發布（v{agent.version+1}）</button>}
        {pending&&<button className="btn" disabled={busy} onClick={()=>run(()=>api.withdrawPublish(agent.id),'已撤回申請')}><ArrowUUpLeft/>撤回 v{pending.version} 申請</button>}
        {admin&&pending&&<>
          <button className="btn primary" disabled={busy} onClick={()=>run(()=>api.reviewAgent(agent.id,true),`已核准並發布 v${pending.version}`)}><SealCheck/>核准 v{pending.version}</button>
          <button className="btn" disabled={busy} onClick={()=>setRejecting(true)}><ArrowUUpLeft/>退回</button></>}
        {admin&&<button className="btn" disabled={busy||dirty} title="直接發布會取代待審申請" onClick={()=>{if(!pending||window.confirm('直接發布將取代目前的待審申請，確定？'))run(()=>api.publishAgent(agent.id),`已直接發布 v${agent.version+1}`)}}><CloudArrowUp/>直接發布</button>}
        {published&&<button className="btn" disabled={busy} onClick={()=>{if(window.confirm('下架後其他同仁將無法使用此 Agent。確定？'))run(()=>api.unpublishAgent(agent.id),'已下架')}}><CloudSlash/>下架</button>}
      </div>
    </div>}
    {rejecting&&<AddModal title="退回發布申請" hint="退回原因會顯示給負責人。" submitLabel="退回" onClose={()=>setRejecting(false)} onSubmit={f=>{
      const reason=String(f.get('reason')||'').trim();if(!reason)return;setRejecting(false);run(()=>api.reviewAgent(agent.id,false,reason),'已退回申請')}}>
      <Field label="原因"><textarea name="reason" rows={3} required autoFocus maxLength={500}/></Field></AddModal>}
  </div>;
}

export function VersionsTab({agent}){
  return <div className="lv-card">
    <h3 style={{margin:'0 0 12px'}}>版本記錄</h3>
    <dl className="lv-kv">
      <dt>目前版本</dt><dd>{agent.version>0?`v${agent.version}`:'尚未發布（v0）'}</dd>
      <dt>狀態</dt><dd>{agent.status==='published'?'已發布':'草稿'}{agent.review?.state==='pending'?` · v${agent.review.version} 待審核`:''}</dd>
      <dt>發布時間</dt><dd>{fmtTime(agent.published_at)}</dd>
      <dt>核准者</dt><dd>{agent.approved_by_email||'—'}</dd>
      <dt>最後更新</dt><dd>{fmtTime(agent.updated_at)}</dd>
      <dt>負責人</dt><dd>{agent.owner_email}</dd>
    </dl>
    <div className="lv-banner info" style={{marginTop:16}}><ClockCounterClockwise size={18}/><span>後端會為每次發布保存不可變的版本快照，但目前沒有列出歷史版本或回滾的 API，因此這裡只顯示目前版本與狀態。</span></div>
  </div>;
}
