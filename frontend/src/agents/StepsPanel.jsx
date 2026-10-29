import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Plus,DotsSixVertical,Copy,Trash,Warning,WarningCircle,Info,X} from '@phosphor-icons/react';
import {api} from '../api';
import MentionEditor from './MentionEditor';
import {TONE,CATS,STEP_TYPES,ON_ERROR,newStep,validate,summary,refsOf,uid,REF} from './stepkit';

const Switch=({on,onChange,label})=><button type="button" role="switch" aria-checked={on} aria-label={label} className={'ag-switch'+(on?' on':'')} onClick={()=>onChange(!on)}><span/></button>;


export const Tile=({tone,children,size=44})=><span className="ag-tile" style={{width:size,height:size,background:TONE[tone][0],color:TONE[tone][1]}}>{children}</span>;

/* Two-column step picker (reference layout): AI 回應 + 流程邏輯 on the left, 資料洞察 + 動作 + 使用者輸入 on the right. */
function AddMenu({onPick,onClose}){
  const pop=useRef(null);useLayoutEffect(()=>{const el=pop.current;if(!el)return;el.style.transform='';const r=el.getBoundingClientRect();const dy=r.bottom>window.innerHeight-8?window.innerHeight-8-r.bottom:0;if(dy)el.style.transform=`translateY(${dy}px)`});
  const col=keys=>keys.map(key=>{const label=CATS.find(c=>c[1]===key)[0];return <div key={key} className="ag-addcat"><h5>{label}</h5>
    {Object.entries(STEP_TYPES).filter(([,m])=>m.cat===key).map(([type,m])=>{const I=m.icon;return <button key={type} type="button" role="menuitem" disabled={!m.ready} onClick={()=>{onPick(type);onClose()}}>
      <Tile tone={key} size={40}><I size={20}/></Tile><span><b>{m.label}{!m.ready&&<em>即將推出</em>}</b><small>{m.hint}</small></span></button>})}</div>});
  return <div className="ag-addmenu" role="menu"><div className="ag-dismiss" onClick={onClose}/><div className="ag-addpop" ref={pop}><div>{col(['ai','logic'])}</div><div>{col(['data','action','input'])}</div></div></div>;
}

export function Config({st,idx,steps,set,connectors,canEdit}){
  const before=steps.slice(0,idx),c=st.config||{},setC=p=>set({config:{...c,...p}});
  const [acts,setActs]=useState([]);
  useEffect(()=>{if(st.type==='action'&&c.connector_id)api.connectorActions(c.connector_id).then(l=>setActs(l||[])).catch(()=>setActs([]));else setActs([])},[st.type,c.connector_id]);
  const prompt=<div className="ag-field"><label>提示詞 <small>輸入 @ 引用前面 Step 的輸出</small></label>
    <MentionEditor value={c.prompt||''} steps={before.filter(s=>s.enabled||true)} placeholder="描述要做什麼…" onChange={v=>setC({prompt:v})}/></div>;
  return <div className="ag-cfg" aria-disabled={!canEdit}>
    <div className="ag-field"><label>描述</label><input value={st.description||''} maxLength={300} placeholder="（選填）" onChange={e=>set({description:e.target.value})}/></div>
    {st.type==='text_input'&&<>
      <div className="ag-field"><label>提示文字</label><input value={c.placeholder||''} placeholder="欄位為空時顯示" onChange={e=>setC({placeholder:e.target.value})}/></div>
      <div className="ag-field"><label>預設值</label><input value={c.default||''} onChange={e=>setC({default:e.target.value})}/></div>
      <label className="ag-inline"><Switch on={c.allow_override!==false} label="允許覆寫預設值" onChange={v=>setC({allow_override:v})}/>允許使用者覆寫預設值</label>
      <label className="ag-inline"><Switch on={c.required!==false} label="必填" onChange={v=>setC({required:v})}/>必填</label></>}
    {st.type==='file_upload'&&<>
      <p className="ag-muted">執行時請使用者上傳 PDF、Word、純文字等檔案；系統會讀出文字並先去識別化，原檔不會保存。</p>
      <label className="ag-inline"><Switch on={c.required!==false} label="必填" onChange={v=>setC({required:v})}/>必填</label></>}
    {st.type==='llm_generate'&&<>{prompt}<div className="ag-field"><label>創意程度 <small>{Number(c.creativity??0.3).toFixed(1)}（低＝穩定，高＝多變）</small></label>
      <input type="range" min={0} max={1} step={0.1} value={c.creativity??0.3} onChange={e=>setC({creativity:Number(e.target.value)})}/></div></>}
    {st.type==='web_search'&&<>{prompt}<p className="ag-muted">需要管理員開放網路搜尋；搜尋詞會先去識別化。結果會隨網路內容變化。</p></>}
    {st.type==='knowledge_query'&&<>{prompt}<p className="ag-muted">查詢 Agent 設定中的知識空間與參考文件，只會取回執行者本人有權限的內容，並附引用來源。</p></>}
    {st.type==='action'&&<>
      <div className="ag-row"><div className="ag-field grow"><label>連接器</label><select value={c.connector_id||''} onChange={e=>setC({connector_id:e.target.value,action:''})}><option value="">選擇連接器</option>{connectors.map(x=><option key={x.id} value={x.id}>{x.name||x.label||x.type}</option>)}</select></div>
        <div className="ag-field grow"><label>動作</label><select value={c.action||''} disabled={!c.connector_id} onChange={e=>setC({action:e.target.value})}><option value="">選擇動作</option>{acts.map(x=><option key={x.id} value={x.id}>{x.label||x.id}</option>)}</select></div></div>
      {prompt}
      <label className="ag-inline"><Switch on={c.require_approval!==false} label="執行前需核准" onChange={v=>setC({require_approval:v})}/>執行前需要核准（寫入類動作建議開啟）</label></>}
    <div className="ag-field"><label>失敗時</label><select value={st.on_error} onChange={e=>set({on_error:e.target.value})}>{ON_ERROR.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
  </div>;
}


/* a prompt with its @ references drawn as chips */
export function PromptView({text,steps}){
  const out=[];let at=0;const t=text||'';
  for(const m of t.matchAll(REF)){out.push(t.slice(at,m.index));const st=steps.find(x=>x.id===m[1]);out.push(<span key={m.index} className={'mt'+(st?'':' bad')}>@{st?st.title:'已刪除'}</span>);at=m.index+m[0].length}
  out.push(t.slice(at));return <>{out}</>;
}
const PREF={fast:'快速回應',balanced:'多功能性和效能',quality:'高品質'};
function CardBody({st,steps,connectors,pref}){
  const c=st.config||{};
  if(st.type==='text_input')return <p><b>預留位置：</b>{c.placeholder||'（無）'}{c.default?<span className="sep"><b>預設值：</b>{c.default}</span>:null}</p>;
  if(st.type==='file_upload')return <p>請使用者在執行時上傳檔案（先去識別化）</p>;
  if(st.type==='action'){const cn=connectors.find(x=>x.id===c.connector_id);return <><p><b>連接器：</b>{cn?(cn.name||cn.label||cn.type):'尚未選擇'}{c.action?` · ${c.action}`:''}{c.require_approval!==false&&<span className="ag-chip">執行前核准</span>}</p><p className="pr"><b>提示：</b><PromptView text={c.prompt} steps={steps}/></p></>}
  return <>{st.type==='llm_generate'&&<p><b>輸出偏好：</b>{PREF[pref]}</p>}<p className="pr"><b>提示：</b>{c.prompt?<PromptView text={c.prompt} steps={steps}/>:<em className="warn">尚未填寫</em>}</p></>;
}

/** The canvas column: info banner, the agent card, the step cards, and 「新增步驟」. */
export default function StepCanvas({steps,setSteps,sel,setSel,connectors,canEdit,agent}){
  const [add,setAdd]=useState(null),[drag,setDrag]=useState(null),[over,setOver]=useState(null),[banner,setBanner]=useState(true);
  const problems=useMemo(()=>validate(steps),[steps]);
  const put=(i,type)=>{const s=newStep(type,steps);const n=[...steps];n.splice(i,0,s);setSteps(n);setSel(s.id)};
  const move=(from,to)=>{if(from===to||from+1===to)return;const n=[...steps],[m]=n.splice(from,1);n.splice(to>from?to-1:to,0,m);setSteps(n)};
  const errFor=id=>problems.filter(p=>p.step_id===id);
  const errs=problems.filter(p=>p.level==='error').length;
  const cap=agent.capabilities;
  return <div className="ag-canvascol">
    {banner&&<div className="ag-info"><Info size={20}/><span>步驟的輸入與輸出都會先去識別化再交給模型；寫入類動作預設要你核准後才會執行。</span><button aria-label="關閉" onClick={()=>setBanner(false)}><X size={16}/></button></div>}
    {errs>0&&<div className="ag-banner err" role="status"><Warning size={16}/><div><b>{errs} 個錯誤，修正後才能發布</b><ul>{problems.filter(p=>p.level==='error').slice(0,5).map((p,i)=><li key={i}><button type="button" onClick={()=>p.step_id&&setSel(p.step_id)}>{p.message}</button></li>)}</ul></div></div>}
    <div className={'ag-node agentnode'+(sel==='agent'?' on':'')} onClick={()=>setSel('agent')}>
      <span className="grip off"/><Tile tone="agent"><span className="em">{agent.icon||'✦'}</span></Tile>
      <div className="bd"><h4>Agent 設定</h4><p className="pr">{(agent.instructions||'').slice(0,90)||'尚未填寫角色指令'}</p>
        <div className="chips">{cap.web_search&&<span className="ag-chip">網路搜尋</span>}{cap.connectors.length>0&&<span className="ag-chip">{cap.connectors.length} 個連接器</span>}{cap.spaces.length>0&&<span className="ag-chip">{cap.spaces.length} 個知識空間</span>}<span className="ag-chip">{PREF[cap.model_pref]}</span></div></div>
    </div>
    {steps.map((s,i)=>{const m=STEP_TYPES[s.type]||STEP_TYPES.llm_generate,I=m.icon,e=errFor(s.id);return <React.Fragment key={s.id}>
      <div className={'ag-gap'+(over===i?' over':'')} onDragOver={ev=>{if(drag!=null){ev.preventDefault();setOver(i)}}} onDrop={()=>{move(drag,i);setDrag(null);setOver(null)}}>
        {canEdit&&<span className="ag-gapbtn"><button type="button" aria-label="在這裡新增步驟" onClick={()=>setAdd(add===i?null:i)}><Plus size={14}/></button>{add===i&&<AddMenu onPick={t=>put(i,t)} onClose={()=>setAdd(null)}/>}</span>}</div>
      <div className={'ag-node'+(s.id===sel?' on':'')+(s.enabled?'':' off')+(drag===i?' drag':'')} draggable={canEdit} onDragStart={()=>setDrag(i)} onDragEnd={()=>{setDrag(null);setOver(null)}} onClick={()=>setSel(s.id)}>
        <span className="grip">{canEdit&&<DotsSixVertical size={18}/>}</span><Tile tone={m.cat}><I size={22}/></Tile>
        <div className="bd"><h4>{s.title}{!s.enabled&&<span className="ag-chip">已停用</span>}{e.some(x=>x.level==='error')?<WarningCircle size={18} weight="fill" className="bad"/>:e.length?<Warning size={18} weight="fill" className="warn"/>:null}</h4>
          <CardBody st={s} steps={steps.slice(0,i)} connectors={connectors} pref={agent.capabilities.model_pref}/></div>
      </div></React.Fragment>})}
    {canEdit&&<div className="ag-addrow"><button type="button" className="ag-addpill" onClick={()=>setAdd(add==='end'?null:'end')}><Plus size={17}/>新增步驟</button>{add==='end'&&<AddMenu onPick={t=>put(steps.length,t)} onClose={()=>setAdd(null)}/>}</div>}
    {!steps.length&&<p className="ag-muted center">沒有步驟時，這就是一個純對話 Agent。需要固定流程（輸入 → 查資料 → 產出 → 寄送）時，新增步驟。</p>}
  </div>;
}

/** The left card: edit the selected step (delete / duplicate at the bottom). */
export function StepEditPanel({steps,setSteps,sel,setSel,connectors,canEdit}){
  const idx=steps.findIndex(s=>s.id===sel),st=steps[idx];
  if(!st)return null;
  const m=STEP_TYPES[st.type]||{},I=m.icon;
  const patch=p=>setSteps(steps.map(s=>s.id===sel?{...s,...p}:s));
  const dup=()=>{const s={...st,id:'s'+uid(),title:st.title+' (複本)',config:JSON.parse(JSON.stringify(st.config||{}))};const n=[...steps];n.splice(idx+1,0,s);setSteps(n);setSel(s.id)};
  const del=()=>{
    const users=steps.filter(s=>s.id!==st.id&&refsOf(s).includes(st.id));
    if(!window.confirm(users.length?`刪除「${st.title}」後，下列步驟對它的 @ 引用會一併移除：\n${users.map(u=>'・'+u.title).join('\n')}\n\n確定刪除？`:`刪除「${st.title}」？`))return;
    const strip=v=>typeof v==='string'?v.replace(REF,x=>x.includes(st.id)?'':x):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,y])=>[k,strip(y)])):v;
    setSteps(steps.filter(s=>s.id!==st.id).map(s=>({...s,config:strip(s.config)})));setSel('agent');
  };
  return <div className="ag-editcard">
    <h3><Tile tone={m.cat} size={40}><I size={20}/></Tile><span className="ttl"><span className="t" title={st.title}>{st.title||'（未命名步驟）'}</span><small>{m.label}</small></span></h3>
    <div className="ag-field"><label htmlFor="step-name">步驟名稱 <small>流程內不可重複；其他步驟用 @名稱 引用</small></label><input id="step-name" aria-label="步驟名稱" value={st.title} maxLength={60} disabled={!canEdit} onChange={e=>patch({title:e.target.value})}/></div>
    <label className="ag-inline top"><Switch on={st.enabled} label="啟用" onChange={v=>patch({enabled:v})}/>啟用這個步驟（關閉後執行時略過）</label>
    <Config st={st} idx={idx} steps={steps} set={patch} connectors={connectors} canEdit={canEdit}/>
    {canEdit&&<div className="ag-editfoot"><button className="ag-btn dangerline" onClick={del}><Trash size={15}/>刪除</button><button className="ag-btn greenline" onClick={dup}><Copy size={15}/>複製</button></div>}
  </div>;
}
