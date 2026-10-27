import React,{useState} from 'react';
import {Cpu,ArrowsSplit,ArrowRight,Info,Warning} from '@phosphor-icons/react';
import {api} from '../api';
import {Empty} from '../ListKit';
import {errText,useOnce,Loading,Banner} from './pkit';
import './pages.css';

const GROUPS=[['fast','fast · 快速','一般問答與多數流程步驟的預設選擇。'],['reasoning','reasoning · 深度推理','需要較深推理時使用；成本最高。'],['budget','budget · 低成本','成本最低的雲端群組。'],['sovereign','sovereign · 院內模型','僅在院內部署執行，不回退雲端。']];
const chainText=f=>f.models?.length&&f.models.join()!==f.name?`${f.name}（${f.models.join('、')}）`:f.name;

/* Shared loader: live LiteLLM routing table from /api/models. */
function useGroups(notify){
  const [groups,setGroups]=useState(null),[failed,setFailed]=useState(false);
  useOnce(async()=>{
    try{const r=await api.modelGroups();setGroups(r.groups||[])}
    catch(e){setGroups([]);setFailed(true);notify('無法載入模型路由表：'+errText(e))}
  });
  const byId=Object.fromEntries((groups||[]).map(g=>[g.id,g]));
  return {groups,failed,get:id=>byId[id]};
}
const Chain=({g})=>!g?.configured?null:g.fallbacks?.length?<div className="lv-p-chain"><span className="lv-p-meta">備援順序</span>{g.fallbacks.map((f,i)=><React.Fragment key={i}><ArrowRight size={12}/><span className="badge">{chainText(f)}</span></React.Fragment>)}</div>:<span className="lv-p-meta">無備援</span>;
const Unconfigured=({id})=><Banner icon={<Warning size={14}/>}>{id==='sovereign'?'尚未設定院內模型：使用此群組的執行會失敗（刻意不回退雲端）。':'LiteLLM 尚未設定此群組：使用此群組的執行會失敗。'}</Banner>;

export function ModelsPage({me,notify}){
  const {groups,failed,get}=useGroups(notify);
  if(groups===null)return <div className="lv-p"><Loading/></div>;
  return <div className="lv-p">
    <div className="page-heading"><h1><Cpu/>模型</h1></div>
    <p className="subtitle">平台以「模型群組」對外提供模型；各群組實際使用的模型與備援順序來自後端 LiteLLM 的即時路由表（唯讀）。</p>
    {failed&&<Banner icon={<Warning size={16}/>}>無法取得路由表，以下僅列出群組名稱。</Banner>}
    <div className="lv-p-cards" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}>{GROUPS.map(([id,label,desc])=>{const g=get(id);return <section key={id} className="lv-p-card">
      <div className="lv-p-card-head"><span className="connector-icon"><Cpu size={22}/></span><div><h3>{label}</h3><span className="lv-p-meta">{desc}</span></div></div>
      {failed?null:!g?.configured?<Unconfigured id={id}/>:<div className="lv-p-group"><span className="lv-p-meta">目前成員</span><div className="lv-p-chips" style={{marginTop:0}}>{g.models.length?g.models.map(m=><span className="badge" key={m}>{m}</span>):<span className="muted small">（無成員）</span>}</div><Chain g={g}/></div>}
      <div className="lv-p-card-foot"><span className={'lv-p-status '+(failed?'':g?.configured?'ok':'warn')}><i/>{failed?'未取得':g?.configured?'已設定':'尚未設定'}</span><span className="lv-p-meta">資料來源：/api/models</span></div>
    </section>})}</div>
    {!groups.length&&!failed&&<div className="lt" style={{marginTop:16}}><Empty text="後端未回傳任何模型群組"/></div>}
    <div className="notice"><Info/>此頁為唯讀。「已設定」僅表示 LiteLLM 路由表中存在該群組，並不代表模型端點已通過健康檢查。</div>
  </div>;
}

export function RouterPage({me,notify}){
  const {groups,failed,get}=useGroups(notify);
  if(groups===null)return <div className="lv-p"><Loading/></div>;
  return <div className="lv-p">
    <div className="page-heading"><h1><ArrowsSplit/>路由</h1></div>
    <p className="subtitle">Agent 流程中的每個模型步驟如何選到模型群組，以及各群組失敗時的備援順序（唯讀）。</p>
    <section className="panel" style={{padding:20,marginBottom:18}}>
      <h2 style={{fontSize:15,margin:'0 0 10px'}}>群組挑選順序</h2>
      <ol className="lv-p-ol">
        <li>Agent 勾選「僅用院內模型」（sovereign_only）：所有步驟固定使用 <b>sovereign</b>，任何規則皆不可覆寫。</li>
        <li>否則採用該節點自行指定的群組。</li>
        <li>節點未指定時：若<b>使用者訊息</b>（非已套版、可能含檢索文字的提示詞）含有 Agent 設定的推理關鍵字，使用 <b>reasoning</b>。</li>
        <li>其餘使用 Agent 的預設群組（model_group）。</li>
        <li>最後套用成本上限（max_cost_tier）：成本排序為 budget &lt; fast &lt; reasoning，超過上限者降至上限；sovereign 不屬於成本層級，不受影響。</li>
      </ol>
      <p className="lv-p-hint" style={{marginTop:10}}>依據後端 engine/flow.py 的 pick_group 說明；每步實際選用的群組會記錄於執行軌跡。</p>
    </section>
    <div className="lt" style={{'--cols':'160px minmax(180px,1.4fr) minmax(220px,2fr) 100px'}}>
      <div className="lt-head"><span>群組</span><span>目前成員</span><span>備援順序</span><span>狀態</span></div>
      {GROUPS.map(([id])=>{const g=get(id);return <div className="lt-row" key={id}>
        <b>{id}</b>
        <span>{failed?'—':g?.configured?(g.models.join(' / ')||'（無成員）'):'—'}</span>
        <span>{failed||!g?.configured?'—':g.fallbacks?.length?g.fallbacks.map(chainText).join(' → '):'無備援'}</span>
        <span><span className={'lv-p-status '+(failed?'':g?.configured?'ok':'warn')}><i/>{failed?'未取得':g?.configured?'已設定':'未設定'}</span></span></div>})}
    </div>
    <div className="notice"><Info/>sovereign 若尚未設定院內模型，執行會直接失敗，刻意不回退至雲端群組。路由規則由後端執行，此頁不提供修改。</div>
  </div>;
}

export default ModelsPage;
