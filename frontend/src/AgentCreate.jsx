import React,{useState} from 'react';
import {ArrowLeft,ArrowUp,Sparkle} from '@phosphor-icons/react';
import {Jelly} from './Jelly';
import {ShareModal,ShareAction,ShareButton,emptyShare} from './ShareKit';

const Count=({n,max})=><small className="ac-count">{n} / {max}</small>;

export function AgentCreate({creator,onCancel,onSave,backLabel='Agent',noun='Agent',selects,status='草稿',instrLabel='指示',initial,shareDialog:ShareDlg=ShareModal}){
  const [name,setName]=useState(initial?.name||''),[desc,setDesc]=useState(initial?.desc||''),[instr,setInstr]=useState(initial?.instr||''),[picked,setPicked]=useState(()=>Object.fromEntries(selects.map(x=>[x.key,x.default]))),[ask,setAsk]=useState(''),[share,setShare]=useState(()=>initial?.share||emptyShare()),[sharing,setSharing]=useState(false),[chat,setChat]=useState([]);
  const valid=name.trim()&&desc.trim();
  function draft(){
    const t=ask.trim();if(!t)return;
    setName(t.slice(0,20));setDesc(t.slice(0,1024));
    setInstr(`你是院內 AI 助理，負責：${t}\n\n請以授權知識回答並標示引用來源；資訊不足時明確說明，不得推測病人資料。`);
    setChat(c=>[...c,{me:true,text:t},{text:'已依描述產生草稿（模擬，未呼叫真實模型）。請在右側檢視並調整後儲存。'}]);setAsk('');
  }
  return <div className="ac-page">
    <section className="ac-left">
      <button className="ac-back" onClick={onCancel}><ArrowLeft size={18}/>{backLabel}</button>
      <div className="ac-chat">{chat.length===0?<p className="muted ac-hint"><Jelly size={26}/> 用一段話描述你想建立的{noun}，我會幫你起草右側內容。</p>:chat.map((m,i)=>m.me?<div key={i} className="ac-msg me">{m.text}</div>:<div key={i} className="ac-reply"><Jelly size={30}/><div className="ac-msg">{m.text}</div></div>)}</div>
      <div className="ac-composer"><textarea aria-label={`描述你的 ${noun}`} placeholder={`描述你的 ${noun}`} rows={3} value={ask} onChange={e=>setAsk(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();draft()}}}/><button className="send" aria-label="產生草稿" disabled={!ask.trim()} onClick={draft}><ArrowUp size={18}/></button></div>
    </section>
    <form className="ac-card" onSubmit={e=>{e.preventDefault();if(valid)onSave({name:name.trim(),desc:desc.trim(),instr,share,...picked})}}>
      <div className="ac-top"><div className="ac-name"><input aria-label="名稱" required maxLength={64} placeholder="名稱*" value={name} onChange={e=>setName(e.target.value)}/><Count n={name.length} max={64}/></div><ShareAction onClick={()=>setSharing(true)}/><button type="button" className="text-button" onClick={onCancel}>取消</button><button className="btn primary ac-save" disabled={!valid}>儲存</button></div>
      <div className="ac-desc"><textarea aria-label="說明" required maxLength={1024} rows={2} placeholder="說明*" value={desc} onChange={e=>setDesc(e.target.value)}/><Count n={desc.length} max={1024}/></div>
      <div className="ac-meta"><div><small>建立者</small><b>{creator}</b></div>{selects.map(x=><div key={x.key}><small>{x.label}</small><select aria-label={x.label} value={picked[x.key]} onChange={e=>setPicked(p=>({...p,[x.key]:e.target.value}))}>{x.options.map(o=><option key={o}>{o}</option>)}</select></div>)}<div><small>分享對象</small><ShareButton share={share} onClick={()=>setSharing(true)}/></div><div><small>狀態</small><b>{status}</b></div></div>
      <label className="ac-label" htmlFor="ac-instr">{instrLabel}</label>
      <textarea id="ac-instr" className="ac-instr" maxLength={50000} placeholder={`描述你希望這個${noun}做什麼`} value={instr} onChange={e=>setInstr(e.target.value)}/>
      <Count n={instr.length} max={50000}/>
    </form>
    {sharing&&<ShareDlg title={name} value={share} owner={creator} onClose={()=>setSharing(false)} onDone={v=>{setShare(v);setSharing(false)}}/>}
  </div>;
}
