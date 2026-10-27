import React,{useState,useMemo} from 'react';
import {ArrowsSplit,Plus,ArrowUp,ArrowDown,Trash,Flask,Lock,CheckCircle,Warning,Info,Lightning} from '@phosphor-icons/react';
import {api} from '../api';
import {Toggle,AddModal,Field,Empty} from '../ListKit';
import {errText,useOnce} from './pkit';
import {LiveGroupTable} from './ModelRegistryPage';
import './ops.css';

const CONDITIONS=[['complex','複雜任務','訊息含推理關鍵字（預設：分析、比較、plan、why、summarize）'],['simple','簡單任務','未含推理關鍵字的一般問題'],['all','所有一般任務','不論內容，一律符合']];
const GROUPS=[['fast','fast · 快速','一般問答與多數流程步驟，延遲低。'],['reasoning','reasoning · 深度推理','需較深推理的分析任務；成本最高。'],['budget','budget · 低成本','成本最低的雲端群組，適合簡單任務。'],['sovereign','sovereign · 院內模型','僅在院內（地端）執行，不使用雲端。']];
const condLabel=c=>CONDITIONS.find(x=>x[0]===c)?.[1]||c;
const clean=c=>JSON.stringify({sovereign_only:!!c.sovereign_only,default_group:c.default_group,fallback_group:c.fallback_group,rules:c.rules.map(r=>({id:r.id,name:r.name,condition:r.condition,group:r.group,enabled:!!r.enabled}))});
const norm=r=>({sovereign_only:!!r.sovereign_only,default_group:r.default_group,fallback_group:r.fallback_group,rules:(r.rules||[]).map(x=>({id:x.id,name:x.name,condition:x.condition,group:x.group,enabled:!!x.enabled})),version:r.version,updated_by:r.updated_by,updated_at:r.updated_at});
const uid=()=>'r-'+Math.random().toString(36).slice(2,10);
const GroupSelect=({value,onChange,label})=><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{GROUPS.map(([id,l])=><option key={id} value={id}>{l}</option>)}</select>;

export default function RoutingRulesPage({me,notify}){
  const admin=me?.role==='admin';
  const [base,setBase]=useState(null),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[adding,setAdding]=useState(false);
  const [text,setText]=useState('請分析並比較兩種排班方案的優缺點'),[res,setRes]=useState(null),[testing,setTesting]=useState(false),[tested,setTested]=useState(null);
  const [groups,setGroups]=useState(null),[gfail,setGfail]=useState(false),[saved,setSaved]=useState(false);
  useOnce(async()=>{
    if(!admin)return;
    try{const r=norm(await api.getRouting());setBase(r);setDraft(structuredClone(r))}catch(e){notify('無法載入路由規則：'+errText(e));setBase(false)}
    try{const r=await api.modelGroups();setGroups(r.groups||[])}catch(e){setGroups([]);setGfail(true)}
  });
  const dirty=useMemo(()=>base&&draft?clean(base)!==clean(draft):false,[base,draft]);
  if(!admin)return <div className="lv-o"><div className="page-heading"><h1><ArrowsSplit/>路由</h1></div><div className="panel access"><Lock size={36}/><h2>僅限管理員</h2><p>路由規則僅管理員可檢視與修改。</p></div></div>;
  if(base===null)return <div className="lv-o"><div className="lv-o-loading">載入中…</div></div>;
  if(base===false)return <div className="lv-o"><div className="page-heading"><h1><ArrowsSplit/>路由</h1></div><Empty text="無法載入路由規則，請稍後重新整理。"/></div>;
  const edit=fn=>{setDraft(fn);setSaved(false)};
  const change=(id,k,v)=>edit(a=>({...a,rules:a.rules.map(r=>r.id===id?{...r,[k]:v}:r)}));
  const sov=draft.sovereign_only,sovLive=(groups||[]).find(g=>g.id==='sovereign');
  const sovMissing=groups!==null&&!gfail&&!sovLive?.configured;
  const move=(i,d)=>edit(a=>{const rules=[...a.rules];const j=i+d;if(j<0||j>=rules.length)return a;[rules[i],rules[j]]=[rules[j],rules[i]];return {...a,rules}});
  async function publish(){
    if(draft.rules.some(r=>!r.name.trim()))return notify('規則名稱不可空白');
    setBusy(true);
    try{
      const out=await api.saveRouting({sovereign_only:draft.sovereign_only,default_group:draft.default_group,fallback_group:draft.fallback_group,rules:draft.rules.map(r=>({...r,name:r.name.trim()}))});
      const n=norm(out&&out.rules?out:await api.getRouting());setBase(n);setDraft(structuredClone(n));setSaved(true);notify(`已發布路由設定（版本 v${n.version}）`);
    }catch(e){notify('發布失敗：'+errText(e))}finally{setBusy(false)}
  }
  async function test(){
    setTesting(true);
    try{setRes(await api.testRouting(text));setTested(dirty)}catch(e){notify('測試失敗：'+errText(e))}finally{setTesting(false)}
  }
  return <div className="lv-o">
    <div className="page-heading"><h1><ArrowsSplit/>路由</h1><button className="btn primary" onClick={()=>setAdding(true)}><Plus/>新增規則</button></div>
    <p className="subtitle">設定 Agent 選擇「auto」模型時的路由規則。由上至下比對，第一個啟用且符合的規則生效。<span className="badge" style={{marginLeft:8}}>已發布版本 v{base.version}</span>{base.updated_by&&<span className="muted small" style={{marginLeft:8}}>{base.updated_by}{base.updated_at?' · '+new Date(base.updated_at).toLocaleString('zh-TW',{hour12:false}):''}</span>}</p>
    <div className="lv-o-policy"><Lock size={19}/><div><b>敏感資料不是路由條件</b>：去識別化一律啟用，不因內容敏感而改變路由。只有 <b>sovereign</b> 群組僅在院內（地端）執行；其他群組皆為雲端。若需確保全院資料不離院，請勾選下方「僅院內模型」；個別 Agent 也可在設定中啟用「僅用院內模型」。</div></div>
    <label className={'panel lv-o-sovereign'+(sov?' on':'')}><input type="checkbox" checked={sov} onChange={e=>edit(a=>({...a,sovereign_only:e.target.checked}))}/><div><b>僅院內模型</b><span className="muted small">勾選並發布後，所有 Agent 與對話一律使用 <b>sovereign</b>（院內／地端）模型，覆蓋下方所有規則、預設群組、Agent 與節點指定的群組；失敗時不會回退到任何雲端模型。發布後約 1 分鐘內全部生效。</span></div></label>
    {sov&&sovMissing&&<div className="lv-o-banner bad"><Warning size={16}/><div><b>目前 LiteLLM 沒有可用的 sovereign 模型。</b>啟用後所有請求都會失敗（不會改用雲端）。請先在「模型」頁新增地端模型並套用到 LiteLLM。</div></div>}
    <div className="lv-o-grid"><div>
      {sov&&<p className="lv-o-help" style={{margin:'0 0 8px'}}><Lock size={11}/> 「僅院內模型」已勾選，以下規則暫不生效（保留設定，取消勾選後恢復）。</p>}
      <div className={sov?'lv-o-overridden':''} inert={sov?'':undefined}>
      <div className="lt" style={{'--cols':'40px minmax(150px,1.6fr) minmax(130px,1fr) minmax(150px,1fr) 60px 100px'}}>
        <div className="lt-head"><span>優先</span><span>規則名稱</span><span>條件</span><span>模型群組</span><span>啟用</span><span/></div>
        {draft.rules.map((r,i)=><div className="lt-row" key={r.id}>
          <span className="lv-o-order">{i+1}</span>
          <input className="lv-o-rule-name" aria-label="規則名稱" value={r.name} onChange={e=>change(r.id,'name',e.target.value)}/>
          <span><select aria-label={'條件 '+r.name} value={r.condition} onChange={e=>change(r.id,'condition',e.target.value)}>{CONDITIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></span>
          <GroupSelect label={'模型群組 '+r.name} value={r.group} onChange={v=>change(r.id,'group',v)}/>
          <Toggle on={r.enabled} label={'啟用 '+r.name} onChange={v=>change(r.id,'enabled',v)}/>
          <span className="lt-actions"><button className="icon-btn" aria-label={'上移 '+r.name} disabled={i===0} onClick={()=>move(i,-1)}><ArrowUp/></button><button className="icon-btn" aria-label={'下移 '+r.name} disabled={i===draft.rules.length-1} onClick={()=>move(i,1)}><ArrowDown/></button><button className="icon-btn" aria-label={'刪除 '+r.name} onClick={()=>edit(a=>({...a,rules:a.rules.filter(x=>x.id!==r.id)}))}><Trash/></button></span>
        </div>)}
        {!draft.rules.length&&<Empty text="尚無規則；未命中任何規則時使用預設群組。"/>}
      </div>
      <div className="panel lv-o-defaults">
        <div className="field"><label>未命中規則時使用</label><GroupSelect label="預設群組" value={draft.default_group} onChange={v=>edit(a=>({...a,default_group:v}))}/></div>
        <div className="field"><label>規則指向無效群組時的備援</label><GroupSelect label="備援群組" value={draft.fallback_group} onChange={v=>edit(a=>({...a,fallback_group:v}))}/><span className="lv-o-help">此處不提供 auto 選項。</span></div>
      </div>
      </div>
      <div className="lv-o-save"><span className="muted small">{dirty?'有尚未發布的變更':'與已發布版本一致'}</span><button className="btn" disabled={!dirty||busy} onClick={()=>{setDraft(structuredClone(base));setSaved(false)}}>還原</button><button className="btn primary" disabled={!dirty||busy} onClick={publish}>{busy?'發布中…':'發布'}</button></div>
      {saved&&<div className="lv-o-banner ok"><CheckCircle size={16}/><div>已發布，目前版本 v{base.version}。</div></div>}
    </div>
    <div>
      <section className="panel lv-o-card"><h3><Flask/>測試路由</h3>
        <p className="muted small">乾跑測試：以<b>已儲存（已發布）</b>的設定判斷此訊息會使用哪個群組，不會呼叫模型，也不使用畫面上尚未發布的草稿。</p>
        {dirty&&<div className="lv-o-banner" style={{marginTop:10}}><Warning size={15}/><div>草稿有未發布的變更，測試結果不會反映這些變更。請先發布再測試。</div></div>}
        <textarea aria-label="路由測試內容" rows={4} style={{width:'100%'}} value={text} onChange={e=>{setText(e.target.value);setRes(null)}}/>
        <div className="lv-o-samples">{[['複雜分析','請分析並比較兩種排班方案的優缺點'],['簡單問答','今天門診幾點開始？']].map(([a,b])=><button key={a} onClick={()=>{setText(b);setRes(null)}}>{a}</button>)}</div>
        <button className="btn primary" disabled={!text.trim()||testing} onClick={test}><Flask/>{testing?'測試中…':'執行測試'}</button>
        {res&&<div className="lv-o-result"><span className="badge">已儲存設定的測試結果</span><h2>{res.group}</h2><p>{res.reason}</p><span className="lv-o-sub">命中規則：{res.matched_rule?(base.rules.find(r=>r.id===res.matched_rule)?.name||res.matched_rule):'無（使用預設群組）'}</span>{tested&&<span className="lv-o-sub">測試時草稿尚有未發布變更。</span>}</div>}
      </section>
      <section className="panel lv-o-card" style={{marginTop:16}}><h3><Lightning/>群組說明</h3><div className="lv-o-groupdesc">{GROUPS.map(([id,l,d])=><div key={id}><b>{l}</b><br/><span className="muted">{d}</span></div>)}</div></section>
      <section className="panel lv-o-card" style={{marginTop:16}}><h3><Info/>條件說明</h3><div className="lv-o-groupdesc">{CONDITIONS.map(([v,l,d])=><div key={v}><b>{l}</b><br/><span className="muted">{d}</span></div>)}</div></section>
    </div></div>
    <h2 style={{fontSize:16,margin:'28px 0 10px'}}>目前群組與備援（LiteLLM 即時路由表）</h2>
    <LiveGroupTable groups={groups} failed={gfail}/>
    <div className="notice"><Info/>此頁編輯的是 Agent「auto」模型的路由規則；套用成本上限與「僅用院內模型」仍會在路由之後生效。</div>
    {adding&&<AddModal title="新增規則" hint="新規則加在清單最後，可再調整順序；發布後才會生效。" onClose={()=>setAdding(false)} onSubmit={f=>{const name=String(f.get('name')).trim();if(!name)return;edit(a=>({...a,rules:[...a.rules,{id:uid(),name,condition:f.get('condition'),group:f.get('group'),enabled:true}]}));setAdding(false)}}>
      <Field label="規則名稱"><input name="name" required autoFocus placeholder="例如：衛教文件草擬"/></Field>
      <div className="inline"><Field label="當任務為"><select name="condition" defaultValue="complex">{CONDITIONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="使用模型群組"><select name="group" defaultValue="fast">{GROUPS.map(([id,l])=><option key={id} value={id}>{l}</option>)}</select></Field></div>
    </AddModal>}
  </div>;
}
