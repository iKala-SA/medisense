import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Bar,BarChart,CartesianGrid,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {DownloadSimple,ArrowClockwise,MagnifyingGlass,CaretUp,CaretDown} from '@phosphor-icons/react';
import {api,saveBlob} from '../api';
import {Empty} from '../ListKit';
import {DEPARTMENTS,fmtInt,ymd,errText} from './constants';
import {Loading,Kpi,Delta} from './shared';
import './admin.css';

const RANGES=[['today','今日'],['7d','近 7 天'],['month','本月'],['custom','自訂區間']];
const SERIES=['#23945f','#6bdca7','#2a8f9c','#c27c1e','#d15f8b','#8d8799'];
const PAGE=10;
const shift=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const rangeDates=r=>{
  const now=new Date();
  if(r==='today')return {from:ymd(now),to:ymd(now)};
  if(r==='month')return {from:ymd(new Date(now.getFullYear(),now.getMonth(),1)),to:ymd(now)};
  return {from:ymd(shift(now,-6)),to:ymd(now)};
};
const fmtTokens=n=>n>=1e9?`${(n/1e9).toFixed(2)} B`:n>=1e6?`${(n/1e6).toFixed(1)} M`:n>=1e3?`${(n/1e3).toFixed(1)} k`:String(n||0);
// Backend reports cost in USD; NT$ is derived with usd_twd_rate from the summary.
const fmtUsd=(n,d=2)=>`$${Number(n||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})}`;
const fmtDay=iso=>{const d=new Date(`${iso}T00:00:00`);return `${d.getMonth()+1}/${d.getDate()} ${'日一二三四五六'[d.getDay()]}`};

// Table columns. `sort` is a server sort key (api.monitoringAgents); others sort client side.
const COLS=[
  {k:'name',label:'Agent / 科別',client:true},
  {k:'owner_email',label:'建立者',client:true},
  {k:'main_model',label:'主要模型',client:true},
  {k:'requests',label:'請求次數',r:true,server:true},
  {k:'tokens',label:'Token',r:true,server:true},
  {k:'cost_usd',label:'花費 (USD)',r:true,server:true},
  {k:'avg_latency_ms',label:'平均延遲',r:true,server:true},
  {k:'fallbacks',label:'失敗 / 降級',r:true,server:true}
];

function Tip({active,payload,label}){
  if(!active||!payload?.length)return null;
  const total=payload.reduce((s,p)=>s+(p.value||0),0),pt=payload[0].payload;
  return <div className="lv-tip"><b>{label}</b><p>{fmtInt(pt.requests)} 次呼叫 · {fmtTokens(total)} tokens · {fmtUsd(pt.cost)}</p>
    {[...payload].reverse().map(p=><p key={p.name}><span className="sw" style={{background:p.color}}/>{p.name}<span style={{float:'right',marginLeft:14}}>{fmtTokens(p.value||0)}</span></p>)}</div>;
}

export default function MonitoringPage({me,notify}){
  const [range,setRange]=useState('7d');
  const [custom,setCustom]=useState(rangeDates('7d'));
  const [department,setDepartment]=useState('');
  const [sort,setSort]=useState('requests');
  const [clientSort,setClientSort]=useState(null); // {k,dir}
  const [summary,setSummary]=useState(null);
  const [rows,setRows]=useState(null);
  const [q,setQ]=useState('');
  const [page,setPage]=useState(1);
  const [busy,setBusy]=useState(false);
  const [exporting,setExporting]=useState(false);

  const query=useMemo(()=>({...(range==='custom'?custom:rangeDates(range)),department}),[range,custom,department]);

  const load=useCallback(()=>{
    let live=true;setBusy(true);
    Promise.all([api.monitoringSummary(query),api.monitoringAgents(query,sort)])
      .then(([s,r])=>{if(live){setSummary(s);setRows(r)}})
      .catch(e=>{if(live){notify?.('載入用量資料失敗：'+errText(e));setSummary(s=>s||false);setRows(r=>r||[])}})
      .finally(()=>live&&setBusy(false));
    return ()=>{live=false};
  },[query,sort,notify]);
  useEffect(load,[load]);
  useEffect(()=>setPage(1),[query,sort,q,clientSort]);

  const chart=useMemo(()=>(summary?.daily||[]).map(d=>({date:fmtDay(d.date),cost:d.cost_usd,requests:d.requests,...Object.fromEntries((d.by_model||[]).map(m=>[m.model,m.tokens]))})),[summary]);
  const shown=useMemo(()=>{
    const n=q.trim().toLowerCase();
    let list=(rows||[]).filter(r=>!n||[r.name,r.owner_email,r.department,r.main_model,r.agent_id].some(s=>(s||'').toLowerCase().includes(n)));
    if(clientSort){const {k,dir}=clientSort;list=[...list].sort((a,b)=>String(a[k]||'').localeCompare(String(b[k]||''),'zh-TW')*dir)}
    return list;
  },[rows,q,clientSort]);

  if(me&&me.role!=='admin')return <div className="card-page lv-page"><Empty text="此頁面僅限系統管理員。"/></div>;

  async function exportCsv(){
    setExporting(true);
    try{saveBlob(await api.monitoringCsv(query),`tcvgh-agent-cost_${query.from}_${query.to}.csv`);notify?.('已匯出成本報表')}
    catch(e){notify?.('匯出失敗：'+errText(e))}finally{setExporting(false)}
  }
  const onSort=c=>{
    if(c.server){setClientSort(null);setSort(c.k)}
    else setClientSort(s=>s?.k===c.k?{k:c.k,dir:-s.dir}:{k:c.k,dir:1});
  };

  const pages=Math.max(1,Math.ceil(shown.length/PAGE));
  const pageRows=shown.slice((page-1)*PAGE,page*PAGE);
  const s=summary||null;
  const tokens=s?(s.prompt_tokens||0)+(s.completion_tokens||0):0;
  const budgetPct=s&&s.monthly_budget_usd>0?(s.month_cost_usd/s.monthly_budget_usd)*100:0;
  const bTone=budgetPct>=100?'err':budgetPct>=85?'warn':'';
  const okPct=s&&s.requests>0?((s.requests-s.failed)/s.requests)*100:null;
  const maxReq=Math.max(1,...(rows||[]).map(r=>r.requests));

  return <div className="card-page lv-page">
    <div className="page-heading"><h1>用量與成本</h1><div className="lv-actions">
      <button className="btn" onClick={load} disabled={busy}><ArrowClockwise className={busy?'lv-spin':''}/>重新整理</button>
      <button className="btn primary" onClick={exportCsv} disabled={exporting||!s}><DownloadSimple/>匯出 CSV</button>
    </div></div>
    <p className="subtitle">全院自建 Agent 的推論呼叫、Token 消耗、模型成本與月度預算總覽。資料來自每次模型呼叫紀錄（不含對話內容），成本以 USD 計價並依匯率換算新台幣。</p>

    <div className="lv-filters">
      <div className="lv-seg">{RANGES.map(([id,l])=><button key={id} className={range===id?'on':''} onClick={()=>setRange(id)}>{l}</button>)}</div>
      {range==='custom'&&<><input type="date" aria-label="開始日期" value={custom.from} max={custom.to} onChange={e=>setCustom(c=>({...c,from:e.target.value}))}/><span className="muted">～</span><input type="date" aria-label="結束日期" value={custom.to} min={custom.from} max={ymd(new Date())} onChange={e=>setCustom(c=>({...c,to:e.target.value}))}/></>}
      <select aria-label="科別" value={department} onChange={e=>setDepartment(e.target.value)}><option value="">全部科別（全院）</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select>
    </div>

    {summary===null?<Loading/>:summary===false?<Empty text="無法取得用量資料，請稍後重試。"/>:<>
      <div className="lv-kpis">
        <Kpi label="總 Token 消耗" value={fmtTokens(tokens)} unit="tokens" foot={<><Delta pct={s.tokens_delta_pct}/> vs 上一期間</>} rows={[{k:'輸入 Prompt',v:fmtTokens(s.prompt_tokens)},{k:'輸出 Completion',v:fmtTokens(s.completion_tokens)}]}/>
        <Kpi label="總呼叫次數" value={fmtInt(s.requests)} unit="次" foot={<><Delta pct={s.requests_delta_pct}/> vs 上一期間</>} rows={[{k:'平均延遲',v:`${fmtInt(s.avg_latency_ms)} ms`},{k:'成功率',v:okPct==null?'—':`${okPct.toFixed(2)}%（失敗 ${fmtInt(s.failed)}）`},{k:'模型降級',v:fmtInt(s.fallbacks),tone:s.fallbacks>0?'warn':''}]}/>
        <Kpi label="累積成本" value={fmtUsd(s.cost_usd)} unit="USD" tone={bTone==='err'?'err':''} foot={`約 NT$ ${fmtInt(Math.round(s.cost_usd*s.usd_twd_rate))} · 均次 ${s.requests?fmtUsd(s.cost_usd/s.requests,4):'—'}`}>
          <div className="lv-kpi-rows"><div className="lv-kpi-row"><span>月度預算 {fmtUsd(s.monthly_budget_usd,0)}</span><b>{budgetPct.toFixed(1)}%{bTone==='err'?'（超支）':bTone==='warn'?'（警戒）':''}</b></div>
            <div className={'lv-bar '+bTone}><i style={{width:Math.min(100,budgetPct)+'%'}}/></div>
            <span className="lv-hint">本月累計 {fmtUsd(s.month_cost_usd)}（全院，不受篩選影響）</span></div>
        </Kpi>
        <Kpi label="啟用中的 Agent" value={fmtInt(s.active_agents)} unit="個" foot={`全院共 ${s.total_agents} 個 Agent`} rows={[{k:'已發布上線',v:`${s.published_agents} 個`},{k:'草稿 / 沙盒',v:`${s.total_agents-s.published_agents} 個`}]}/>
      </div>

      <div className="lv-card"><h2>每日 Token 消耗趨勢</h2><p className="lv-sub">{s.range_from} ～ {s.range_to}：依實際服務模型堆疊，滑鼠移至長條可查看當日費用（USD）。</p>
        {s.requests===0?<Empty text="此期間尚無模型呼叫。"/>:<div className="lv-chart"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{top:8,right:8,left:0,bottom:0}} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="#edf5f1"/>
            <XAxis dataKey="date" tick={{fontSize:11,fill:'#73737c'}} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={fmtTokens} tick={{fontSize:11,fill:'#73737c'}} axisLine={false} tickLine={false} width={56}/>
            <Tooltip cursor={{fill:'#f4fcf8'}} content={<Tip/>}/>
            <Legend iconType="square" iconSize={10} wrapperStyle={{fontSize:12}}/>
            {(s.models||[]).map((m,i)=><Bar key={m} dataKey={m} stackId="t" isAnimationActive={false} fill={SERIES[i%SERIES.length]} radius={i===s.models.length-1?[3,3,0,0]:0}/>)}
          </BarChart></ResponsiveContainer></div>}
      </div>

      <div className="lv-card"><div className="lv-filters" style={{justifyContent:'space-between',marginBottom:12}}>
        <div><h2>Agent 用量排行 <span className="lv-chip">{shown.length} 個</span></h2><p className="lv-sub" style={{margin:0}}>點選表頭排序（請求、Token、花費、延遲、降級為伺服器端排序）。</p></div>
        <label className="search" style={{display:'flex',alignItems:'center',gap:6,border:'1px solid #e3ebe7',borderRadius:7,padding:'0 10px',height:36,flex:'0 1 300px'}}><MagnifyingGlass size={15}/><input aria-label="搜尋 Agent" style={{border:0,outline:0,flex:1,padding:0}} value={q} onChange={e=>setQ(e.target.value)} placeholder="搜尋 Agent、建立者、科別或模型"/></label></div>
        {rows===null?<Loading/>:shown.length===0?<Empty text="沒有符合條件的 Agent。"/>:<div className="lv-table-wrap"><table className="lv-table"><thead><tr>
          <th>#</th>{COLS.map(c=>{const on=c.server?(!clientSort&&sort===c.k):clientSort?.k===c.k;return <th key={c.k} className={'sortable '+(c.r?'r ':'')+(on?'on':'')} onClick={()=>onSort(c)}>{c.label}{on&&(!c.server&&clientSort?.dir===-1?<CaretUp size={11}/>:<CaretDown size={11}/>)}</th>})}</tr></thead>
          <tbody>{pageRows.map((r,i)=><tr key={r.agent_id}>
            <td className="mono">{(page-1)*PAGE+i+1}</td>
            <td><b style={{fontWeight:500}}>{r.name}</b><span className="sub">{r.department||'未指定科別'}{r.status&&r.status!=='published'&&` · ${r.status==='deleted'?'已刪除':'草稿'}`}</span></td>
            <td className="small">{r.owner_email||'—'}</td>
            <td>{r.main_model?<span className="lv-chip">{r.main_model}</span>:'—'}{r.main_group&&<span className="sub">group: {r.main_group}</span>}</td>
            <td className="r">{fmtInt(r.requests)}<div className="lv-bar" style={{width:70,marginLeft:'auto'}}><i style={{width:Math.min(100,r.requests/maxReq*100)+'%'}}/></div></td>
            <td className="r">{fmtTokens(r.tokens)}</td>
            <td className="r">{fmtUsd(r.cost_usd)}<span className="sub">{r.requests?`${fmtUsd(r.cost_usd/r.requests,4)} / 次`:''}</span></td>
            <td className="r">{fmtInt(r.avg_latency_ms)} ms</td>
            <td className="r"><span style={r.failed?{color:'#b3261e'}:null}>{r.failed}</span> / <span style={r.fallbacks?{color:'#c27c1e'}:null}>{r.fallbacks}</span></td>
          </tr>)}</tbody></table></div>}
        {shown.length>PAGE&&<div className="lv-pager"><span>第 {(page-1)*PAGE+1}–{Math.min(page*PAGE,shown.length)} 項，共 {shown.length} 個</span><span className="lv-actions"><button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一頁</button><span>{page} / {pages}</span><button className="btn" disabled={page===pages} onClick={()=>setPage(p=>p+1)}>下一頁</button></span></div>}
      </div>
    </>}
  </div>;
}
