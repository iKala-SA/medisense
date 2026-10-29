import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Plus,DotsSixVertical,Copy,Trash,Warning,WarningCircle,Eye,EyeSlash,Lock} from '@phosphor-icons/react';
import {api} from '../api';
import MentionEditor from './MentionEditor';
import {CATS,STEP_TYPES,ON_ERROR,newStep,validate,summary,refsOf,uid,REF} from './stepkit';

const Switch=({on,onChange,label})=><button type="button" role="switch" aria-checked={on} aria-label={label} className={'ag-switch'+(on?' on':'')} onClick={()=>onChange(!on)}><span/></button>;

function AddMenu({onPick,onClose}){
  return <div className="ag-addmenu" role="menu"><div className="ag-dismiss" onClick={onClose}/><div className="ag-addpop">
    {CATS.map(([label,key])=>{const items=Object.entries(STEP_TYPES).filter(([,m])=>m.cat===key);return <div key={key}><h5>{label}</h5>
      {items.map(([type,m])=>{const I=m.icon;return <button key={type} type="button" role="menuitem" disabled={!m.ready} onClick={()=>{onPick(type);onClose()}}><I size={17}/><span><b>{m.label}</b><small>{m.ready?m.hint:'即將推出'}</small></span>{!m.ready&&<Lock size={12}/>}</button>})}</div>})}
  </div></div>;
}

function Config({st,idx,steps,set,connectors,canEdit}){
  const before=steps.slice(0,idx),c=st.config||{},setC=p=>set({config:{...c,...p}});
  const [acts,setActs]=useState([]);
  useEffect(()=>{if(st.type==='action'&&c.connector_id)api.connectorActions(c.connector_id).then(l=>setActs(l||[])).catch(()=>setActs([]));else setActs([])},[st.type,c.connector_id]);
  const prompt=<div className="ag-field"><label>提示詞 <small>輸入 @ 引用前面 Step 的輸出</small></label>
    <MentionEditor value={c.prompt||''} steps={before.filter(s=>s.enabled||true)} placeholder="描述要做什麼…" onChange={v=>setC({prompt:v})}/></div>;
  return <div className="ag-cfg" aria-disabled={!canEdit}>
    <div className="ag-field"><label>標題 <small>流程內不可重複；其他 Step 用 @標題 引用</small></label><input aria-label="Step 標題" value={st.title} maxLength={60} onChange={e=>set({title:e.target.value})}/></div>
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

export default function StepsPanel({steps,setSteps,connectors,canEdit}){
  const [sel,setSel]=useState(steps[0]?.id||null),[add,setAdd]=useState(null),[drag,setDrag]=useState(null),[over,setOver]=useState(null);
  const problems=useMemo(()=>validate(steps),[steps]);
  const idx=steps.findIndex(s=>s.id===sel),st=steps[idx];
  useEffect(()=>{if(!steps.some(s=>s.id===sel))setSel(steps[0]?.id||null)},[steps.length]);// eslint-disable-line
  const put=(i,type)=>{const s=newStep(type,steps);const n=[...steps];n.splice(i,0,s);setSteps(n);setSel(s.id)};
  const patch=p=>setSteps(steps.map(s=>s.id===sel?{...s,...p}:s));
  const dup=()=>{const s={...st,id:'s'+uid(),title:st.title+' (複本)',config:JSON.parse(JSON.stringify(st.config||{}))};const n=[...steps];n.splice(idx+1,0,s);setSteps(n);setSel(s.id)};
  const del=()=>{
    const users=steps.filter(s=>s.id!==st.id&&refsOf(s).includes(st.id));
    if(!window.confirm(users.length?`刪除「${st.title}」後，下列 Step 對它的 @ 引用會一併移除：\n${users.map(u=>'・'+u.title).join('\n')}\n\n確定刪除？`:`刪除「${st.title}」？`))return;
    const strip=v=>typeof v==='string'?v.replace(REF,m=>m.includes(st.id)?'':m):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,strip(x)])):v;
    setSteps(steps.filter(s=>s.id!==st.id).map(s=>({...s,config:strip(s.config)})));
  };
  const move=(from,to)=>{if(from===to||from+1===to)return;const n=[...steps],[m]=n.splice(from,1);n.splice(to>from?to-1:to,0,m);setSteps(n)};
  const errFor=id=>problems.filter(p=>p.step_id===id);
  const errs=problems.filter(p=>p.level==='error').length,warns=problems.filter(p=>p.level==='warning').length;
  return <div className="ag-steps">
    {problems.length>0&&<div className={'ag-banner '+(errs?'err':'warn')} role="status"><Warning size={16}/><div><b>{errs?`${errs} 個錯誤，修正後才能發布`:`${warns} 個提醒`}</b>
      <ul>{problems.slice(0,6).map((p,i)=><li key={i}><button type="button" onClick={()=>p.step_id&&setSel(p.step_id)}>{p.message}</button></li>)}</ul></div></div>}
    <div className="ag-steps-grid">
      <div className="ag-steplist">
        {steps.map((s,i)=>{const m=STEP_TYPES[s.type]||STEP_TYPES.llm_generate,I=m.icon,e=errFor(s.id);return <React.Fragment key={s.id}>
          <div className={'ag-insert'+(over===i?' over':'')} onDragOver={ev=>{if(drag!=null){ev.preventDefault();setOver(i)}}} onDrop={()=>{move(drag,i);setDrag(null);setOver(null)}}>
            {canEdit&&<button type="button" aria-label="在這裡新增 Step" onClick={()=>setAdd(add===i?null:i)}><Plus size={13}/></button>}{add===i&&<AddMenu onPick={t=>put(i,t)} onClose={()=>setAdd(null)}/>}</div>
          <div className={'ag-step'+(s.id===sel?' on':'')+(s.enabled?'':' off')+(drag===i?' drag':'')} draggable={canEdit} onDragStart={()=>setDrag(i)} onDragEnd={()=>{setDrag(null);setOver(null)}} onClick={()=>setSel(s.id)}>
            {canEdit&&<DotsSixVertical size={16} className="grip"/>}<span className="ic"><I size={18}/></span>
            <div className="tx"><b>{i+1}. {s.title}</b><small>{summary(s,connectors)}</small></div>
            {e.some(x=>x.level==='error')?<WarningCircle size={17} weight="fill" className="bad"/>:e.length?<Warning size={17} weight="fill" className="warn"/>:null}{!s.enabled&&<EyeSlash size={15}/>}
          </div></React.Fragment>})}
        <div className={'ag-insert last'+(over===steps.length?' over':'')} onDragOver={ev=>{if(drag!=null){ev.preventDefault();setOver(steps.length)}}} onDrop={()=>{move(drag,steps.length);setDrag(null);setOver(null)}}>
          {canEdit&&<button type="button" className="ag-add wide" onClick={()=>setAdd(add===steps.length?null:steps.length)}><Plus size={14}/>新增 Step</button>}{add===steps.length&&<AddMenu onPick={t=>put(steps.length,t)} onClose={()=>setAdd(null)}/>}</div>
        {!steps.length&&<p className="ag-muted center">沒有步驟時，這就是一個純對話 Agent。需要固定流程（輸入 → 查資料 → 產出 → 寄送）時，新增 Step。</p>}
      </div>
      <div className="ag-stepcfg">
        {st?<><div className="ag-cfg-head"><b>{(STEP_TYPES[st.type]||{}).label}</b>
            <span><button className="ag-icon" title={st.enabled?'停用這個 Step':'啟用這個 Step'} aria-label="啟用或停用" onClick={()=>patch({enabled:!st.enabled})}>{st.enabled?<Eye size={16}/>:<EyeSlash size={16}/>}</button>
              {canEdit&&<><button className="ag-icon" title="複製" aria-label="複製" onClick={dup}><Copy size={16}/></button><button className="ag-icon danger" title="刪除" aria-label="刪除" onClick={del}><Trash size={16}/></button></>}</span></div>
          {!st.enabled&&<p className="ag-muted">這個 Step 已停用，執行時會略過。</p>}
          <Config st={st} idx={idx} steps={steps} set={patch} connectors={connectors} canEdit={canEdit}/></>
          :<p className="ag-muted center">選擇左邊的 Step 來設定，或新增一個。</p>}
      </div>
    </div>
  </div>;
}
