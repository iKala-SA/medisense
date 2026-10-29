import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Plus,DotsSixVertical,Copy,Trash,Warning,WarningCircle,Info,X,Sparkle,Globe,BookOpen} from '@phosphor-icons/react';
import {api} from '../api';
import MentionEditor from './MentionEditor';
import {TONE,CATS,STEP_TYPES,ON_ERROR,newStep,validate,summary,refsOf,uid,REF} from './stepkit';

const Switch=({on,onChange,label})=><button type="button" role="switch" aria-checked={on} aria-label={label} className={'ag-switch'+(on?' on':'')} onClick={()=>onChange(!on)}><span/></button>;


export const Tile=({tone,children,size=44})=><span className="ag-tile" style={{width:size,height:size,background:TONE[tone][0],color:TONE[tone][1]}}>{children}</span>;

/* Two-column step picker (reference layout): AI 回應 + 流程邏輯 on the left, 資料洞察 + 動作 + 使用者輸入 on the right. */
function AddMenu({anchor,onPick,onClose}){
  const pop=useRef(null);
  useLayoutEffect(()=>{ // a fixed popover next to the button: never clipped by the scrolling canvas, always inside the window
    const el=pop.current;if(!el||!anchor)return;
    const r=anchor.getBoundingClientRect(),W=window.innerWidth,H=window.innerHeight,w=Math.min(760,W-24);
    el.style.width=w+'px';const h=el.getBoundingClientRect().height;
    let left=Math.round(r.left+r.width/2-w/2);left=Math.max(12,Math.min(left,W-w-12));
    let top=r.bottom+8;if(top+h>H-8)top=r.top-h-8>8?r.top-h-8:Math.max(8,H-8-h);
    el.style.left=left+'px';el.style.top=top+'px';
  });
  useEffect(()=>{const k=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[onClose]);
  const col=keys=>keys.map(key=>{const label=CATS.find(c=>c[1]===key)[0];return <div key={key} className="ag-addcat"><h5>{label}</h5>
    {Object.entries(STEP_TYPES).filter(([,m])=>m.cat===key&&m.inMenu!==false).map(([type,m])=>{const I=m.icon;return <button key={type} type="button" role="menuitem" disabled={!m.ready} onClick={()=>{onPick(type);onClose()}}>
      <Tile tone={key} size={40}><I size={20}/></Tile><span><b>{m.label}{!m.ready&&<em>即將推出</em>}</b><small>{m.hint}</small></span></button>})}</div>});
  return createPortal(<div className="ag-addmenu" role="menu"><div className="ag-dismiss" onClick={onClose}/><div className="ag-addpop" ref={pop}><div>{col(['input','ai'])}</div><div>{col(['action','logic'])}</div></div></div>,document.body);
}

const SOURCES=[['llm_generate','一般知識',Sparkle],['web_search','Web 搜尋',Globe],['knowledge_query','內部知識',BookOpen]];
const Counter=({v,max})=><small className="ag-count">{(v||'').length} / {max} 字元</small>;
export function Config({st,idx,steps,set,connectors,spaces=[],canEdit}){
  const before=steps.slice(0,idx),c=st.config||{},setC=p=>set({config:{...c,...p}});
  const [acts,setActs]=useState([]);
  useEffect(()=>{if(st.type==='action'&&c.connector_id)api.connectorActions(c.connector_id).then(l=>setActs(l||[])).catch(()=>setActs([]));else setActs([])},[st.type,c.connector_id]);
  const isAI=SOURCES.some(x=>x[0]===st.type),empty=!String(c.prompt||'').trim();
  const switchSource=t=>{if(t===st.type||!canEdit)return;const old=STEP_TYPES[st.type].label;set({type:t,title:st.title.startsWith(old)?STEP_TYPES[t].label+st.title.slice(old.length):st.title})};
  const prompt=<div className="ag-field"><label className={empty?'bad':''}>提示 <Info size={13}/></label>
    <MentionEditor value={c.prompt||''} invalid={empty} steps={before} placeholder="在這裡描述您希望做什麼…" onChange={v=>setC({prompt:v})}/>
    {empty&&<small className="ag-err">需要提示</small>}<small className="ag-help">輸入 @ 以參考前面步驟的輸入或輸出。</small><Counter v={c.prompt} max={5000}/></div>;
  const sources=<div className="ag-field"><label>來源 <Info size={13}/></label><div className="ag-srctabs" role="tablist">{SOURCES.map(([t,l,I])=><button key={t} role="tab" aria-selected={st.type===t} className={st.type===t?'on':''} onClick={()=>switchSource(t)}><I size={16}/>{l}</button>)}</div></div>;
  return <div className="ag-cfg" aria-disabled={!canEdit}>
    {st.type==='text_input'&&<>
      <div className="ag-field"><label>預留位置</label><textarea rows={2} maxLength={500} value={c.placeholder||''} onChange={e=>setC({placeholder:e.target.value})}/><small className="ag-help">當使用者輸入內容時，此文字將會消失。此文字不會用於流程執行。</small><Counter v={c.placeholder} max={500}/></div>
      <div className="ag-field"><label>預設值（選用）</label><textarea rows={2} maxLength={5000} value={c.default||''} onChange={e=>setC({default:e.target.value})}/><small className="ag-help">如果使用者未提供輸入，將會使用的值。</small><Counter v={c.default} max={5000}/></div>
      <label className="ag-check"><input type="checkbox" checked={c.allow_override!==false} onChange={e=>setC({allow_override:e.target.checked})}/>允許覆寫預設值</label>
      <label className="ag-check"><input type="checkbox" checked={c.required!==false} onChange={e=>setC({required:e.target.checked})}/>必填</label></>}
    {st.type==='file_upload'&&<>
      <p className="ag-muted">執行時請使用者上傳檔案（PDF、Word、PowerPoint、純文字、CSV 等）。系統會讀出文字並先去識別化，原檔不會保存；大小上限由管理員政策決定。</p>
      <label className="ag-check"><input type="checkbox" checked={c.required!==false} onChange={e=>setC({required:e.target.checked})}/>必填</label></>}
    {isAI&&<>{prompt}{sources}</>}
    {st.type==='llm_generate'&&<>
      <div className="ag-field"><label>輸出偏好設定 <Info size={13}/></label><div className="ag-radios" role="radiogroup">
        {[['fast','快速回應','跨影像、視訊和文字輸入'],['balanced','多功能性和效能','適用於各種任務的平衡功能']].map(([v,t,d])=><button key={v} type="button" role="radio" aria-checked={(c.output_pref||'balanced')===v} className={(c.output_pref||'balanced')===v?'on':''} onClick={()=>setC({output_pref:v})}><span><b>{t}</b><small>{d}</small></span><i/></button>)}</div></div>
      <div className="ag-field"><label>創意等級（選用）<small>{Number(c.creativity??0.3).toFixed(1)}（低＝穩定，高＝多變）</small></label><input type="range" min={0} max={1} step={0.1} value={c.creativity??0.3} onChange={e=>setC({creativity:Number(e.target.value)})}/></div></>}
    {st.type==='web_search'&&<p className="ag-muted">需要管理員開放網路搜尋；搜尋詞會先去識別化。結果會附來源，且會隨網路內容變化。</p>}
    {st.type==='knowledge_query'&&<div className="ag-field"><label>指定資源（選用）<small>不選就查詢這個 Agent 設定的知識空間與參考文件</small></label>
      <div className="ag-checklist">{spaces.map(sp=><label key={sp.id} className="ag-check"><input type="checkbox" checked={(c.spaces||[]).includes(sp.id)} onChange={e=>setC({spaces:e.target.checked?[...(c.spaces||[]),sp.id]:(c.spaces||[]).filter(x=>x!==sp.id)})}/>{sp.name}</label>)}{!spaces.length&&<span className="ag-muted">沒有可選的知識空間</span>}</div>
      <small className="ag-help">只會取回執行者本人有權限的內容，並附引用來源。</small></div>}
    {st.type==='action'&&<>
      <div className="ag-field"><label>連接器</label><select value={c.connector_id||''} onChange={e=>setC({connector_id:e.target.value,action:''})}><option value="">選擇連接器</option>{connectors.map(x=><option key={x.id} value={x.id}>{x.name||x.label||x.type}</option>)}</select></div>
      <div className="ag-field"><label>動作</label><select value={c.action||''} disabled={!c.connector_id} onChange={e=>setC({action:e.target.value})}><option value="">選擇動作</option>{acts.map(x=><option key={x.id} value={x.id}>{x.label||x.id}</option>)}</select></div>
      {prompt}
      <label className="ag-check"><input type="checkbox" checked={c.require_approval!==false} onChange={e=>setC({require_approval:e.target.checked})}/>執行前需要核准（寫入類動作建議開啟）</label></>}
    <div className="ag-field"><label>描述（選填）</label><input value={st.description||''} maxLength={300} onChange={e=>set({description:e.target.value})}/></div>
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
  const [add,setAdd]=useState(null),[anchor,setAnchor]=useState(null),[drag,setDrag]=useState(null),[over,setOver]=useState(null),[banner,setBanner]=useState(true);
  const problems=useMemo(()=>validate(steps),[steps]);
  const put=(i,type)=>{const s=newStep(type,steps);const n=[...steps];n.splice(i,0,s);setSteps(n);setSel(s.id)};
  const move=(from,to)=>{if(from===to||from+1===to)return;const n=[...steps],[m]=n.splice(from,1);n.splice(to>from?to-1:to,0,m);setSteps(n)};
  const errFor=id=>problems.filter(p=>p.step_id===id);
  const errs=problems.filter(p=>p.level==='error').length;
  const cap=agent.capabilities;
  return <div className="ag-canvascol" data-density={steps.length>=8?'mini':steps.length>=5?'compact':'normal'}>
    {banner&&<div className="ag-info"><Info size={20}/><span>步驟的輸入與輸出都會先去識別化再交給模型；寫入類動作預設要你核准後才會執行。</span><button aria-label="關閉" onClick={()=>setBanner(false)}><X size={16}/></button></div>}
    {errs>0&&<div className="ag-banner err" role="status"><Warning size={16}/><div><b>{errs} 個錯誤，修正後才能發布</b><ul>{problems.filter(p=>p.level==='error').slice(0,5).map((p,i)=><li key={i}><button type="button" onClick={()=>p.step_id&&setSel(p.step_id)}>{p.message}</button></li>)}</ul></div></div>}
    <div className={'ag-node agentnode'+(sel==='agent'?' on':'')} onClick={()=>setSel('agent')}>
      <span className="grip off"/><Tile tone="agent"><span className="em">{agent.icon||'✦'}</span></Tile>
      <div className="bd"><h4>Agent 設定</h4><p className="pr">{(agent.instructions||'').slice(0,90)||'尚未填寫角色指令'}</p>
        <div className="chips">{cap.web_search&&<span className="ag-chip">網路搜尋</span>}{cap.connectors.length>0&&<span className="ag-chip">{cap.connectors.length} 個連接器</span>}{cap.spaces.length>0&&<span className="ag-chip">{cap.spaces.length} 個知識空間</span>}<span className="ag-chip">{PREF[cap.model_pref]}</span></div></div>
    </div>
    {steps.map((s,i)=>{const m=STEP_TYPES[s.type]||STEP_TYPES.llm_generate,I=m.icon,e=errFor(s.id);return <React.Fragment key={s.id}>
      <div className={'ag-gap'+(over===i?' over':'')} onDragOver={ev=>{if(drag!=null){ev.preventDefault();setOver(i)}}} onDrop={()=>{move(drag,i);setDrag(null);setOver(null)}}>
        {canEdit&&<span className="ag-gapbtn"><button type="button" aria-label="在這裡新增步驟" onClick={e=>{setAnchor(e.currentTarget);setAdd(add===i?null:i)}}><Plus size={14}/></button>{add===i&&<AddMenu anchor={anchor} onPick={t=>put(i,t)} onClose={()=>setAdd(null)}/>}</span>}</div>
      <div className={'ag-node'+(s.id===sel?' on':'')+(s.enabled?'':' off')+(drag===i?' drag':'')} draggable={canEdit} onDragStart={()=>setDrag(i)} onDragEnd={()=>{setDrag(null);setOver(null)}} onClick={()=>setSel(s.id)}>
        <span className="grip">{canEdit&&<DotsSixVertical size={18}/>}</span><Tile tone={m.cat}><I size={22}/></Tile>
        <div className="bd"><h4>{s.title}{!s.enabled&&<span className="ag-chip">已停用</span>}{e.some(x=>x.level==='error')?<WarningCircle size={18} weight="fill" className="bad"/>:e.length?<Warning size={18} weight="fill" className="warn"/>:null}</h4>
          <CardBody st={s} steps={steps.slice(0,i)} connectors={connectors} pref={agent.capabilities.model_pref}/></div>
      </div></React.Fragment>})}
    {canEdit&&<div className="ag-addrow"><button type="button" className="ag-addpill" onClick={e=>{setAnchor(e.currentTarget);setAdd(add==='end'?null:'end')}}><Plus size={17}/>新增步驟</button>{add==='end'&&<AddMenu anchor={anchor} onPick={t=>put(steps.length,t)} onClose={()=>setAdd(null)}/>}</div>}
    {!steps.length&&<p className="ag-muted center">沒有步驟時，這就是一個純對話 Agent。需要固定流程（輸入 → 查資料 → 產出 → 寄送）時，新增步驟。</p>}
  </div>;
}

/** The left card: edit the selected step (delete / duplicate at the bottom). */
export function StepEditPanel({steps,setSteps,sel,setSel,connectors,spaces,canEdit}){
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
  return <><div className="ag-editbody"><div className="ag-editcard">
    <h3><Tile tone={m.cat} size={40}><I size={20}/></Tile><span className="ttl"><span className="t" title={st.title}>{st.title||'（未命名步驟）'}</span><small>{m.label}</small></span>
      <button type="button" role="switch" aria-checked={st.enabled} aria-label="啟用這個步驟" title={st.enabled?'已啟用：點一下停用（執行時略過）':'已停用：點一下啟用'} className={'ag-switch'+(st.enabled?' on':'')} onClick={()=>patch({enabled:!st.enabled})}><span/></button></h3>
    <div className="ag-field"><label htmlFor="step-title">標題</label><input id="step-title" aria-label="標題" value={st.title} maxLength={60} disabled={!canEdit} onChange={e=>patch({title:e.target.value})}/><small className="ag-count">{st.title.length} / 60 字元</small></div>
    <Config st={st} idx={idx} steps={steps} set={patch} connectors={connectors} spaces={spaces} canEdit={canEdit}/>
  </div></div>
  {canEdit&&<div className="ag-editfoot"><button className="ag-btn dangerline" onClick={del}><Trash size={15}/>刪除</button><button className="ag-btn greenline" onClick={dup}><Copy size={15}/>複製</button></div>}</>;
}
