import React,{useEffect,useMemo,useState} from 'react';
import {api} from '../api';
import {Field} from '../ListKit';
import {MODEL_GROUP_IDS,GROUP_HINT} from './kit';
import {errText} from './kit';

const estTokens=s=>Math.ceil([...s].reduce((n,ch)=>n+(ch.charCodeAt(0)>255?1.3:0.25),0));

export default function SettingsTab({agent,patch,editable,notify}){
  const [docs,setDocs]=useState(null),[q,setQ]=useState(''),[skills,setSkills]=useState(null);
  useEffect(()=>{let live=true;api.listSkills().then(d=>live&&setSkills(d||[])).catch(()=>live&&setSkills([]));return()=>{live=false}},[]);
  useEffect(()=>{let live=true;api.listDocs().then(d=>live&&setDocs(d||[])).catch(e=>{if(live){setDocs([]);notify('載入知識文件失敗：'+errText(e))}});return()=>{live=false}},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const ids=agent.knowledge_doc_ids||[];
  const shown=useMemo(()=>(docs||[]).filter(d=>!q.trim()||d.name.toLowerCase().includes(q.trim().toLowerCase())),[docs,q]);
  const missing=docs?ids.filter(i=>!docs.some(d=>d.id===i)).length:0;
  const toggle=id=>patch({knowledge_doc_ids:ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]});
  const sids=agent.skill_ids||[];
  const toggleSkill=id=>patch({skill_ids:sids.includes(id)?sids.filter(x=>x!==id):[...sids,id]});
  const dis=!editable;
  return <div className="lv-card">
    <div className="lv-grid2">
      <Field label="Agent 名稱"><input maxLength={80} value={agent.name} disabled={dis} onChange={e=>patch({name:e.target.value})}/></Field>
      <Field label="模型群組"><select value={agent.model_group} disabled={dis} onChange={e=>patch({model_group:e.target.value})}>
        {MODEL_GROUP_IDS.map(g=><option key={g} value={g}>{g} · {GROUP_HINT[g]}</option>)}</select></Field>
    </div>
    <Field label="說明"><textarea rows={2} value={agent.description||''} disabled={dis} onChange={e=>patch({description:e.target.value})}/></Field>
    <Field label={`指示（Instructions）· 約 ${estTokens(agent.instructions||'').toLocaleString()} tokens`}><textarea rows={9} className="lv-mono" value={agent.instructions||''} disabled={dis} onChange={e=>patch({instructions:e.target.value})}/></Field>
    <div className="lv-grid2">
      <Field label="Temperature"><div className="lv-range"><input type="range" min={0} max={1} step={0.05} value={agent.temperature} disabled={dis} onChange={e=>patch({temperature:Number(e.target.value)})}/><b>{Number(agent.temperature).toFixed(2)}</b></div></Field>
      <Field label="Top-P"><div className="lv-range"><input type="range" min={0} max={1} step={0.05} value={agent.top_p} disabled={dis} onChange={e=>patch({top_p:Number(e.target.value)})}/><b>{Number(agent.top_p).toFixed(2)}</b></div></Field>
    </div>
    <Field label={`技能（已套用 ${sids.length} 項）`}>
      <div className="lv-docs">
        {skills===null?<div className="lv-state"><span className="lv-spin"/>載入中…</div>
          :!skills.length?<div className="lv-state">尚未建立技能。可到「技能」頁新增。</div>
          :skills.map(k=><label className="lv-doc" key={k.id}><input type="checkbox" checked={sids.includes(k.id)} disabled={dis} onChange={()=>toggleSkill(k.id)}/><span>{k.name}</span><small>{k.enabled?'啟用中':'已停用（執行時略過）'}</small></label>)}
      </div>
      <p className="lv-hint">已啟用的技能指示會依勾選順序加到每個 LLM 步驟的系統提示前。變更需按「儲存」才會生效。</p>
    </Field>
    <Field label={`知識文件（已掛載 ${ids.length} 份）`}>
      <input placeholder="搜尋文件" value={q} onChange={e=>setQ(e.target.value)} style={{marginBottom:8}}/>
      <div className="lv-docs">
        {docs===null?<div className="lv-state"><span className="lv-spin"/>載入中…</div>
          :!docs.length?<div className="lv-state">知識庫目前沒有文件</div>
          :!shown.length?<div className="lv-state">找不到符合的文件</div>
          :shown.map(d=><label className="lv-doc" key={d.id}><input type="checkbox" checked={ids.includes(d.id)} disabled={dis} onChange={()=>toggle(d.id)}/><span>{d.name}</span>
            <small>{d.status==='indexed'?`v${d.version}`:d.status==='error'?'索引異常':'索引中'}</small></label>)}
      </div>
      {missing>0&&<p className="lv-hint" style={{color:'#8a5a00'}}>{missing} 份已掛載的文件已從知識庫刪除，檢索時會略過。</p>}
      <p className="lv-hint">只檢索掛載的文件；內容已去識別化。變更需按「儲存」才會生效。</p>
    </Field>
  </div>;
}
