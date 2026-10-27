import React,{useState} from 'react';
import {ShieldCheck,Warning,Info} from '@phosphor-icons/react';
import {api} from '../api';
import {errText,useOnce,Loading,Banner} from './pkit';
import './pages.css';

const yn=v=>v===undefined||v===null?'後端未回報':v?'是':'否';

export default function SecurityPage({me,notify}){
  const [h,setH]=useState(undefined),[err,setErr]=useState('');
  useOnce(async()=>{
    try{setH(await api.health())}
    catch(e){setH(null);setErr(errText(e));notify('無法取得 /api/health：'+errText(e))}
  });
  if(h===undefined)return <div className="lv-p"><Loading/></div>;
  const rows=h?[
    ['服務狀態',h.ok?'後端回報正常（ok）':'後端回報異常'],
    ['專案 / 區域',[h.project,h.region].filter(Boolean).join(' / ')||'後端未回報'],
    ['去識別化（deid）',h.deid==='always'?'always：一律去識別化':String(h.deid??'後端未回報')],
    ['RAG 已啟用（rag_enabled）',yn(h.rag_enabled)],
    ['RAG 位置（rag_location）',h.rag_location||'後端未回報'],
    ['DLP 檢查範本',h.dlp_inspect_template||'未設定／後端未回報'],
  ]:[];
  return <div className="lv-p">
    <div className="page-heading"><h1><ShieldCheck/>安全控管</h1></div>
    <p className="subtitle">後端實際回報的設定，以及平台對敏感資料的處理原則。</p>
    {!h&&<Banner icon={<Warning size={16}/>}>無法連到 /api/health（{err}）。以下僅顯示政策說明，無法確認後端目前狀態。</Banner>}
    {h&&<section className="panel" style={{padding:20,marginBottom:18}}>
      <h2 style={{fontSize:15,margin:'0 0 14px'}}>即時健康狀態 <span className="badge">來源：/api/health</span></h2>
      <dl className="lv-p-kv">{rows.map(([k,v])=><React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
      <p className="lv-p-hint" style={{marginTop:12}}>這裡只呈現端點回傳的設定值，並非獨立驗證；例如 DLP 範本是否存在、RAG 是否可查詢，不在此端點檢查範圍內。</p>
    </section>}
    <section className="panel" style={{padding:20}}>
      <h2 style={{fontSize:15,margin:'0 0 12px'}}>敏感資料政策（後端設計）</h2>
      <ol className="lv-p-ol">
        <li>資料在寫入儲存或送往模型之前，一律先經去識別化（<code>deid: always</code>）；知識庫僅索引去識別化後的文字，原檔保留於加密儲存桶。</li>
        <li><b>sovereign</b> 群組僅在院內部署執行；若未設定則直接失敗（fail closed），不回退至雲端模型。</li>
        <li>連接器等憑證存放於 Secret Manager，儲存後不會回傳至瀏覽器。</li>
        <li>操作會寫入稽核紀錄（audit），管理員可於稽核頁查詢。</li>
      </ol>
      <p className="lv-p-hint" style={{marginTop:10}}>以上為後端程式的設計行為說明。此頁面不代表已通過任何第三方驗證或合規稽核。</p>
    </section>
    <div className="notice"><Info/>此頁為唯讀；政策由後端執行，無法在此修改。</div>
  </div>;
}
