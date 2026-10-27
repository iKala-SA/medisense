import React,{useState} from 'react';
import {Plus,Trash,Play} from '@phosphor-icons/react';
import {AgentCreate} from './AgentCreate';
import {ShareModal,ShareButton,emptyShare,accountShare} from './ShareKit';
import {Toggle,ListToolbar,AddModal,Field,Empty} from './ListKit';

const Note=()=><p className="notice small muted">原型示範：資料為合成內容，只保存在本次瀏覽器工作階段，未連接真實服務，亦未驗證。</p>;
const Head=({title,sub,onAdd,addLabel})=><><div className="page-heading"><h1>{title}</h1><button className="btn primary" onClick={onAdd}><Plus/>{addLabel}</button></div><p className="subtitle">{sub}</p></>;
const today='2026/10/27';
const match=(text,q)=>text.toLowerCase().includes(q.trim().toLowerCase());

/* ---------- 技能 ---------- */
const seedSkills=[
  {id:'s1',name:'院內文件摘要',desc:'將授權文件整理為重點摘要，並標示引用來源。',share:accountShare(),enabled:true,updated:'2026/10/24'},
  {id:'s2',name:'用藥規範查詢',desc:'依院內用藥規範回答問題，資訊不足時明確說明。',share:{access:'restricted',role:'use',members:[{type:'group',id:'g1',name:'藥劑部',sub:'群組 · 12 人',role:'use'}]},enabled:true,updated:'2026/10/22'},
  {id:'s3',name:'交班格式整理',desc:'協助整理交班格式與待確認事項。',share:emptyShare(),enabled:false,updated:'2026/10/19'},
  {id:'s4',name:'會議紀錄產出',desc:'從議程與筆記產生會議紀錄與行動項目。',share:accountShare(),enabled:true,updated:'2026/10/15'}
];
export function SkillPage(){
  const [items,setItems]=useState(seedSkills),[q,setQ]=useState(''),[tab,setTab]=useState('全部'),[adding,setAdding]=useState(false),[sharing,setSharing]=useState(null);
  const rows=items.filter(s=>(tab==='全部'||(tab==='已啟用')===s.enabled)&&match(s.name+s.desc,q));
  const set=(id,patch)=>setItems(a=>a.map(s=>s.id===id?{...s,...patch}:s));
  if(adding)return <AgentCreate creator="Paggie" backLabel="技能" noun="技能" status="啟用" instrLabel="技能指示" selects={[]} onCancel={()=>setAdding(false)} onSave={v=>{setItems(a=>[{id:crypto.randomUUID(),name:v.name,desc:v.desc,share:v.share,enabled:true,updated:today},...a]);setAdding(false)}}/>;
  return <><Head title="技能" sub="可重複使用的工作能力，供 Agent 在授權範圍內呼叫。" onAdd={()=>setAdding(true)} addLabel="新增技能"/>
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋技能" tabs={['全部','已啟用','已停用']} tab={tab} onTab={setTab}/>
    <div className="lt" style={{'--cols':'minmax(150px,1fr) minmax(220px,2fr) 150px 110px 70px 44px'}}>
      <div className="lt-head"><span>名稱</span><span>說明</span><span>分享對象</span><span>最後更新</span><span>啟用</span><span/></div>
      {rows.map(s=><div className="lt-row" key={s.id}><b>{s.name}</b><span className="muted">{s.desc}</span><ShareButton share={s.share} label={'分享 '+s.name} onClick={()=>setSharing(s.id)}/><span className="muted small">{s.updated}</span><Toggle on={s.enabled} label={'啟用 '+s.name} onChange={v=>set(s.id,{enabled:v,updated:today})}/><button className="icon-btn" aria-label={'刪除 '+s.name} onClick={()=>window.confirm(`刪除技能「${s.name}」？`)&&setItems(a=>a.filter(x=>x.id!==s.id))}><Trash/></button></div>)}
      {!rows.length&&<Empty text="沒有符合的技能"/>}
    </div><Note/>
    {sharing&&<ShareModal title={items.find(x=>x.id===sharing)?.name} value={items.find(x=>x.id===sharing)?.share} onClose={()=>setSharing(null)} onDone={v=>{set(sharing,{share:v,updated:today});setSharing(null)}}/>}
  </>;
}

/* ---------- 排程 ---------- */
const agentNames=['Medisense','藥劑部用藥資訊助理','心臟科研究助理','交班摘要助理'];
const freqs=['每日','每個工作日','每週一','每月 1 日'];
const seedSchedules=[
  {id:'c1',name:'每日院內公告摘要',agent:'Medisense',freq:'每個工作日',time:'08:30',enabled:true,last:'2026/10/27 08:30'},
  {id:'c2',name:'每週用藥資訊更新彙整',agent:'藥劑部用藥資訊助理',freq:'每週一',time:'09:00',enabled:true,last:'2026/10/26 09:00'},
  {id:'c3',name:'月度研究文獻追蹤',agent:'心臟科研究助理',freq:'每月 1 日',time:'10:00',enabled:false,last:'2026/10/01 10:00'}
];
export function SchedulePage(){
  const [items,setItems]=useState(seedSchedules),[q,setQ]=useState(''),[tab,setTab]=useState('全部'),[adding,setAdding]=useState(false);
  const rows=items.filter(s=>(tab==='全部'||(tab==='執行中')===s.enabled)&&match(s.name+s.agent,q));
  const set=(id,patch)=>setItems(a=>a.map(s=>s.id===id?{...s,...patch}:s));
  return <><Head title="排程" sub="讓 Agent 依排程自動執行例行工作。" onAdd={()=>setAdding(true)} addLabel="新增排程"/>
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋排程或 Agent" tabs={['全部','執行中','已暫停']} tab={tab} onTab={setTab}/>
    <div className="lt" style={{'--cols':'minmax(160px,1.5fr) minmax(140px,1.2fr) 130px 140px 70px 76px'}}>
      <div className="lt-head"><span>名稱</span><span>Agent</span><span>頻率</span><span>最近執行</span><span>啟用</span><span/></div>
      {rows.map(s=><div className="lt-row" key={s.id}><b>{s.name}</b><span>{s.agent}</span><span>{s.freq} {s.time}</span><span className="muted small">{s.last}</span><Toggle on={s.enabled} label={'啟用 '+s.name} onChange={v=>set(s.id,{enabled:v})}/><span className="lt-actions"><button className="icon-btn" aria-label={'立即執行 '+s.name} title="立即執行（模擬）" onClick={()=>set(s.id,{last:today+' 剛剛（模擬）'})}><Play/></button><button className="icon-btn" aria-label={'刪除 '+s.name} onClick={()=>window.confirm(`刪除排程「${s.name}」？`)&&setItems(a=>a.filter(x=>x.id!==s.id))}><Trash/></button></span></div>)}
      {!rows.length&&<Empty text="沒有符合的排程"/>}
    </div><Note/>
    {adding&&<AddModal title="新增排程" hint="指定 Agent、頻率與要執行的任務。" onClose={()=>setAdding(false)} onSubmit={f=>{setItems(a=>[{id:crypto.randomUUID(),name:f.get('name').trim(),agent:f.get('agent'),freq:f.get('freq'),time:f.get('time'),enabled:true,last:'尚未執行'},...a]);setAdding(false)}}>
      <Field label="排程名稱"><input name="name" required autoFocus placeholder="例如：每週交班重點彙整"/></Field>
      <Field label="執行 Agent"><select name="agent">{agentNames.map(x=><option key={x}>{x}</option>)}</select></Field>
      <div className="inline"><Field label="頻率"><select name="freq">{freqs.map(x=><option key={x}>{x}</option>)}</select></Field><Field label="時間"><input name="time" type="time" required defaultValue="09:00"/></Field></div>
      <Field label="任務指示"><textarea name="prompt" rows={4} placeholder="描述 Agent 每次要完成的工作"/></Field>
    </AddModal>}</>;
}

/* ---------- 模型 ---------- */
const groupsByDeploy={'雲端':['Fast','Budget','Cloud'],'地端':['On-Premise']};
const seedModels=[
  {id:'m1',name:'Gemini Flash',provider:'Google',deploy:'雲端',group:'Fast',enabled:true},
  {id:'m2',name:'Gemini Pro',provider:'Google',deploy:'雲端',group:'Cloud',enabled:true},
  {id:'m3',name:'Claude Sonnet',provider:'Anthropic',deploy:'雲端',group:'Cloud',enabled:true},
  {id:'m4',name:'OpenAI GPT',provider:'OpenAI',deploy:'雲端',group:'Budget',enabled:false},
  {id:'m5',name:'院內模型',provider:'On-premise',deploy:'地端',group:'On-Premise',enabled:true}
];
function ModelForm(){
  const [deploy,setDeploy]=useState('雲端');
  return <><Field label="模型名稱"><input name="name" required autoFocus placeholder="例如：Claude Opus"/></Field>
    <Field label="提供者"><input name="provider" required placeholder="例如：Anthropic"/></Field>
    <div className="inline"><Field label="部署方式"><select name="deploy" value={deploy} onChange={e=>setDeploy(e.target.value)}>{Object.keys(groupsByDeploy).map(x=><option key={x}>{x}</option>)}</select></Field><Field label="模型群組"><select name="group" key={deploy}>{groupsByDeploy[deploy].map(x=><option key={x}>{x}</option>)}</select></Field></div>
    <p className="muted small">地端模型只能加入 On-Premise 群組；雲端模型不可加入，以維持敏感資料不外送。</p></>;
}
export function ModelPage(){
  const [items,setItems]=useState(seedModels),[q,setQ]=useState(''),[tab,setTab]=useState('全部'),[adding,setAdding]=useState(false);
  const rows=items.filter(s=>(tab==='全部'||s.deploy===tab)&&match(s.name+s.provider+s.group,q));
  const set=(id,patch)=>setItems(a=>a.map(s=>s.id===id?{...s,...patch}:s));
  return <><Head title="模型" sub="管理可供路由選用的模型。為示例家族，並非已驗證的版本端點。" onAdd={()=>setAdding(true)} addLabel="新增模型"/>
    <ListToolbar search={q} onSearch={setQ} placeholder="搜尋模型或提供者" tabs={['全部','雲端','地端']} tab={tab} onTab={setTab}/>
    <div className="lt" style={{'--cols':'minmax(140px,1.4fr) minmax(110px,1fr) 90px 120px 120px 70px 44px'}}>
      <div className="lt-head"><span>名稱</span><span>提供者</span><span>部署</span><span>模型群組</span><span>連線狀態</span><span>啟用</span><span/></div>
      {rows.map(s=><div className="lt-row" key={s.id}><b>{s.name}</b><span>{s.provider}</span><span><span className="badge">{s.deploy}</span></span><span>{s.group}</span><span className="muted small">未連線 · 模擬</span><Toggle on={s.enabled} label={'啟用 '+s.name} onChange={v=>set(s.id,{enabled:v})}/><button className="icon-btn" aria-label={'刪除 '+s.name} onClick={()=>window.confirm(`刪除模型「${s.name}」？`)&&setItems(a=>a.filter(x=>x.id!==s.id))}><Trash/></button></div>)}
      {!rows.length&&<Empty text="沒有符合的模型"/>}
    </div><Note/>
    {adding&&<AddModal title="新增模型" hint="登錄後即可在「路由」中指派群組。" onClose={()=>setAdding(false)} onSubmit={f=>{setItems(a=>[{id:crypto.randomUUID(),name:f.get('name').trim(),provider:f.get('provider').trim(),deploy:f.get('deploy'),group:f.get('group'),enabled:true},...a]);setAdding(false)}}><ModelForm/></AddModal>}</>;
}

/* ---------- 安全控管（維持卡片） ---------- */
const controls=[
  ['敏感資料本地路由','含敏感資料的請求一律由院內模型處理，優先於所有一般規則。'],
  ['角色權限（RBAC / ABAC）','依角色與科別限制可用的 Agent、資料與功能。'],
  ['去識別化與遮罩','索引與輸出前標示並遮罩個資欄位。'],
  ['稽核與留存','記錄操作、模型選擇與資料處置，留存由院方政策決定。']
];
export function SecurityPage(){
  return <><div className="page-heading"><h1>安全控管</h1></div><p className="subtitle">資料保護與存取控制政策總覽。</p>
    <div className="space-grid">{controls.map(([n,d])=><section className="panel space-card" key={n}><div className="section-heading"><h3>{n}</h3></div><p>{d}</p><span className="badge">規劃設定 · 尚未驗證</span></section>)}</div><Note/></>;
}
