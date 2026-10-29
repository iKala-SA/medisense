import React,{useRef,useState} from 'react';
import {X,Play,UploadSimple,PaperPlaneRight,CircleNotch} from '@phosphor-icons/react';
import {api} from '../api';
import RunView from './RunView';

/* Test run of the DRAFT. Agents with steps: a form made from the input steps, then the run. Chat-only agents: a small chat. */
export default function RunDrawer({agent,onClose,notify,onRan}){
  const inputs=agent.steps.filter(s=>(s.type==='text_input'||s.type==='file_upload')&&s.enabled);
  const [vals,setVals]=useState(()=>Object.fromEntries(inputs.filter(s=>s.type==='text_input').map(s=>[s.id,s.config?.default||''])));
  const [files,setFiles]=useState({}),[run,setRun]=useState(null),[busy,setBusy]=useState(false);
  const [chat,setChat]=useState([]),[msg,setMsg]=useState(''),sid=useRef(null);
  const upload=async(st,f)=>{
    setFiles(x=>({...x,[st.id]:{name:f.name,busy:true}}));
    try{const r=await api.uploadRunFile(agent.id,f);setVals(v=>({...v,[st.id]:r.id}));setFiles(x=>({...x,[st.id]:{name:r.name,chars:r.chars}}))}
    catch(e){setFiles(x=>({...x,[st.id]:null}));notify(e.message)}
  };
  const start=async()=>{setBusy(true);try{const r=await api.startStepRun(agent.id,vals,false);setRun(r);onRan?.()}catch(e){notify(e.message)}finally{setBusy(false)}};
  const send=async()=>{
    const text=msg.trim();if(!text||busy)return;setMsg('');setChat(c=>[...c,{role:'user',text}]);setBusy(true);
    try{const r=await api.run(agent.id,text,sid.current||undefined,false);sid.current=r.session_id;setChat(c=>[...c,{role:'assistant',text:r.reply}])}
    catch(e){setChat(c=>[...c,{role:'error',text:e.message}])}finally{setBusy(false)}
  };
  return <div className="ag-drawer" role="dialog" aria-label="測試執行">
    <header><h3>{agent.steps.length?'測試執行':'對話測試'}<small>使用目前的草稿</small></h3><button className="ag-icon" aria-label="關閉" onClick={onClose}><X size={18}/></button></header>
    <div className="ag-drawer-body">
    {agent.steps.length?<>
      {!run&&<div className="ag-form">
        {!inputs.length&&<p className="ag-muted">這個流程不需要輸入，直接執行即可。</p>}
        {inputs.map(st=><div className="ag-field" key={st.id}><label>{st.title}</label>
          {st.type==='text_input'?<textarea rows={2} value={vals[st.id]||''} placeholder={st.config?.placeholder||''} readOnly={st.config?.allow_override===false} onChange={e=>setVals(v=>({...v,[st.id]:e.target.value}))}/>
            :<label className="ag-drop"><UploadSimple size={16}/>{files[st.id]?.busy?'上傳中…':files[st.id]?`${files[st.id].name}（${files[st.id].chars} 字，已去識別化）`:'選擇檔案'}
              <input type="file" hidden onChange={e=>e.target.files[0]&&upload(st,e.target.files[0])}/></label>}</div>)}
        <button className="ag-btn primary" disabled={busy||Object.values(files).some(f=>f?.busy)} onClick={start}>{busy?<CircleNotch className="spin" size={16}/>:<Play size={16} weight="fill"/>}{busy?'執行中…':'執行'}</button>
        {busy&&<p className="ag-muted">依步驟逐一執行，可能需要一到數分鐘。</p>}
      </div>}
      {run&&<><RunView run={run} onChange={setRun} notify={notify}/><button className="ag-btn" onClick={()=>setRun(null)}>重新執行</button></>}
    </>:<div className="ag-minichat">
      {!chat.length&&<p className="ag-muted">這個 Agent 沒有步驟流程，直接用對話測試它的角色指令與能力。</p>}
      {chat.map((m,i)=><div key={i} className={'mc-msg '+m.role}>{m.text}</div>)}
      {busy&&<div className="mc-msg assistant"><CircleNotch className="spin" size={14}/> 思考中…</div>}
    </div>}
    </div>
    {!agent.steps.length&&<footer><input value={msg} placeholder="輸入訊息測試…" onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.nativeEvent.isComposing&&send()}/><button className="ag-icon primary" aria-label="送出" disabled={busy||!msg.trim()} onClick={send}><PaperPlaneRight size={16} weight="fill"/></button></footer>}
  </div>;
}
