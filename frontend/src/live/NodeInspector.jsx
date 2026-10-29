import React,{useEffect,useState} from 'react';
import {Trash,Info} from '@phosphor-icons/react';
import {api} from '../api';
import {Field} from '../ListKit';
import {NODE_KINDS,MODEL_GROUP_IDS,GROUP_HINT} from './kit';

export default function NodeInspector({node,onChange,onDelete,knowledgeCount,effectiveGroup,defaultGroup}){
  const set=(k,v)=>onChange({...node,data:{...node.data,[k]:v}});
  const setMany=p=>onChange({...node,data:{...node.data,...p}});
  const s=(k,d='')=>String(node.data[k]??d);
  const meta=NODE_KINDS.find(k=>k.type===node.type);
  const t=node.type;
  const modelStep=t==='llm'||t==='structured_output'||t==='condition';
  const pinned=s('group')||undefined,runs=effectiveGroup(pinned);
  return <div className="lv-card lv-insp">
    <div className="lv-head" style={{marginBottom:0}}><b>節點設定</b><span className="badge">{t}</span><span className="grow"/>
      {t!=='input'&&<button type="button" className="text-button lv-danger" onClick={onDelete}><Trash size={14}/>移除</button>}</div>
    <p className="lv-hint lv-mono">{node.id}{meta?` · ${meta.hint}`:''}</p>
    <Field label="顯示名稱"><input value={s('label')} onChange={e=>set('label',e.target.value)}/></Field>
    {t==='knowledge'&&<>
      <Field label="檢索查詢（模板）"><input value={s('query','{{input}}')} onChange={e=>set('query',e.target.value)}/></Field>
      <p className="lv-hint">可用 {'{{input}}'}、{'{{last}}'}、{'{{節點id}}'}；未被提示詞引用時會自動附加到系統提示。</p>
      <Field label="取回段落數 top_k"><input type="number" min={1} max={20} value={Number(node.data.top_k??5)} onChange={e=>set('top_k',Number(e.target.value))}/></Field>
      <p className="lv-hint" style={{color:knowledgeCount?'#239660':'#8a5a00'}}>{knowledgeCount?`已掛載 ${knowledgeCount} 份知識文件`:'尚未掛載知識文件（請至「設定」分頁掛載）'}</p>
    </>}
    {(t==='llm'||t==='structured_output')&&<Field label="提示詞"><textarea rows={4} className="lv-mono" value={s('prompt','{{input}}')} onChange={e=>set('prompt',e.target.value)}/></Field>}
    {t==='structured_output'&&<Field label="JSON Schema"><textarea rows={6} className="lv-mono" value={s('schema','{}')} onChange={e=>set('schema',e.target.value)}/></Field>}
    {modelStep&&<>
      <Field label="此步驟指定模型群組"><select value={s('group')} onChange={e=>set('group',e.target.value||undefined)}>
        <option value="">（依預設群組 {defaultGroup} 與路由策略）</option>{MODEL_GROUP_IDS.map(g=><option key={g} value={g}>{g} · {GROUP_HINT[g]}</option>)}</select></Field>
      {pinned&&runs!==pinned&&<p className="lv-hint" style={{color:'#8a5a00'}}><Info size={13}/> 執行時改用 {runs}（{runs==='sovereign'?'已勾選「僅限院內模型」':'超過成本上限'}）。</p>}
    </>}
    {t==='condition'&&<Field label="判斷問題（LLM 回答 YES/NO，分走 true / false）"><textarea rows={3} value={s('question')} onChange={e=>set('question',e.target.value)}/></Field>}
    {t==='his_emr'&&<><Field label="查詢條件（模板）"><input value={s('query','{{input}}')} onChange={e=>set('query',e.target.value)}/></Field><p className="lv-hint">院內 FHIR 閘道尚未串接，目前回傳 stub 標記。</p></>}
    {t==='pii_mask'&&<p className="lv-hint">此節點已停用：平台會自動去識別化所有輸入與檢索內容，可直接刪除。</p>}
    {t==='tool'&&<ToolConfig node={node} set={set} setMany={setMany}/>}
    {t==='approval'&&<><Field label="核准訊息"><input value={s('message')} onChange={e=>set('message',e.target.value)}/></Field><p className="lv-hint">此節點已不提供新增；既有節點仍會在每次執行時暫停，等待負責人核准。</p></>}
    {t==='output'&&<Field label="回覆模板"><textarea rows={3} className="lv-mono" value={s('template','{{last}}')} onChange={e=>set('template',e.target.value)}/></Field>}
  </div>;
}

/** Tool node: pick a shared connector, then one of its actions. */
function ToolConfig({node,set,setMany}){
  const [connectors,setConnectors]=useState(null),[actions,setActions]=useState([]);
  const cid=String(node.data.connector_id??''),action=String(node.data.action??'');
  const args=node.data.args&&typeof node.data.args==='object'?node.data.args:{};
  useEffect(()=>{api.listConnectors().then(setConnectors).catch(()=>setConnectors([]))},[]);
  useEffect(()=>{if(cid)api.connectorActions(cid).then(setActions).catch(()=>setActions([]));else setActions([])},[cid]);
  const conn=(connectors||[]).find(c=>c.id===cid),spec=actions.find(a=>a.id===action);
  return <>
    <Field label="連接器"><select value={cid} onChange={e=>setMany({connector_id:e.target.value||undefined,action:undefined,args:{}})}>
      <option value="">{connectors===null?'載入中…':'（選擇連接器）'}</option>
      {(connectors||[]).map(c=><option key={c.id} value={c.id} disabled={c.status!=='active'}>{c.label}{c.status!=='active'?'（未通過連線測試）':''}</option>)}</select></Field>
    {conn&&<p className="lv-hint lv-mono">{conn.type} · {conn.status==='active'?'已連線':conn.status}</p>}
    {cid&&<Field label="動作 / 工具"><select value={action} onChange={e=>setMany({action:e.target.value||undefined,args:{}})}>
      <option value="">（選擇動作）</option>{actions.map(a=><option key={a.id} value={a.id}>{a.label}{a.write?'':'（唯讀）'}</option>)}</select></Field>}
    {cid&&!actions.length&&<p className="lv-hint">此連接器尚無可用動作（MCP 需先通過連線測試）。</p>}
    {spec&&spec.args.map(a=><Field key={a.key} label={`${a.label}${a.required?' *':''}`}>
      {a.kind==='textarea'?<textarea rows={3} className="lv-mono" value={args[a.key]??''} onChange={e=>set('args',{...args,[a.key]:e.target.value})}/>
        :<input className="lv-mono" value={args[a.key]??''} onChange={e=>set('args',{...args,[a.key]:e.target.value})}/>}</Field>)}
    {spec?.write&&<p className="lv-hint" style={{color:'#8a5a00'}}><Info size={13}/> 寫入動作會真實執行，請先在沙盒確認。</p>}
  </>;
}
