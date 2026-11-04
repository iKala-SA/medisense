import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useOrgGroups } from "../../live/orgGroups";
import { Empty, ErrorBox, Icon, Spinner } from "../components/ui";
import { Delta, Kpi, Row } from "../components/Kpi";
import "./monitoring.css";
const RANGES = [
  { id: "today", label: "\u4ECA\u65E5 (Today)" },
  { id: "7d", label: "\u8FD1 7 \u5929 (Last 7 Days)" },
  { id: "month", label: "\u672C\u6708 (This Month)" },
  { id: "custom", label: "\u81EA\u8A02\u5340\u9593" }
];
const SORTS = [
  { id: "requests", label: "\u7E3D\u547C\u53EB\u91CF (Most Calls)" },
  { id: "tokens", label: "Token \u6D88\u8017 (Tokens)" },
  { id: "cost_usd", label: "\u7D2F\u7A4D\u82B1\u8CBB (Cost)" },
  { id: "cost_per_call", label: "\u6027\u50F9\u6BD4\u6700\u9AD8 (Cost / Call)" },
  { id: "fallbacks", label: "\u964D\u7D1A\u6700\u591A (Fallbacks)" }
];
const SERIES = ["#1e6242", "#8fd1b0", "#239660", "#cdeadb", "#5d6068", "#c9ced6"];
const PAGE = 10;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (d, days) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};
const rangeDates = (r) => {
  const now = /* @__PURE__ */ new Date();
  if (r === "today") return { from: ymd(now), to: ymd(now) };
  if (r === "month") return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
  return { from: ymd(shift(now, -6)), to: ymd(now) };
};
const fmtTokens = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n);
const fmtInt = (n) => n.toLocaleString("en-US");
const fmtUsd = (n, digits = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const fmtDay = (iso) => {
  const d = /* @__PURE__ */ new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()} ${["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"][d.getDay()]}`;
};
function Monitoring() {
  const nav = useNavigate();
  const [range, setRange] = useState("7d");
  const [custom, setCustom] = useState(rangeDates("7d"));
  const [tab, setTab] = useState("cost"); // 成本監控 | 用量管理
  const [filter, setFilter] = useState({ kind: "", id: "" }); // kind: person | group | agent
  const orgGroups = useOrgGroups();
  const [people, setPeople] = useState([]);
  const [agentList, setAgentList] = useState([]);
  useEffect(() => {
    api.listUsers?.().then((r) => setPeople(((r?.users) || r || []).filter((u) => u.uid).map((u) => ({ id: u.uid, name: u.name ? `${u.name}（${u.email}）` : u.email })))).catch(() => setPeople([]));
    api.listAgents?.().then((r) => setAgentList((r || []).map((a) => ({ id: a.id, name: a.name || a.id })))).catch(() => setAgentList([]));
  }, []);
  const filterOptions = filter.kind === "person" ? people : filter.kind === "group" ? (orgGroups || []) : filter.kind === "agent" ? agentList : [];
  const [env, setEnv] = useState("production"); // 正式 vs 沙盒: the sandbox is counted apart
  const [sort, setSort] = useState("requests");
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const query = useMemo(() => ({ ...range === "custom" ? custom : rangeDates(range), env,
    ...(filter.id ? { [filter.kind]: filter.id } : {}) }), [range, custom, filter, env]);
  const load = useCallback(() => {
    setBusy(true);
    setErr("");
    Promise.all([api.monitoringSummary(query), api.monitoringAgents(query, sort)]).then(([s, r]) => {
      setSummary(s);
      setRows(r);
    }).catch((e) => setErr(String(e))).finally(() => setBusy(false));
  }, [query, sort]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [query, sort, q]);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.monitoringCsv(query);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `tcvgh-agent-cost_${query.from}_${query.to}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(String(e));
    } finally {
      setExporting(false);
    }
  };
  const chart = useMemo(() => (summary?.daily ?? []).map((d) => ({
    date: fmtDay(d.date),
    cost: d.cost_usd,
    requests: d.requests,
    ...Object.fromEntries(d.by_model.map((m) => [m.model, m.tokens]))
  })), [summary]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter((r) => !needle || [r.name, r.owner_email, r.department, r.main_model, r.agent_id].some((s) => s?.toLowerCase().includes(needle))), [rows, needle]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);
  const tokens = (summary?.prompt_tokens ?? 0) + (summary?.completion_tokens ?? 0);
  const budgetPct = summary && summary.monthly_budget_usd > 0 ? summary.month_cost_usd / summary.monthly_budget_usd * 100 : 0;
  const budgetTone = budgetPct >= 100 ? "error" : budgetPct >= 85 ? "warning" : "primary";
  const successPct = summary && summary.requests > 0 ? (summary.requests - summary.failed) / summary.requests * 100 : null;
  return <div className="mon">
      <section className="mon-top">
        <div className="mon-tabs" role="tablist" aria-label="用量與成本">
          {[["cost", "成本監控"], ["manage", "用量管理"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === "cost" && <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={load} disabled={busy}><Icon name="refresh" className={`text-[18px] ${busy ? "animate-spin" : ""}`} />重新整理</button>
          <button className="btn-primary" onClick={exportCsv} disabled={exporting || !summary}>{exporting ? <Spinner className="h-4 w-4" /> : <Icon name="download" className="text-[18px]" />}匯出 CSV</button>
        </div>}
      </section>

      {tab === "manage" ? <UsageLimits orgGroups={orgGroups} /> : <>
      <section className="mon-filters">
        <div className="flex flex-wrap items-center gap-0.5 rounded-[10px] bg-surface-container p-[3px]">
          {RANGES.map((r) => <button key={r.id} onClick={() => setRange(r.id)} className={`rounded-lg px-3 py-1.5 transition-colors ${range === r.id ? "bg-white font-semibold text-primary shadow-card" : "text-on-surface-variant hover:text-on-surface"}`}>{r.label}</button>)}
          {range === "custom" && <span className="ml-1 flex items-center gap-1 font-mono">
              <input type="date" className="w-auto py-1" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <span className="text-outline">→</span>
              <input type="date" className="w-auto py-1" value={custom.to} min={custom.from} max={ymd(/* @__PURE__ */ new Date())} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </span>}
        </div>
        <div className="flex items-center gap-0.5 rounded-[10px] bg-surface-container p-[3px]" role="tablist" aria-label="環境">
          {[["production", "正式環境"], ["sandbox", "沙盒"]].map(([k, l]) => <button key={k} role="tab" aria-selected={env === k} onClick={() => setEnv(k)} className={`rounded-lg px-3 py-1.5 font-semibold transition-colors ${env === k ? "bg-primary-dark text-white" : "text-on-surface-variant hover:bg-surface-container-high"}`}>{l}</button>)}
        </div>
        <span className="hidden flex-1 md:block" />
        <div className="mon-filter">
          <select aria-label="篩選對象" value={filter.kind} onChange={(e) => setFilter({ kind: e.target.value, id: "" })}>
            <option value="">全院</option><option value="person">使用者</option><option value="group">群組</option><option value="agent">Agent</option>
          </select>
          {filter.kind && <select aria-label="篩選值" value={filter.id} onChange={(e) => setFilter({ ...filter, id: e.target.value })}>
            <option value="">{filter.kind === "person" ? "選擇使用者…" : filter.kind === "group" ? "選擇群組…" : "選擇 Agent…"}</option>
            {filterOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>}
          {filter.kind && <button className="btn-ghost" onClick={() => setFilter({ kind: "", id: "" })} aria-label="清除篩選"><Icon name="close" className="text-[18px]" /></button>}
        </div>
      </section>

      <ErrorBox msg={err} />

      {summary === null && !err ? <div className="grid place-items-center py-20"><Spinner /></div> : summary && <>
          <section className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            <Kpi
    label="Total Tokens Used"
    title="總 Token 消耗量"
    icon="toll"
    value={fmtTokens(tokens).split(" ")[0]}
    unit={`${fmtTokens(tokens).split(" ")[1] ?? ""} Tokens`}
    foot={<><Delta pct={summary.tokens_delta_pct} /><span className="text-outline"> vs 上一期間</span></>}
  >
              <Row k="輸入 Prompt" v={fmtTokens(summary.prompt_tokens)} /><Row k="輸出 Completion" v={fmtTokens(summary.completion_tokens)} />
            </Kpi>
            <Kpi
    label="Inference Invocations"
    title="總請求次數 (Inferences)"
    icon="model_training"
    value={fmtInt(summary.requests)}
    unit="次呼叫"
    foot={<><Delta pct={summary.requests_delta_pct} /><span className="text-outline"> vs 上一期間</span></>}
  >
              <Row k="平均延遲時間" v={`${fmtInt(summary.avg_latency_ms)} ms`} />
              <Row k="成功率" v={successPct == null ? "\u2014" : `${successPct.toFixed(2)}%\uFF08\u5931\u6557 ${fmtInt(summary.failed)}\uFF09`} />
              <Row k="模型降級 (fallback)" v={fmtInt(summary.fallbacks)} tone={summary.fallbacks > 0 ? "warning" : void 0} />
            </Kpi>
            <Kpi
    label="Total Model Cost"
    title="累積總成本 (Cost)"
    icon="attach_money"
    value={fmtUsd(summary.cost_usd)}
    unit="USD"
    foot={<><span className="text-outline">約合 NT$ {fmtInt(Math.round(summary.cost_usd * summary.usd_twd_rate))}</span><span className="text-outline"> · 均次呼叫 {summary.requests ? fmtUsd(summary.cost_usd / summary.requests, 4) : "\u2014"}</span></>}
  >
              <div className="flex items-center justify-between text-[11px]"><span className="text-on-surface-variant">月度預算上限 ({fmtUsd(summary.monthly_budget_usd, 0)} USD)</span>
                <span className={`font-mono font-semibold ${budgetTone === "error" ? "text-error" : budgetTone === "warning" ? "text-warning" : "text-primary"}`}>{budgetPct.toFixed(1)}%（{budgetTone === "error" ? "\u8D85\u652F" : budgetTone === "warning" ? "\u8B66\u6212" : "\u5B89\u5168"}）</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-container-high"><div className={`h-full rounded-full ${budgetTone === "error" ? "bg-error" : budgetTone === "warning" ? "bg-warning" : "bg-primary"}`} style={{ width: `${Math.min(100, budgetPct)}%` }} /></div>
              <p className="mt-1 font-mono text-[10px] text-outline">本月累計 {fmtUsd(summary.month_cost_usd)}（全院，不受上方篩選影響）</p>
            </Kpi>
            <Kpi
    label="Active Clinical Agents"
    title="期間內有呼叫的 Agent"
    icon="smart_toy"
    value={fmtInt(summary.active_agents)}
    unit="個智能體"
    foot={<span className="inline-flex items-center gap-1 text-primary"><Icon name="check_circle" className="text-[14px]" />全院共 {summary.total_agents} 個 Agent</span>}
  >
              <Row k="已發布上線" v={`${summary.published_agents} \u500B`} /><Row k="草稿 / 沙盒" v={`${summary.total_agents - summary.published_agents} \u500B`} />
            </Kpi>
          </section>

          <section className="card mt-3 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="section-title"><Icon name="stacked_bar_chart" className="text-primary" />每日 Token 消耗與推論費用趨勢 (Daily Token &amp; Cost Trend)</h2>
                <p className="mt-1 text-xs text-on-surface-variant">{summary.range_from} ～ {summary.range_to}：依實際服務模型堆疊的 Token 用量，滑鼠移至長條查看當日費用 (USD)</p></div>
            </div>
            {summary.requests === 0 ? <div className="mt-4"><Empty icon="stacked_bar_chart" title="此期間尚無模型呼叫" hint="在沙盒或已發布的 Agent 對話後，資料會立即出現在這裡。" /></div> : <div className="mt-4 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid vertical={false} stroke="#eef2f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "#74747e" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => fmtTokens(v)} tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "#74747e" }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip cursor={{ fill: "#f7faf9" }} content={<ChartTip />} />
                    <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 11, fontFamily: "JetBrains Mono" }} />
                    {summary.models.map((m, i) => <Bar key={m} dataKey={m} stackId="t" isAnimationActive={false} fill={SERIES[i % SERIES.length]} radius={i === summary.models.length - 1 ? [3, 3, 0, 0] : 0} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>}
          </section>

          <UsageRanking kind="users" query={query} />
          <UsageRanking kind="groups" query={query} />

          <section className="card mt-3 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
              <h2 className="section-title"><Icon name="smart_toy" className="text-primary" />Agent 用量排行榜 <span className="chip">{shown.length}</span></h2>
              <div className="flex flex-wrap gap-0.5 rounded-[10px] bg-surface-container p-[3px]">
                {SORTS.map((s) => <button key={s.id} onClick={() => setSort(s.id)} className={`rounded-lg px-3 py-1 text-xs transition-colors ${sort === s.id ? "bg-white font-medium text-primary shadow-card" : "text-on-surface-variant hover:text-on-surface"}`}>{s.label}</button>)}
              </div>
            </div>
            <div className="relative mx-5 mt-3">
              <Icon name="search" className="absolute left-3 top-2 text-[20px] text-outline" />
              <input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋 Agent 名稱、建立者、所屬科別或服務模型…" />
            </div>
            {rows === null ? <div className="grid place-items-center py-16"><Spinner /></div> : shown.length === 0 ? <div className="py-6"><Empty icon="smart_toy" title="沒有符合條件的 Agent" /></div> : <table className="mt-4 w-full text-sm">
                <thead className="bg-surface-container-low text-xs text-outline-variant">
                  <tr><Th>排名</Th><Th>Agent 資訊 / 科別</Th><Th>建立者</Th><Th>主要模型</Th><Th right>請求次數</Th><Th right>Token 用量</Th><Th right>累積花費 (USD)</Th><Th right>平均響應</Th><Th right>失敗 / 降級</Th><Th>操作</Th></tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
    const rank = (page - 1) * PAGE + i + 1;
    const maxReq = rows[0]?.requests || 1;
    return <tr key={r.agent_id} className="border-t border-surface-container-high align-middle">
                        <td className="px-4 py-2"><span className={`pill ${rank <= 3 ? "bg-primary-tint text-primary" : "bg-surface-container-low text-on-surface-variant"}`}>#{rank}</span></td>
                        <td className="px-4 py-2"><p className="font-semibold">{r.name}</p><p className="mt-0.5 text-xs text-on-surface-variant">{r.department || "\u672A\u6307\u5B9A\u79D1\u5225"}{r.status && r.status !== "published" && <span className="ml-1 font-mono text-[10px] text-outline">· {r.status === "deleted" ? "\u5DF2\u522A\u9664" : "\u8349\u7A3F"}</span>}</p></td>
                        <td className="px-4 py-3 text-xs text-on-surface-variant">{r.owner_email || "\u2014"}</td>
                        <td className="px-4 py-2"><span className="chip">{r.main_model || "\u2014"}</span>{r.main_group && <p className="mt-1 font-mono text-[10px] text-outline">group: {r.main_group}</p>}</td>
                        <td className="px-4 py-3 text-right"><p className="font-mono text-sm font-semibold">{fmtInt(r.requests)} 次</p><div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-surface-container-high"><div className="h-full bg-primary" style={{ width: `${Math.min(100, r.requests / maxReq * 100)}%` }} /></div></td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{fmtTokens(r.tokens)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-primary-dark">{fmtUsd(r.cost_usd)}<p className="font-mono text-[10px] font-normal text-outline">{r.requests ? `${fmtUsd(r.cost_usd / r.requests, 4)} / \u6B21` : ""}</p></td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{fmtInt(r.avg_latency_ms)} ms</td>
                        <td className="px-4 py-3 text-right font-mono text-sm"><span className={r.failed ? "text-error" : ""}>{r.failed}</span> / <span className={r.fallbacks ? "text-warning" : ""}>{r.fallbacks}</span></td>
                        <td className="px-4 py-2"><div className="flex gap-1">
                          <button className="btn-ghost px-2" title="在沙盒開啟" onClick={() => nav(`/sandbox/${r.agent_id}`)} disabled={r.status === "deleted"}><Icon name="query_stats" className="text-[18px]" /></button>
                          <button className="btn-ghost px-2" title="在 Studio 開啟" onClick={() => nav(`/studio/${r.agent_id}`)} disabled={r.status === "deleted"}><Icon name="tune" className="text-[18px]" /></button>
                        </div></td>
                      </tr>;
  })}
                </tbody>
              </table>}
            {shown.length > PAGE && <div className="flex items-center justify-between border-t border-hairline px-6 py-3 text-xs text-on-surface-variant">
                <span>顯示第 {(page - 1) * PAGE + 1} 至 {Math.min(page * PAGE, shown.length)} 項，共 {shown.length} 個 Agent</span>
                <div className="flex items-center gap-1">
                  <button className="btn-soft py-1" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>上一頁</button>
                  <span className="px-2 font-mono">{page} / {pages}</span>
                  <button className="btn-soft py-1" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>下一頁</button>
                </div>
              </div>}
          </section>
        </>}
      </>}
    </div>;
}

/* 使用者用量排行榜 / 群組使用量排行榜: who, and which group, used the models in the selected window (same filters). */
function UsageRanking({ kind, query }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!api.monitoringUsers) { setRows([]); return; }
    let live = true;
    setRows(null);
    setErr("");
    (kind === "users" ? api.monitoringUsers(query) : api.monitoringGroups(query))
      .then((r) => live && setRows(r || [])).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [kind, query]);
  const max = Math.max(0.0001, ...(rows || []).map((r) => r.cost_usd));
  const title = kind === "users" ? "使用者用量排行榜" : "群組使用量排行榜";
  return <section className="card mt-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <h2 className="section-title"><Icon name={kind === "users" ? "person" : "group"} className="text-primary" />{title} {rows && <span className="chip">{rows.length}</span>}</h2>
      </div>
      <ErrorBox msg={err} />
      {rows === null ? <div className="grid place-items-center py-10"><Spinner /></div> : !rows.length ? <Empty icon={kind === "users" ? "person" : "group"} title="這段期間沒有用量" hint="調整日期範圍、環境或篩選後再試" /> :
      <div className="max-h-[440px] overflow-auto"><table className="w-full">
        <thead className="sticky top-0 bg-surface-container-low text-on-surface-variant"><tr>
          <Th>#</Th><Th>{kind === "users" ? "使用者" : "群組"}</Th><Th right>呼叫次數</Th><Th right>Tokens</Th><Th right>費用</Th><Th>主要模型</Th><Th>占比</Th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id} className="border-t border-hairline">
          <td className="px-4 py-2.5 font-mono text-on-surface-variant">{i + 1}</td>
          <td className="px-4 py-2.5"><p className="font-semibold">{r.name || r.email || r.id}</p><p className="text-on-surface-variant mon-sub">{kind === "users" ? r.email : `${r.members} 位成員`}</p></td>
          <td className="px-4 py-2.5 text-right font-mono">{fmtInt(r.requests)}{r.failed > 0 && <span className="ml-1 text-error mon-sub">({r.failed} 失敗)</span>}</td>
          <td className="px-4 py-2.5 text-right font-mono">{fmtTokens(r.tokens)}</td>
          <td className="px-4 py-2.5 text-right font-mono font-semibold text-primary-dark">{fmtUsd(r.cost_usd, 4)}</td>
          <td className="px-4 py-2.5">{r.main_model || "—"}</td>
          <td className="px-4 py-2.5"><div className="h-2.5 w-32 overflow-hidden rounded-full bg-surface-container-high"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, r.cost_usd / max * 100)}%` }} /></div></td>
        </tr>)}</tbody></table></div>}
    </section>;
}

const METRICS = [["cost_usd", "費用（USD）"], ["tokens", "Tokens"], ["requests", "呼叫次數"]];
const PERIODS = [["day", "每日"], ["month", "每月"]];
const fmtMetric = (v, m) => m === "cost_usd" ? fmtUsd(v) : m === "tokens" ? fmtTokens(v) : fmtInt(Math.round(v));
const BLANK = { scope: "group", target: "", period: "month", metric: "cost_usd", limit: "", enabled: true, note: "" };

/* 用量上限: per group or per model, daily or monthly. A used-up limit stops new model calls for it. */
function UsageLimits({ orgGroups }) {
  const [items, setItems] = useState(null);
  const [models, setModels] = useState([]);
  const [form, setForm] = useState(null); // {id?, ...fields}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const supported = !!api.listUsageLimits;
  const load = useCallback(() => {
    if (!supported) { setItems([]); return; }
    api.listUsageLimits().then((r) => setItems(r || [])).catch((e) => { setItems([]); setErr(String(e)); });
  }, [supported]);
  useEffect(load, [load]);
  useEffect(() => {
    api.modelGroups?.().then((r) => setModels([
      ...(r?.groups || []).map((g) => ({ id: g.id, name: `路由群組 · ${g.id}` })),
      ...(r?.models || []).map((m) => ({ id: m.id, name: m.name || m.id }))])).catch(() => setModels([]));
  }, []);
  const save = async () => {
    const body = { ...form, limit: Number(form.limit) };
    delete body.id;
    setBusy(true);
    setErr("");
    try {
      if (form.id) await api.updateUsageLimit(form.id, body); else await api.createUsageLimit(body);
      setForm(null);
      load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const toggle = async (l) => {
    try { await api.updateUsageLimit(l.id, { scope: l.scope, target: l.target, period: l.period, metric: l.metric, limit: l.limit, note: l.note, enabled: !l.enabled }); load(); }
    catch (e) { setErr(String(e)); }
  };
  const remove = async (l) => {
    if (!window.confirm(`刪除「${l.target_label}」的用量上限？`)) return;
    try { await api.deleteUsageLimit(l.id); load(); } catch (e) { setErr(String(e)); }
  };
  const targets = form?.scope === "group" ? (orgGroups || []).map((g) => ({ id: g.id, name: g.name })) : models;
  const valid = form && form.target && Number(form.limit) > 0;
  return <section className="card mt-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <div><h2 className="section-title"><Icon name="speed" className="text-primary" />用量上限</h2>
          <p className="mt-0.5 text-xs text-on-surface-variant">超過上限後，該群組成員或該模型的新呼叫會被拒絕，直到下一個期間或調高上限。</p></div>
        {supported && <button className="btn-primary" onClick={() => setForm({ ...BLANK })}><Icon name="add" className="text-[18px]" />新增上限</button>}
      </div>
      <ErrorBox msg={err} />
      {form && <div className="grid gap-3 border-b border-hairline bg-primary-tint/40 px-5 py-4 md:grid-cols-6">
        <label className="text-xs font-semibold md:col-span-1">對象
          <select className="mt-1 w-full" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, target: "" })}><option value="group">群組</option><option value="model">模型</option></select></label>
        <label className="text-xs font-semibold md:col-span-2">{form.scope === "group" ? "群組" : "模型"}
          <select className="mt-1 w-full" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
            <option value="">選擇…</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {form.target && !targets.some((t) => t.id === form.target) && <option value={form.target}>{form.target}</option>}</select></label>
        <label className="text-xs font-semibold">期間
          <select className="mt-1 w-full" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-xs font-semibold">指標
          <select className="mt-1 w-full" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>{METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-xs font-semibold">上限
          <input className="mt-1 w-full" type="number" min="0" step={form.metric === "cost_usd" ? "0.01" : "1"} value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} placeholder={form.metric === "cost_usd" ? "例如 50" : "例如 100000"} /></label>
        <label className="text-xs font-semibold md:col-span-4">備註
          <input className="mt-1 w-full" maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例如：試辦期間每月預算" /></label>
        <div className="flex items-end justify-end gap-2 md:col-span-2">
          <button className="btn-soft" onClick={() => setForm(null)}>取消</button>
          <button className="btn-primary" disabled={!valid || busy} onClick={save}>{busy ? <Spinner /> : null}{form.id ? "儲存" : "新增"}</button></div>
      </div>}
      {items === null ? <div className="grid place-items-center py-8"><Spinner /></div> : !items.length ? <Empty icon="speed" title={supported ? "尚未設定用量上限" : "預覽模式不支援用量上限"} hint={supported ? "可依群組或模型設定每日或每月的費用、Tokens 或呼叫次數上限" : ""} /> :
      <div className="divide-y divide-hairline">{items.map((l) => {
        const pct = Math.min(100, l.pct || 0), tone = l.exceeded ? "bg-error" : pct >= 85 ? "bg-warning" : "bg-primary";
        return <div key={l.id} className={`flex flex-wrap items-center gap-4 px-5 py-3 ${l.enabled ? "" : "opacity-60"}`}>
          <div className="min-w-[200px] flex-1">
            <p className="font-semibold">{l.scope === "group" ? "群組" : "模型"} · {l.target_label}{l.exceeded && l.enabled && <span className="ml-2 rounded-full bg-error/10 px-2 py-0.5 text-xs font-semibold text-error">已達上限</span>}{!l.enabled && <span className="ml-2 chip">已停用</span>}</p>
            <p className="text-xs text-on-surface-variant">{PERIODS.find(([k]) => k === l.period)?.[1]} · {METRICS.find(([k]) => k === l.metric)?.[1]}{l.note ? ` · ${l.note}` : ""}</p>
          </div>
          <div className="w-64">
            <div className="flex justify-between text-xs"><span className="font-mono">{fmtMetric(l.used, l.metric)} / {fmtMetric(l.limit, l.metric)}</span><span className={`font-semibold ${l.exceeded ? "text-error" : "text-primary-dark"}`}>{(l.pct || 0).toFixed(0)}%</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-container-high"><div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn-ghost" onClick={() => toggle(l)}>{l.enabled ? "停用" : "啟用"}</button>
            <button className="btn-ghost" onClick={() => setForm({ id: l.id, scope: l.scope, target: l.target, period: l.period, metric: l.metric, limit: String(l.limit), enabled: l.enabled, note: l.note || "" })}>編輯</button>
            <button className="btn-ghost text-error" onClick={() => remove(l)}>刪除</button>
          </div>
        </div>;
      })}</div>}
    </section>;
}
const Th = ({ children, right = false }) => <th className={`px-4 py-2 ${right ? "text-right" : "text-left"}`}>{children}</th>;
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return <div className="rounded-lg border border-hairline bg-white px-3 py-2 text-xs shadow-float">
      <p className="font-semibold">{label}</p>
      <p className="font-mono text-[11px] text-on-surface-variant">{fmtInt(payload[0].payload.requests)} 次呼叫 · {fmtTokens(total)} tokens · <b className="text-primary-dark">{fmtUsd(payload[0].payload.cost)}</b></p>
      <div className="mt-1 space-y-0.5">{[...payload].reverse().map((p) => <p key={p.name} className="flex items-center gap-1.5 font-mono text-[11px]"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.name}<span className="ml-auto pl-3">{fmtTokens(p.value || 0)}</span></p>)}</div>
    </div>;
}
export {
  Monitoring as default,
  fmtTokens
};
