import React,{useState} from 'react';
import {Play,UploadSimple,CircleNotch,ListChecks} from '@phosphor-icons/react';
import {api} from '../api';
import RunView from './RunView';
import './agents.css';

/* In chat, an agent that has a step flow starts with its input form (PRD §3.2). When the run finishes, its result joins the
   conversation so the user can keep asking about it in chat mode. */
export default function ChatRunForm({profile,sessionId,notify,onDone}){
  const [vals,setVals]=useState(()=>Object.fromEntries(profile.inputs.filter(i=>i.type==='text_input').map(i=>[i.id,i.default||''])));
  const [files,setFiles]=useState({}),[run,setRun]=useState(null),[busy,setBusy]=useState(false);
  const upload=async(i,f)=>{setFiles(x=>({...x,[i.id]:{name:f.name,busy:true}}));
    try{const r=await api.uploadRunFile(profile.id,f);setVals(v=>({...v,[i.id]:r.id}));setFiles(x=>({...x,[i.id]:{name:r.name,chars:r.chars}}))}catch(e){setFiles(x=>({...x,[i.id]:null}));notify(e.message)}};
  const finish=async r=>{try{onDone(await api.runToChat(r.id,sessionId||undefined),r)}catch(e){notify(e.message)}};
  const update=r=>{setRun(r);if(r.status==='succeeded')finish(r)};
  const start=async()=>{
    const missing=profile.inputs.find(i=>i.required&&!String(vals[i.id]||'').trim());if(missing){notify(`請填寫「${missing.title}」`);return}
    setBusy(true);try{update(await api.startStepRun(profile.id,vals,true))}catch(e){notify(e.message)}finally{setBusy(false)}
  };
  return <div className="crf">
    <div className="crf-h"><ListChecks size={18}/><b>{profile.name} 的流程</b><small>填好資料後依步驟執行，結果會放進這個對話，之後可以繼續追問。</small></div>
    {!run&&<>
      {profile.inputs.map(i=><div className="ag-field" key={i.id}><label>{i.title}{i.required&&<small>必填</small>}</label>
        {i.type==='text_input'?<textarea rows={2} value={vals[i.id]||''} placeholder={i.placeholder} readOnly={i.allow_override===false} onChange={e=>setVals(v=>({...v,[i.id]:e.target.value}))}/>
          :<label className="ag-drop"><UploadSimple size={16}/>{files[i.id]?.busy?'上傳中…':files[i.id]?`${files[i.id].name}（${files[i.id].chars} 字，已去識別化）`:'選擇檔案'}<input type="file" hidden onChange={e=>e.target.files[0]&&upload(i,e.target.files[0])}/></label>}</div>)}
      <button className="ag-btn primary" disabled={busy||Object.values(files).some(f=>f?.busy)} onClick={start}>{busy?<CircleNotch className="spin" size={15}/>:<Play size={15} weight="fill"/>}{busy?'執行中…':'執行流程'}</button>
      {busy&&<p className="ag-muted">依步驟逐一執行，可能需要一到數分鐘。</p>}</>}
    {run&&<RunView run={run} onChange={update} notify={notify}/>}
  </div>;
}
