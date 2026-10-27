import React,{Fragment,useCallback,useEffect,useMemo,useState} from 'react';
import {DownloadSimple,ArrowClockwise,MagnifyingGlass,CaretDown,CaretUp,Copy,Check} from '@phosphor-icons/react';
import {api,saveBlob} from '../api';
import {Empty} from '../ListKit';
import {DEPARTMENTS,ACTION_LABEL,AUDIT_CATEGORIES,ROLE_LABEL,fmtInt,fmtDateTime,ymd,daysAgo,errText} from './constants';
import {Loading,Kpi,Delta} from './shared';
import './admin.css';

const PAGE=25;
const TABS=[['','全部'],['inference','Agent 推論'],['connector','連接器'],['build','建置與知識'],['access','帳號與匯出'],['alerts','異常警示']];
const SEVERITIES=[['','所有狀態'],['info','一般紀錄'],['success','成功'],['warning','異常 / 失敗']];
const RANGES=[['today','今日'],['7d','近 7 天'],['30d','近 30 天'],['custom','自訂區間']];
const rangeDates=r=>({from:r==='today'?daysAgo(0):r==='30d'?daysAgo(29):daysAgo(6),to:daysAgo(0)});
const str=v=>v==null?'':String(v);
const fmtBytes=n=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${(n/1024).toFixed(1)} KB`:`${n} B`;
const clock=iso=>{if(!iso)return {time:'—',day:''};const d=new Date(iso);return {time:d.toLocaleTimeString('zh-TW',{hour12:false}),day:ymd(d)===daysAgo(0)?'今日':`${d.getMonth()+1}/${d.getDate()}`}};

// One human sentence per event plus an optional evidence line (port of describe() in Audit.tsx).
function describe(e){
  const d=e.details||{};
  switch(e.action){
    case 'agent.run':{const m=Array.isArray(d.models)?d.models.join('、'):'';return {text:`執行推論${d.latency_ms!=null?` · ${fmtInt(d.latency_ms)} ms`:''}${m?` · ${m}`:''}`,sub:'使用者輸入已去識別化，對話內容不寫入稽核記錄'}}
    case 'agent.approve':return {text:`核准流程中的外部動作（節點 ${str(d.node_id)||'—'}）`};
    case 'agent.reject':return {text:`駁回流程中的外部動作（節點 ${str(d.node_id)||'—'}）`,sub:'流程已停止，未呼叫外部系統',warn:true};
    case 'connector.invoke':{const ok=d.ok!==false;return {text:`${str(d.connector_action)||'呼叫'}${ok?' · 成功':` · 失敗：${str(d.error)||'未知錯誤'}`}`,sub:d.args!==undefined?'呼叫參數已依連接器設定留存':'此連接器設定為不留存呼叫參數',warn:!ok}}
    case 'connector.test':return {text:`連線測試${d.ok===false?'失敗':'成功'}：${str(d.message)}`};
    case 'connector.create':return {text:`新增連接器（${str(d.type)}）${str(d.label)}`,sub:'憑證存於 Secret Manager，不寫入稽核記錄'};
    case 'connector.update':return {text:d.credentials_changed?'更新設定並輪替憑證':'更新連接器設定'};
    case 'connector.delete':return {text:'刪除連接器與其憑證'};
    case 'agent.create':return {text:`建立 Agent「${str(d.name)||e.target_label}」`};
    case 'agent.update':return {text:'更新 Agent 草稿'};
    case 'agent.publish':return {text:`發布為全院可用版本 v${str(d.version)}`};
    case 'agent.unpublish':return {text:'自全院下架，回到草稿狀態'};
    case 'agent.publish_request':return {text:`申請將 v${str(d.version)} 發布至全院`};
    case 'agent.publish_withdraw':return {text:`撤回 v${str(d.version)} 的發布申請`};
    case 'agent.publish_approve':return {text:`核可 v${str(d.version)}，已成為全院可用版本`};
    case 'agent.publish_reject':return {text:`退回 v${str(d.version)} 的發布申請`,sub:str(d.reason),warn:true};
    case 'agent.delete':return {text:'刪除 Agent 及其知識文件與檢索語料庫'};
    case 'knowledge.upload':return {text:`上傳「${str(d.file)}」${d.bytes?` · ${fmtBytes(Number(d.bytes))}`:''}`,sub:d.deidentified?'內容已去識別化後才建立索引':'舊紀錄：當時未去識別化，需重建索引'};
    case 'knowledge.reindex':return {text:`「${str(d.file)}」以去識別化文字重建索引`};
    case 'knowledge.delete':return {text:`移除「${str(d.file)}」`};
    case 'knowledge.error':return {text:`「${str(d.file)}」索引失敗`,sub:str(d.error),warn:true};
    case 'user.first_login':return {text:`首次登入平台，角色為${ROLE_LABEL[str(d.role)]||str(d.role)}`,sub:d.preregistered?'使用管理員預先註冊的角色':undefined};
    case 'user.preregister':return {text:`預先註冊 ${e.target_label}，角色為${ROLE_LABEL[str(d.role)]||str(d.role)}`};
    case 'user.preregister_cancel':return {text:`取消 ${e.target_label} 的預先註冊`};
    case 'user.role':return {text:`角色：${ROLE_LABEL[str(d.old)]||str(d.old)||'—'} → ${ROLE_LABEL[str(d.new)]||str(d.new)}`,sub:str(d.reason)};
    case 'user.suspend':return {text:'停用帳號：無法登入與呼叫平台 API',sub:`${str(d.reason)}${d.firebase_synced===false?'（Firebase 帳號停用失敗，僅由平台阻擋）':''}`,warn:true};
    case 'user.reactivate':return {text:'恢復帳號存取',sub:str(d.reason)};
    case 'user.update':return {text:`所屬科別：${str(d.old)||'未設定'} → ${str(d.department)||'未設定'}`};
    case 'users.export':return {text:`匯出帳號清冊${d.rows!=null?` · ${fmtInt(d.rows)} 列`:''}`};
    case 'monitoring.export':case 'audit.export':return {text:`匯出 ${str(d.range_from)} ～ ${str(d.range_to)}${d.rows!=null?` · ${fmtInt(d.rows)} 列`:''}`,sub:d.department?`科別：${str(d.department)}`:undefined};
    default:return {text:Object.entries(d).map(([k,v])=>`${k}=${Array.isArray(v)?v.join(','):str(v)}`).join(' · ')||'—'};
  }
}

const SevPill=({s})=>s==='warning'?<span className="lv-pill err">異常</span>:s==='success'?<span className="lv-pill ok">成功</span>:<span className="lv-pill">已記錄</span>;

export default function AuditPage({me,notify,initialQuery}){
  const iq=initialQuery||{};
  const [tab,setTab]=useState(iq.category||'');
  const [range,setRange]=useState(()=>iq.from&&iq.to?'custom':RANGES.some(r=>r[0]===iq.range)?iq.range:'7d');
  const [custom,setCustom]=useState(()=>iq.from&&iq.to?{from:iq.from,to:iq.to}:rangeDates('7d'));
  const [department,setDepartment]=useState(iq.department||'');
  const [severity,setSeverity]=useState(iq.severity||'');
  const [qInput,setQInput]=useState(iq.q||'');
  const [q,setQ]=useState(iq.q||'');
  const [cursors,setCursors]=useState([null]); // cursors[i] opens page i
  const [pageIdx,setPageIdx]=useState(0);
  const [page,setPage]=useState(null);
  const [summary,setSummary]=useState(null);
  const [open,setOpen]=useState(null);
  const [busy,setBusy]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [nonce,setNonce]=useState(0);

  // re-apply when a deep link changes while mounted
  const iqKey=JSON.stringify(iq);
  useEffect(()=>{
    if(!initialQuery)return;
    setTab(iq.category||'');setDepartment(iq.department||'');setSeverity(iq.severity||'');setQInput(iq.q||'');setQ(iq.q||'');
    if(iq.from&&iq.to){setRange('custom');setCustom({from:iq.from,to:iq.to})}else if(iq.range)setRange(RANGES.some(r=>r[0]===iq.range)?iq.range:'7d');
  },[iqKey]);// eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{const t=setTimeout(()=>setQ(qInput.trim()),350);return ()=>clearTimeout(t)},[qInput]);
  const query=useMemo(()=>({...(range==='custom'?custom:rangeDates(range)),category:tab,severity,department,q}),[range,custom,tab,severity,department,q]);
  useEffect(()=>{setCursors([null]);setPageIdx(0);setOpen(null)},[query]);

  useEffect(()=>{
    let live=true;setBusy(true);
    api.audit(query,cursors[pageIdx],PAGE)
      .then(p=>{if(!live)return;setPage(p);setCursors(c=>[...c.slice(0,pageIdx+1),p.next_cursor])})
      .catch(e=>{if(live){notify?.('載入稽核記錄失敗：'+errText(e));setPage(p=>p||{items:[],next_cursor:null,truncated:false})}})
      .finally(()=>live&&setBusy(false));
    return ()=>{live=false};
    // not keyed on `cursors`: this effect advances it
  },[query,pageIdx,nonce]);// eslint-disable-line react-hooks/exhaustive-deps

  const loadSummary=useCallback(()=>{api.auditSummary().then(setSummary).catch(e=>{notify?.('載入稽核摘要失敗：'+errText(e));setSummary(s=>s||false)})},[notify]);
  useEffect(()=>{loadSummary()},[loadSummary]);

  if(me&&me.role!=='admin')return <div className="card-page lv-page"><Empty text="此頁面僅限系統管理員。"/></div>;

  const refresh=()=>{loadSummary();setCursors([null]);setPageIdx(0);setNonce(n=>n+1)};
  async function exportCsv(){
    setExporting(true);
    try{saveBlob(await api.auditCsv(query),`tcvgh-audit_${query.from}_${query.to}.csv`);notify?.('已匯出稽核報表（匯出動作本身也會留下紀錄）')}
    catch(e){notify?.('匯出失敗：'+errText(e))}finally{setExporting(false)}
  }
  const items=page?.items||[];
  const hasNext=!!cursors[pageIdx+1];
  const s=summary||null;
  const cats=s?Object.keys(AUDIT_CATEGORIES).map(k=>({k,n:s.by_category?.[k]||0})).filter(p=>p.n>0):[];

  return <div className="card-page lv-page">
    <div className="page-heading"><h1>稽核記錄</h1><div className="lv-actions">
      <button className="btn" onClick={refresh} disabled={busy}><ArrowClockwise className={busy?'lv-spin':''}/>重新整理</button>
      <button className="btn primary" onClick={exportCsv} disabled={exporting}><DownloadSimple/>匯出 CSV</button>
    </div></div>
    <p className="subtitle">全院人員對 Agent、知識文件、連接器與帳號權限的操作軌跡（僅追加、不可修改）。對話內容與連接器憑證不寫入稽核記錄；匯出依目前篩選，最多 5,000 筆。</p>

    {summary===null?<Loading/>:summary===false?null:<>
      <div className="lv-kpis">
        <Kpi label="今日稽核事件" value={fmtInt(s.total)} unit="筆" foot={<><Delta pct={s.delta_pct}/> vs 昨日（{fmtInt(s.total_yesterday)} 筆）</>}>
          {s.total>0?<div style={{marginTop:'auto'}}><div className="lv-stack">{cats.map(p=><div key={p.k} style={{width:p.n/s.total*100+'%',background:AUDIT_CATEGORIES[p.k].color}} title={`${AUDIT_CATEGORIES[p.k].label} ${p.n}`}/>)}</div>
            <div className="lv-kpi-rows" style={{border:0,paddingTop:0}}>{cats.map(p=><div key={p.k} className="lv-kpi-row"><span><i style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:AUDIT_CATEGORIES[p.k].color,marginRight:6}}/>{AUDIT_CATEGORIES[p.k].label}</span><b>{Math.round(p.n/s.total*100)}%</b></div>)}</div></div>:<span className="lv-hint" style={{marginTop:'auto'}}>今日尚無事件</span>}
        </Kpi>
        <Kpi label="連接器調用" value={fmtInt(s.connector_calls)} unit="次" tone={s.connector_failed?'err':''}
          foot={s.connector_calls===0?'今日尚無連接器調用':`成功率 ${(((s.connector_calls-s.connector_failed)/s.connector_calls)*100).toFixed(1)}%${s.connector_failed?`（失敗 ${s.connector_failed}）`:''}`}
          rows={(s.top_connectors||[]).map(c=>({k:c.label,v:`${fmtInt(c.count)} 次`}))}/>
        <Kpi label="異常與失敗事件" value={fmtInt(s.warnings)} unit="筆" tone={s.warnings?'err':''} onClick={()=>{setTab('alerts');setRange('today');setSeverity('')}}
          foot={s.warnings?'點此檢視今日異常':'今日無異常事件'}
          rows={(s.warning_breakdown||[]).map(w=>({k:ACTION_LABEL[w.key]||w.key,v:`${fmtInt(w.count)} 筆`,tone:'err'}))}/>
        <Kpi label="今日活躍使用者" value={fmtInt(s.active_users)} unit="人" foot="依今日稽核紀錄的操作者計算"
          rows={[{k:'執行 Agent 推論',v:`${fmtInt(s.run_users)} 人`},{k:'建置 / 設定變更',v:`${fmtInt(s.build_users)} 人`},{k:'被呼叫的 Agent',v:`${fmtInt(s.agents_invoked)} 個`}]}/>
      </div>
      {s.capped&&<p className="lv-hint" style={{color:'#c27c1e',marginTop:-8}}>今日事件超過統計上限，以上數字為下限值。</p>}
    </>}

    <div className="lv-filters"><div className="lv-seg">{TABS.map(([id,l])=><button key={id||'all'} className={(tab===id?'on ':'')+(id==='alerts'?'alert':'')} onClick={()=>setTab(id)}>{l}</button>)}</div></div>
    <div className="lv-filters">
      <label className="search" style={{display:'flex',alignItems:'center',gap:6,border:'1px solid #e3ebe7',borderRadius:7,padding:'0 10px',height:36,background:'#fff'}}><MagnifyingGlass size={15}/><input aria-label="搜尋稽核記錄" style={{border:0,outline:0,flex:1,padding:0}} value={qInput} onChange={e=>setQInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&setQ(qInput.trim())} placeholder="搜尋操作者 e-mail、Agent、連接器、事件 ID 或內容"/></label>
      <select aria-label="科別" value={department} onChange={e=>setDepartment(e.target.value)}><option value="">全院所有科別</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select>
      <select aria-label="狀態" value={severity} onChange={e=>setSeverity(e.target.value)}>{SEVERITIES.map(([id,l])=><option key={id} value={id}>{l}</option>)}</select>
      <select aria-label="日期區間" value={range} onChange={e=>setRange(e.target.value)}>{RANGES.map(([id,l])=><option key={id} value={id}>{l}</option>)}</select>
      {range==='custom'&&<><input type="date" aria-label="開始日期" value={custom.from} max={custom.to} onChange={e=>setCustom(c=>({...c,from:e.target.value}))}/><span className="muted">～</span><input type="date" aria-label="結束日期" value={custom.to} min={custom.from} max={daysAgo(0)} onChange={e=>setCustom(c=>({...c,to:e.target.value}))}/></>}
    </div>
    {department&&<p className="lv-hint" style={{marginTop:-8,marginBottom:12}}>科別依事件所屬 Agent 的科別判斷；與 Agent 無關的事件（如匯出）不會出現在科別篩選結果中。</p>}

    <div className="lv-card" style={{padding:'14px 8px 12px'}}>
      {page===null?<Loading/>:items.length===0?<Empty text={page.truncated?'已掃描的紀錄中沒有符合項目，可按「下一頁」繼續往更早的紀錄搜尋。':'此條件下沒有稽核記錄。調整日期、類別或搜尋字詞後再試一次。'}/>:
      <div className="lv-table-wrap" style={{opacity:busy?.6:1}}><table className="lv-table" style={{minWidth:960}}><thead><tr><th>時間 / 事件 ID</th><th>操作者</th><th>類別 / 動作</th><th>目標</th><th>詳情</th><th>狀態</th><th/></tr></thead><tbody>
        {items.map(e=><EventRow key={e.id} e={e} open={open===e.id} onToggle={()=>setOpen(o=>o===e.id?null:e.id)}/>)}
      </tbody></table></div>}
      {page!==null&&<div className="lv-pager" style={{padding:'12px 14px 0'}}>
        <span>第 {pageIdx+1} 頁{items.length>0&&`，本頁 ${items.length} 筆`}{page.truncated&&<span style={{color:'#c27c1e',marginLeft:8}}>本頁未填滿，可按「下一頁」繼續往前搜尋。</span>}</span>
        <span className="lv-actions"><button className="btn" disabled={busy||pageIdx===0} onClick={()=>setPageIdx(0)}>第一頁</button><button className="btn" disabled={busy||pageIdx===0} onClick={()=>setPageIdx(p=>p-1)}>上一頁</button><button className="btn" disabled={busy||!hasNext} onClick={()=>setPageIdx(p=>p+1)}>下一頁</button></span></div>}
    </div>
  </div>;
}

function EventRow({e,open,onToggle}){
  const warn=e.severity==='warning'||describe(e).warn;
  const c=AUDIT_CATEGORIES[e.category]||AUDIT_CATEGORIES.other;
  const t=clock(e.at),desc=describe(e);
  const [copied,setCopied]=useState(false);
  const json=useMemo(()=>JSON.stringify({event_id:e.id,at:e.at,actor:{uid:e.actor,email:e.actor_email},action:e.action,category:e.category,severity:e.severity,target:{kind:e.target_kind,id:e.target_id,label:e.target_label},agent:e.agent_label||undefined,department:e.department||undefined,details:e.details},null,2),[e]);
  const copy=()=>navigator.clipboard?.writeText(json).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500)}).catch(()=>{});
  return <Fragment>
    <tr className={'clickable '+(e.severity==='warning'?'lv-warnrow':'')} onClick={onToggle}>
      <td style={{whiteSpace:'nowrap'}}><span className="mono" style={{color:e.severity==='warning'?'#b3261e':undefined}}>{t.time} <span className="muted">{t.day}</span></span><span className="sub mono">{e.id}</span></td>
      <td style={{whiteSpace:'nowrap'}}><b style={{fontWeight:500}}>{(e.actor_email||e.actor||'').split('@')[0]}</b><span className="sub">{e.actor_email?'@'+e.actor_email.split('@')[1]:''}</span></td>
      <td style={{whiteSpace:'nowrap'}}><span className="lv-pill"><i style={{color:c.color}}/>{c.label}</span><span className="sub">{ACTION_LABEL[e.action]||e.action}</span></td>
      <td style={{maxWidth:220}}>{e.target_kind?<><b style={{fontWeight:500}}>{e.target_label||'—'}</b><span className="sub">{e.target_kind==='connector'&&e.agent_label?`經由 ${e.agent_label}`:e.target_kind==='user'?'平台帳號':[e.department,e.target_id].filter(Boolean).join(' · ')||'平台'}</span></>:<span className="muted">—</span>}</td>
      <td style={{maxWidth:340}}><span style={warn?{color:'#b3261e'}:null}>{desc.text}</span>{desc.sub&&<span className="sub">{desc.sub}</span>}</td>
      <td><SevPill s={e.severity}/></td>
      <td>{open?<CaretUp/>:<CaretDown/>}</td>
    </tr>
    {open&&<tr><td colSpan={7} style={{background:'#fbfefd'}}><div className="lv-detail">
      <dl className="lv-dl">
        <dt>事件 ID</dt><dd className="lv-mono">{e.id}</dd>
        <dt>發生時間</dt><dd>{fmtDateTime(e.at)}</dd>
        <dt>操作者</dt><dd>{e.actor_email||'—'}</dd>
        <dt>操作者 UID</dt><dd className="lv-mono">{e.actor||'—'}</dd>
        <dt>動作</dt><dd>{ACTION_LABEL[e.action]||e.action}（{e.action}）</dd>
        {e.target_id&&<><dt>目標 ID</dt><dd className="lv-mono">{e.target_id}</dd></>}
        {e.agent_label&&<><dt>相關 Agent</dt><dd>{e.agent_label}</dd></>}
        <dt>所屬科別</dt><dd>{e.department||'—'}</dd>
      </dl>
      <div><div className="lv-actions" style={{justifyContent:'space-between',marginBottom:6}}><span className="small muted">事件原始紀錄 (JSON)</span><button className="btn" onClick={ev=>{ev.stopPropagation();copy()}}>{copied?<Check/>:<Copy/>}{copied?'已複製':'複製'}</button></div><pre className="lv-mono">{json}</pre></div>
    </div></td></tr>}
  </Fragment>;
}
