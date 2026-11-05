import React,{useState} from 'react';
import {SlidersHorizontal,Lock,Globe} from '@phosphor-icons/react';
import {api} from '../api';
import {Field} from '../ListKit';
import {errText,useOnce} from './pkit';
import './ops.css';

/* 設定 (admin): hospital-wide switches that take effect at once (config/features via GET / PUT /api/features):
   網路搜尋, 語音輸入, 文件檢索相關度門檻. Moved out of the 路由 page (2026-11-05); the backend is unchanged. */
export default function SettingsPage({me,notify}){
  const admin=me?.role==='admin';
  const [feat,setFeat]=useState(null),[featErr,setFeatErr]=useState(''),[featBusy,setFeatBusy]=useState(false),[rag,setRag]=useState(null);
  // null = loading, false = could not be read (see featErr). Loaded on its own so a slow model-group lookup cannot hold it up.
  const loadFeat=()=>{setFeat(null);setFeatErr('');api.features().then(f=>{setFeat(f);setRag({keep:String(f.rag_keep_distance),max:String(f.rag_max_distance)})}).catch(e=>{setFeat(false);setFeatErr(errText(e))})};
  useOnce(()=>{if(admin)loadFeat()});
  if(!admin)return <div className="lv-o"><div className="page-heading"><h1><SlidersHorizontal/>設定</h1></div><div className="panel access"><Lock size={36}/><h2>僅限管理員</h2><p>全院設定僅管理員可檢視與修改。</p></div></div>;
  const featBody=f=>({web_search:!!f?.web_search,voice_input:!!f?.voice_input,rag_keep_distance:f?.rag_keep_distance??0.42,rag_max_distance:f?.rag_max_distance??0.50});
  const ragNum=v=>Number.isFinite(parseFloat(v))?parseFloat(v):NaN;
  const ragValid=!!rag&&ragNum(rag.keep)>=0.05&&ragNum(rag.max)<=1&&ragNum(rag.keep)<=ragNum(rag.max);
  const ragDirty=!!rag&&!!feat&&(ragNum(rag.keep)!==feat.rag_keep_distance||ragNum(rag.max)!==feat.rag_max_distance);
  async function saveRag(){
    setFeatBusy(true);
    try{const f=await api.saveFeatures({...featBody(feat),rag_keep_distance:ragNum(rag.keep),rag_max_distance:ragNum(rag.max)});setFeat(f);setRag({keep:String(f.rag_keep_distance),max:String(f.rag_max_distance)});notify('已儲存文件檢索門檻')}
    catch(e){notify('儲存失敗：'+errText(e))}finally{setFeatBusy(false)}
  }
  async function setVoice(on){
    if(on&&!window.confirm('開放後，輸入框會出現麥克風。語音辨識由瀏覽器提供：Chrome 與 Edge 會把「錄到的聲音」送到 Google 的語音服務，Safari 送到 Apple，聲音不會先去識別化。如果口述內容可能含病人資料，請先取得資安同意。確定開放？'))return;
    setFeatBusy(true);
    try{setFeat(await api.saveFeatures({...featBody(feat),voice_input:on}));notify(on?'已開放語音輸入':'已關閉語音輸入')}
    catch(e){notify('儲存失敗：'+errText(e))}finally{setFeatBusy(false)}
  }
  async function setWeb(on){
    if(on&&!window.confirm('開放後，使用者可在對話中自行開啟「Web 搜尋」。開啟時，經去識別化的搜尋詞會送到 Google。確定開放？'))return;
    setFeatBusy(true);
    try{setFeat(await api.saveFeatures({...featBody(feat),web_search:on}));notify(on?'已開放網路搜尋（使用者仍需自行開啟）':'已關閉網路搜尋')}
    catch(e){notify('儲存失敗：'+errText(e))}finally{setFeatBusy(false)}
  }
  return <div className="lv-o">
    <div className="page-heading"><h1><SlidersHorizontal/>設定</h1></div>
    <p className="muted small" style={{margin:'0 0 14px'}}>全院設定立即生效，不需發布；每次變更都會寫入稽核記錄。</p>
    <label className={'panel lv-o-sovereign'+(feat?.web_search?' on':'')}><input type="checkbox" disabled={feat===null||feat===false||featBusy} checked={!!feat?.web_search} onChange={e=>setWeb(e.target.checked)}/><div><b><Globe size={14} style={{verticalAlign:-2,marginRight:4}}/>允許網路搜尋（對外連線）</b><span className="muted small">預設關閉。勾選後，使用者可在輸入框「＋」選單自行開啟 Web 搜尋；開啟時模型可能把<b>已去識別化的搜尋詞</b>送到 Google 查詢，結果附網頁來源。「僅本地模型」開啟時，網路搜尋一律停用。變更立即生效並寫入稽核記錄。{feat?.updated_by&&<> 上次由 {feat.updated_by} 變更。</>}</span>
      {feat===null&&<span className="small muted">讀取目前設定中…</span>}
      {feat===false&&<span className="small" role="alert" style={{color:'#b3261e'}}>無法讀取此設定，暫時無法變更：{featErr||'未知錯誤'}　<button type="button" className="lv-linkbtn" onClick={e=>{e.preventDefault();loadFeat()}}>重試</button></span>}</div></label>
    <label className={'panel lv-o-sovereign'+(feat?.voice_input?' on':'')} style={{marginTop:10}}><input type="checkbox" disabled={feat===null||feat===false||featBusy} checked={!!feat?.voice_input} onChange={e=>setVoice(e.target.checked)}/><div><b>允許語音輸入（麥克風）</b><span className="muted small">預設關閉。開放後輸入框會出現麥克風，使用者可口述問題。語音辨識由瀏覽器提供，<b>錄到的聲音會送到瀏覽器廠商的語音服務</b>（Chrome／Edge 是 Google，Safari 是 Apple），且不會先去識別化；Firefox 不支援。變更立即生效並寫入稽核記錄。</span></div></label>
    <section className="panel lv-o-card" style={{marginTop:10}}><h3>文件檢索相關度門檻</h3>
      <p className="muted small" style={{margin:'4px 0 10px'}}>數值是<b>距離</b>，越小代表越相似。距離 ≤「高相關」線：正常引用；介於兩線之間：保留但標示「低相關」；超過「捨棄」線：不交給模型，模型會被告知沒有找到足夠相關的文件。預設 0.34／0.40 是用示範知識庫量測的起點（真正命中約 0.26–0.31，查無相關約 0.36–0.49）；換成真實院內文件後，請用 <code>backend/scripts/calibrate_rag.py</code> 重新量測。變更立即生效並寫入稽核記錄。</p>
      {feat===null&&<span className="small muted">讀取目前設定中…</span>}
      {feat!==null&&feat!==false&&rag&&<div className="inline" style={{alignItems:'flex-end',gap:12,flexWrap:'wrap'}}>
        <Field label="高相關線（≤ 此值）"><input type="number" step="0.01" min="0.05" max="1" value={rag.keep} onChange={e=>setRag(r=>({...r,keep:e.target.value}))} style={{width:110}}/></Field>
        <Field label="捨棄線（> 此值不使用）"><input type="number" step="0.01" min="0.05" max="1" value={rag.max} onChange={e=>setRag(r=>({...r,max:e.target.value}))} style={{width:110}}/></Field>
        <button className="btn primary" disabled={!ragDirty||!ragValid||featBusy} onClick={saveRag}>{featBusy?'儲存中…':'儲存門檻'}</button>
        <button className="btn" disabled={!ragDirty||featBusy} onClick={()=>setRag({keep:String(feat.rag_keep_distance),max:String(feat.rag_max_distance)})}>還原</button>
        {!ragValid&&<span className="small" role="alert" style={{color:'#b3261e'}}>高相關線不可大於捨棄線，範圍 0.05–1。</span>}
      </div>}
    </section>
  </div>;
}
