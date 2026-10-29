import React,{useState} from 'react';
import AgentList from './AgentList';
import AgentEditor from './AgentEditor';
import CreateChat from './CreateChat';
import './agents.css';

/* The Agent area: the catalogue, the editor (設定 / 步驟 / 執行紀錄 / 發布與版本) and creating by conversation. */
export default function AgentsApp({me,notify,onChat}){
  const [view,setView]=useState({kind:'list'}),[tick,setTick]=useState(0);
  const toList=id=>{setTick(t=>t+1);setView(typeof id==='string'?{kind:'edit',id}:{kind:'list'})};
  return <div className="ag-root">
    {view.kind==='list'&&<AgentList me={me} notify={notify} refreshKey={tick} onOpen={id=>setView({kind:'edit',id})} onCreateChat={()=>setView({kind:'chat'})} onChat={onChat}/>}
    {view.kind==='chat'&&<CreateChat notify={notify} onBack={()=>setView({kind:'list'})} onCreated={id=>setView({kind:'edit',id,tab:'設定'})}/>}
    {view.kind==='edit'&&<AgentEditor key={view.id} id={view.id} me={me} notify={notify} initialTab={view.tab} onBack={toList} onChat={onChat} onDeleted={()=>toList()} onChanged={()=>{}}/>}
  </div>;
}
