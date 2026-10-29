import React,{useEffect,useState} from 'react';
import {Plus,X,Lock,Globe,Plugs,BookOpen,FileText} from '@phosphor-icons/react';
import {api} from '../api';

const Seg=({value,onChange,options,disabled})=><div className="ag-seg" role="radiogroup">{options.map(([v,l])=><button key={v} type="button" role="radio" aria-checked={value===v} disabled={disabled} className={value===v?'on':''} onClick={()=>onChange(v)}>{l}</button>)}</div>;
const Switch=({on,onChange,disabled,label})=><button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={'ag-switch'+(on?' on':'')} onClick={()=>onChange(!on)}><span/></button>;
const Sect=({title,hint,children})=><section className="ag-sect"><h3>{title}</h3>{hint&&<p className="ag-muted">{hint}</p>}{children}</section>;

function Picker({label,items,chosen,onChange,empty,icon:I,disabled}){
  const [open,setOpen]=useState(false),[q,setQ]=useState('');
  const left=items.filter(x=>!chosen.includes(x.id)&&x.name.toLowerCase().includes(q.toLowerCase()));
  return <div className="ag-pick">
    <div className="ag-chips">{chosen.map(id=>{const it=items.find(x=>x.id===id);return <span className="ag-chip big" key={id}>{I&&<I size={13}/>}{it?.name||'（已不存在）'}{!disabled&&<button aria-label={'移除 '+(it?.name||id)} onClick={()=>onChange(chosen.filter(x=>x!==id))}><X size={11}/></button>}</span>})}
      {!chosen.length&&<span className="ag-muted">{empty}</span>}
      {!disabled&&<button type="button" className="ag-add" onClick={()=>setOpen(o=>!o)}><Plus size={13}/>{label}</button>}</div>
    {open&&<div className="ag-pop"><input autoFocus placeholder="搜尋" value={q} onChange={e=>setQ(e.target.value)}/>
      <div>{left.slice(0,40).map(x=><button key={x.id} type="button" onClick={()=>{onChange([...chosen,x.id]);setQ('')}}>{I&&<I size={15}/>}<span>{x.name}</span></button>)}{!left.length&&<p className="ag-muted">沒有可加入的項目</p>}</div></div>}
  </div>;
}

export default function SettingsPanel({a,set,canEdit,features,connectors,spaces,docs,groups}){
  const cap=a.capabilities,setCap=p=>set({capabilities:{...cap,...p}}),dis=!canEdit;
  const [acts,setActs]=useState({});
  useEffect(()=>{for(const c of cap.connectors)if(c.connector_id&&!acts[c.connector_id])api.connectorActions(c.connector_id).then(l=>setActs(x=>({...x,[c.connector_id]:l||[]}))).catch(()=>setActs(x=>({...x,[c.connector_id]:[]})))},[cap.connectors.map(c=>c.connector_id).join()]);// eslint-disable-line
  const setConn=(i,p)=>setCap({connectors:cap.connectors.map((c,j)=>j===i?{...c,...p}:c)});
  const opens=a.opening_questions||[];
  return <div className="ag-settings">
    <Sect title="指令" hint="Agent 的角色與工作方式。每次對話與每個 AI 步驟都會帶著這段指令。">
      <div className="ag-row"><div className="ag-field narrow"><label>圖示</label><input className="ag-emoji" maxLength={4} value={a.icon||''} placeholder="🩺" disabled={dis} onChange={e=>set({icon:e.target.value})}/></div>
        <div className="ag-field grow"><label>部門</label><select value={a.department||''} disabled={dis} onChange={e=>set({department:e.target.value})}><option value="">（不指定）</option>{DEPTS.map(d=><option key={d}>{d}</option>)}</select></div></div>
      <div className="ag-field"><label>角色指令 <small>{(a.instructions||'').length}/8000</small></label>
        <textarea rows={9} maxLength={8000} disabled={dis} value={a.instructions||''} placeholder="目標、語氣、工作方式、禁止事項" onChange={e=>set({instructions:e.target.value})}/></div>
      <div className="ag-field"><label>開場訊息／範例問題 <small>最多 4 則，顯示在對話起始畫面</small></label>
        <div className="ag-list">{opens.map((q,i)=><div key={i} className="ag-li"><input value={q} maxLength={120} disabled={dis} onChange={e=>set({opening_questions:opens.map((x,j)=>j===i?e.target.value:x)})}/>{!dis&&<button className="ag-icon" aria-label="刪除" onClick={()=>set({opening_questions:opens.filter((_,j)=>j!==i)})}><X size={14}/></button>}</div>)}
          {!dis&&opens.length<4&&<button type="button" className="ag-add" onClick={()=>set({opening_questions:[...opens,'']})}><Plus size={13}/>新增範例問題</button>}</div></div>
    </Sect>
    <Sect title="能力" hint="只開啟需要的能力。沒有勾選的，Agent 就不會使用。">
      <div className="ag-cap"><Globe size={18}/><div><b>網路搜尋</b><small>{features?.web_search===false?'管理員尚未開放網路搜尋':'需要即時或院外公開資訊時使用'}</small></div>
        <Switch on={cap.web_search&&features?.web_search!==false} disabled={dis||features?.web_search===false} label="網路搜尋" onChange={v=>setCap({web_search:v})}/></div>
      <div className="ag-cap col"><div className="ag-cap-h"><BookOpen size={18}/><div><b>知識空間</b><small>未選擇就不讀取內部知識；執行時仍依使用者本人的權限</small></div></div>
        <Picker label="加入空間" icon={BookOpen} items={spaces} chosen={cap.spaces} empty="沒有選擇空間" disabled={dis} onChange={v=>setCap({spaces:v})}/></div>
      <div className="ag-cap col"><div className="ag-cap-h"><FileText size={18}/><div><b>參考文件</b><small>直接附加在這個 Agent 上的文件</small></div></div>
        <Picker label="加入文件" icon={FileText} items={docs} chosen={a.knowledge_doc_ids||[]} empty="沒有附加文件" disabled={dis} onChange={v=>set({knowledge_doc_ids:v})}/></div>
      <div className="ag-cap col"><div className="ag-cap-h"><Plugs size={18}/><div><b>連接器</b><small>選擇可用的連接器與動作；寫入類動作預設要使用者核准</small></div></div>
        <div className="ag-list">{cap.connectors.map((c,i)=><div key={i} className="ag-conn">
          <select value={c.connector_id} disabled={dis} onChange={e=>setConn(i,{connector_id:e.target.value,action:''})}><option value="">選擇連接器</option>{connectors.map(x=><option key={x.id} value={x.id}>{x.name||x.label||x.type}</option>)}</select>
          <select value={c.action} disabled={dis||!c.connector_id} onChange={e=>setConn(i,{action:e.target.value})}><option value="">選擇動作</option>{(acts[c.connector_id]||[]).map(x=><option key={x.id} value={x.id}>{x.label||x.id}</option>)}</select>
          <label className="ag-inline"><Switch on={c.require_approval} disabled={dis} label="需要核准" onChange={v=>setConn(i,{require_approval:v})}/>需核准</label>
          {!dis&&<button className="ag-icon" aria-label="移除" onClick={()=>setCap({connectors:cap.connectors.filter((_,j)=>j!==i)})}><X size={14}/></button>}</div>)}
          {!cap.connectors.length&&<span className="ag-muted">沒有連接器</span>}
          {!dis&&<button type="button" className="ag-add" onClick={()=>setCap({connectors:[...cap.connectors,{connector_id:'',action:'',require_approval:true}]})}><Plus size={13}/>新增連接器動作</button>}</div></div>
      <div className="ag-field"><label>模型偏好</label><Seg value={cap.model_pref} disabled={dis} onChange={v=>setCap({model_pref:v})} options={[['fast','快速'],['balanced','平衡'],['quality','高品質']]}/></div>
      <div className="ag-field"><label>思考深度</label><Seg value={cap.thinking} disabled={dis} onChange={v=>setCap({thinking:v})} options={[['off','關'],['low','低'],['medium','中'],['high','高']]}/></div>
      <div className="ag-cap"><Lock size={18}/><div><b>僅院內模型</b><small>開啟後只使用院內模型，不回退雲端；圖片與網路搜尋無法使用</small></div>
        <Switch on={!!a.routing?.sovereign_only} disabled={dis} label="僅院內模型" onChange={v=>set({routing:{...a.routing,sovereign_only:v}})}/></div>
    </Sect>
  </div>;
}
const DEPTS=['內科部','外科部','急診醫學部','心臟血管中心','神經醫學中心','新陳代謝科','放射線部','護理部','藥劑部','感染管制中心','臨床試驗與轉譯研究中心','智慧醫療組 (IT)'];
