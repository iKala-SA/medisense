import React,{useState} from 'react';
import {Sparkle,CircleNotch,ArrowLeft,GraduationCap,Handshake,UserPlus} from '@phosphor-icons/react';
import {api} from '../api';
import {errText} from '../live/kit';
import {blankAgent} from './stepkit';

const PLACEHOLDER='我想要為[相關人員][執行相應動作]的聊天代理程式。它應該使用有關[主題]的知識並能夠執行[特定功能]。語氣應該為[風格]。';
const TEMPLATES=[
  ['培訓指引',GraduationCap,'建立聊天代理程式，協助新進同仁了解單位的作業流程與工具。它應該能回答常見問題、引導同仁找到相關資源和文件，並用友善、有耐心的語氣一步一步說明。'],
  ['衛教說明助理',Handshake,'建立聊天代理程式，協助護理人員向病人說明常見檢查與用藥注意事項。它應使用淺顯的繁體中文、避免艱深術語，說明後確認對方是否理解，並提醒需要回診或聯絡醫師的情況。'],
  ['加入助手',UserPlus,'建立代理程式，引導新同仁完成帳號設定與系統存取申請。它應該說明常見的系統存取需求、工具設定，並一次只問一個問題，直到所有步驟完成。'],
];

/* Landing page of 建立 Agent: describe the goal (or start from a template); 產生 drafts the agent, 略過 starts from a blank one. */
export default function AgentLanding({notify,onBack,onCreated}){
  const [text,setText]=useState(''),[busy,setBusy]=useState(''),[tpl,setTpl]=useState(null);
  const go=async kind=>{
    setBusy(kind);
    try{
      let body=blankAgent('agent');
      if(kind==='generate'){const r=await api.draftAgent(text.trim(),null,[],'agent');body={...body,...r.agent,kind:'agent',steps:[],original_prompt:text.trim().slice(0,4000)}}
      const a=await api.createAgent(body);onCreated(a.id);
    }catch(e){notify(errText(e));setBusy('')}
  };
  return <div className="al">
    <button className="ag-back" onClick={onBack}><ArrowLeft size={14}/>所有 Agent</button>
    <div className="al-body">
      <svg className="al-star" width="56" height="56" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="alg" x1="3" y1="21" x2="21" y2="3"><stop offset="0" stopColor="#239660"/><stop offset="1" stopColor="#1aa7a1"/></linearGradient></defs><path fill="url(#alg)" d="M12 1c.6 5.6 5.4 10.4 11 11-5.6.6-10.4 5.4-11 11-.6-5.6-5.4-10.4-11-11C6.6 11.4 11.4 6.6 12 1z"/></svg>
      <h1>建置具有獨特人物角色和功能的 Agent</h1>
      <p className="al-sub">請告知您的目標或從 <a href="#範本" onClick={e=>{e.preventDefault();document.getElementById('al-tpl')?.scrollIntoView({behavior:'smooth'})}}>範本</a> 開始</p>
      <div className="al-box"><textarea value={text} maxLength={50000} placeholder={PLACEHOLDER} aria-label="描述你想建立的 Agent" onChange={e=>{setText(e.target.value);setTpl(null)}}/>
        <button type="button" className="al-clear" onClick={()=>setText('')} disabled={!text}>清除</button></div>
      <div className="al-foot"><small>字元數 {text.length}/50000</small>
        <span><button type="button" className="al-skip" disabled={!!busy} onClick={()=>go('blank')}>{busy==='blank'?<CircleNotch className="spin" size={14}/>:null}略過</button>
          <button type="button" className="ag-btn primary big" disabled={!text.trim()||!!busy} onClick={()=>go('generate')}>{busy==='generate'?<><CircleNotch className="spin" size={15}/>正在產生…</>:'產生'}</button></span></div>
      <p className="al-hint" id="al-tpl">正在尋找靈感？請參閱下面的一些範例 Agent 建立指示。</p>
      <div className="al-tpls">{TEMPLATES.map(([t,I,d])=><button key={t} type="button" className={tpl===t?'on':''} onClick={()=>{setText(d);setTpl(t)}}><b><span className="ic"><I size={16}/></span>{t}</b><span>{d}</span></button>)}</div>
      <p className="ag-muted center small">請勿輸入病人姓名或證號；內容會先去識別化再送給模型。</p>
    </div>
  </div>;
}
