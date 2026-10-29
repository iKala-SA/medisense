import React,{useState} from 'react';
import AgentList from './AgentList';
import AgentEditor from './AgentEditor';
import AgentDetail from './AgentDetail';
import AgentLanding from './AgentLanding';
import CreateChat from './CreateChat';
import './agents.css';

/* Two areas share this code. kind="agent": chat agents (catalogue, creation landing, detail with live preview).
   kind="flow": 流程, fixed step sequences (catalogue, step editor, run mode). */
export default function AgentsApp({me,notify,onChat,kind='agent'}){
  const [view,setView]=useState({kind:'list'}),[tick,setTick]=useState(0);
  const toList=id=>{setTick(t=>t+1);setView(typeof id==='string'?{kind:'edit',id}:{kind:'list'})};
  return <div className="ag-root">
    {view.kind==='list'&&<AgentList kind={kind} me={me} notify={notify} refreshKey={tick} onOpen={id=>setView({kind:'edit',id})} onCreateChat={()=>setView({kind:'chat'})} onChat={onChat}/>}
    {view.kind==='chat'&&(kind==='agent'
      ?<AgentLanding notify={notify} onBack={()=>setView({kind:'list'})} onCreated={id=>setView({kind:'edit',id})}/>
      :<CreateChat notify={notify} onBack={()=>setView({kind:'list'})} onCreated={id=>setView({kind:'edit',id,tab:'步驟'})}/>)}
    {view.kind==='edit'&&(kind==='agent'
      ?<AgentDetail key={view.id} id={view.id} me={me} notify={notify} onBack={toList} onChat={onChat} onDeleted={()=>toList()}/>
      :<AgentEditor key={view.id} id={view.id} me={me} notify={notify} initialTab={view.tab||'步驟'} onBack={toList} onChat={onChat} onDeleted={()=>toList()} onChanged={()=>{}}/>)}
  </div>;
}
