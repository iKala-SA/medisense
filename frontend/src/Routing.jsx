import React,{useState} from 'react';
import {Lightning,Flask,Plus,ArrowUp,ArrowDown,Trash,Lock,CheckCircle} from '@phosphor-icons/react';
import {Toggle,AddModal,Field} from './ListKit';
export const initialRouting={version:1,defaultGroup:'Budget',fallback:'On-Premise',rules:[{id:'sensitive',name:'敏感資料強制地端',condition:'敏感資料',group:'On-Premise',enabled:true,locked:true},{id:'complex',name:'多步分析與深度研究',condition:'複雜任務',group:'Cloud',enabled:true},{id:'simple',name:'一般問答與簡短摘要',condition:'簡單任務',group:'Fast',enabled:true}]};
export function resolveRoute(config,{sensitive,complex,manual='Auto'}){if(sensitive)return {group:'On-Premise',reason:'敏感資料最高優先政策：強制地端，禁止雲端備援'};if(manual!=='Auto')return {group:manual,reason:'依使用者手動選擇；敏感資料政策仍優先套用'};const rule=config.rules.find(r=>r.enabled&&(r.condition==='所有一般任務'||(complex?r.condition==='複雜任務':r.condition==='簡單任務')));return {group:rule?.group||config.defaultGroup,reason:rule?`命中規則：${rule.name}`:'未命中規則，使用預設模型群組'};}
const conditions=['複雜任務','簡單任務','所有一般任務'];
const groups=['Fast','Budget','Cloud','On-Premise'];
export function Routing({config,onPublish,onLog}){
const [draft,setDraft]=useState(()=>structuredClone(config)),[sample,setSample]=useState('請整理姓名「測試病人甲」、病歷號 DEMO-000123 的交班格式。'),[result,setResult]=useState(null),[saved,setSaved]=useState(false),[adding,setAdding]=useState(false);
const dirty=JSON.stringify(draft)!==JSON.stringify(config);
const edit=fn=>{setDraft(fn);setSaved(false);setResult(null)};
const change=(id,key,value)=>edit(a=>({...a,rules:a.rules.map(r=>r.id===id?{...r,[key]:value}:r)}));
const move=(index,dir)=>edit(a=>{const rules=[...a.rules];if(index+dir<1||index+dir>=rules.length)return a;[rules[index],rules[index+dir]]=[rules[index+dir],rules[index]];return {...a,rules}});
return <><div className="page-heading"><h1>路由</h1><button className="btn primary" onClick={()=>setAdding(true)}><Plus/>新增規則</button></div>
<p className="subtitle">設定模型選擇規則、優先順序與備援，讓每次請求遵循相同政策。由上至下比對，第一個符合的規則生效。<span className="badge" style={{marginLeft:8}}>目前示範版本 v{config.version}</span></p>
<div className="routing-lock"><Lock size={19}/><span><b>敏感資料保護優先於手動模型選擇</b><small>命中敏感資料 → 強制 On-Premise；院內模型不可用時中止請求，不轉送雲端。</small></span></div>
<div className="lt" style={{'--cols':'44px minmax(180px,2fr) minmax(120px,1fr) minmax(120px,1fr) 70px 108px'}}>
<div className="lt-head"><span>優先</span><span>規則名稱</span><span>條件</span><span>模型群組</span><span>啟用</span><span/></div>
{draft.rules.map((r,i)=><div className={'lt-row '+(r.locked?'locked-rule':'')} key={r.id}>
<span className="rule-order">{i+1}</span>
<span className="lt-name"><input aria-label="規則名稱" value={r.name} disabled={r.locked} onChange={e=>change(r.id,'name',e.target.value)}/>{r.locked&&<span className="badge"><Lock size={11}/>必要政策</span>}</span>
{r.locked?<span>敏感資料</span>:<select aria-label={'條件 '+r.name} value={r.condition} onChange={e=>change(r.id,'condition',e.target.value)}>{conditions.map(x=><option key={x}>{x}</option>)}</select>}
<select aria-label={'模型群組 '+r.name} value={r.group} disabled={r.locked} onChange={e=>change(r.id,'group',e.target.value)}>{groups.map(g=><option key={g}>{g}</option>)}</select>
{r.locked?<Toggle on label="必要政策恆啟用" onChange={()=>{}}/>:<Toggle on={r.enabled} label={'啟用 '+r.name} onChange={v=>change(r.id,'enabled',v)}/>}
{r.locked?<span/>:<span className="lt-actions"><button className="icon-btn" aria-label={'上移 '+r.name} disabled={i===1} onClick={()=>move(i,-1)}><ArrowUp/></button><button className="icon-btn" aria-label={'下移 '+r.name} disabled={i===draft.rules.length-1} onClick={()=>move(i,1)}><ArrowDown/></button><button className="icon-btn" aria-label={'刪除 '+r.name} onClick={()=>edit(a=>({...a,rules:a.rules.filter(x=>x.id!==r.id)}))}><Trash/></button></span>}
</div>)}
</div>
<div className="panel routing-defaults-panel"><div className="field"><label>未命中規則時</label><select value={draft.defaultGroup} onChange={e=>edit(a=>({...a,defaultGroup:e.target.value}))}>{groups.map(g=><option key={g}>{g}</option>)}</select></div><div className="field"><label>一般請求的備援模型</label><select value={draft.fallback} onChange={e=>edit(a=>({...a,fallback:e.target.value}))}>{groups.map(g=><option key={g}>{g}</option>)}</select><small className="muted">敏感資料不使用雲端備援。</small></div></div>
<div className="routing-save"><span className="muted small">{dirty?'有未發布的變更（發布前請先執行模擬測試）':'設定與目前版本一致'}</span><button className="btn" onClick={()=>{setDraft(structuredClone(config));setResult(null);setSaved(false)}}>還原設定</button><button className="btn primary" disabled={!dirty||!result} onClick={()=>{onPublish({...draft,version:config.version+1});setSaved(true);setResult(null)}}>發布示範設定</button></div>
{saved&&<div className="routing-success"><CheckCircle/>設定已套用至原型的對話路由。未寫入實際 LiteLLM。</div>}
<div className="routing-below"><section className="panel routing-test"><h3><Flask/>測試路由</h3><p className="muted small">使用草稿規則，預覽此請求會選擇哪個模型。</p><textarea aria-label="路由測試內容" rows={4} value={sample} onChange={e=>{setSample(e.target.value);setResult(null)}}/><div className="test-samples">{[['簡單問答','請說明什麼是院內知識庫'],['複雜分析','請完整分析並比較院內 AI 導入策略'],['敏感資料','請整理姓名「測試病人甲」、病歷號 DEMO-000123 的交班格式。']].map(([s,t])=><button key={s} onClick={()=>{setSample(t);setResult(null)}}>{s}</button>)}</div><button className="btn primary" disabled={!sample.trim()} onClick={()=>{const sensitive=/DEMO-|病歷號|姓名/.test(sample),complex=/比較|分析|複雜|完整|研究|策略/.test(sample);setResult({...resolveRoute(draft,{sensitive,complex}),sensitive});onLog('Routing 草稿測試')}}><Flask/>執行模擬測試</button>{result&&<div className="routing-result"><span className="badge">模擬結果</span><h2>{result.group}</h2><p>{result.reason}</p><small>資料分級：{result.sensitive?'敏感（合成）':'內部（合成）'}</small><small>失敗處理：{result.sensitive?'中止請求，禁止雲端備援':`使用 ${draft.fallback} 備援（尚未模擬模型失敗）`}</small></div>}</section>
<section className="panel routing-groups"><h3><Lightning/>模型群組</h3>{[['Fast','低延遲一般問答'],['Budget','成本優先的簡單任務'],['Cloud','複雜分析與深度研究'],['On-Premise','院內執行與敏感資料']].map(([a,b])=><div key={a}><b>{a}</b><span>{b}</span><small>尚未連接模型端點</small></div>)}</section></div>
<p className="muted small">所有條件偵測與路由均為原型模擬。發布只影響本次瀏覽器工作階段；實際安全保障、故障轉移與模型閘道尚未連線驗證。</p>
{adding&&<AddModal title="新增規則" hint="新規則加在清單最後，可再調整順序。" onClose={()=>setAdding(false)} onSubmit={f=>{edit(a=>({...a,rules:[...a.rules,{id:crypto.randomUUID(),name:f.get('name').trim(),condition:f.get('condition'),group:f.get('group'),enabled:true}]}));setAdding(false)}}>
<Field label="規則名稱"><input name="name" required autoFocus placeholder="例如：衛教文件草擬"/></Field>
<div className="inline"><Field label="當任務為"><select name="condition">{conditions.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="使用模型群組"><select name="group" defaultValue="Budget">{groups.map(g=><option key={g}>{g}</option>)}</select></Field></div>
</AddModal>}</>}
