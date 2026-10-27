import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { DEPARTMENTS, type AgentUsageRow, type MonitoringQuery, type MonitoringSummary, type UsageSort } from "../types";
import { Empty, ErrorBox, Icon, Spinner } from "../components/ui";
import { Delta, Kpi, Row } from "../components/Kpi";

type Range = "today" | "7d" | "month" | "custom";
const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "今日 (Today)" }, { id: "7d", label: "近 7 天 (Last 7 Days)" }, { id: "month", label: "本月 (This Month)" }, { id: "custom", label: "自訂區間" },
];
const SORTS: { id: UsageSort; label: string }[] = [
  { id: "requests", label: "總呼叫量 (Most Calls)" }, { id: "tokens", label: "Token 消耗 (Tokens)" }, { id: "cost_usd", label: "累積花費 (Cost)" },
  { id: "cost_per_call", label: "性價比最高 (Cost / Call)" }, { id: "fallbacks", label: "降級最多 (Fallbacks)" },
];
// Jade ramp from the design tokens; one colour per served model, in legend order.
const SERIES = ["#00655b", "#79d7c8", "#3e605a", "#a2f2e1", "#0e8074", "#bdc9c6"];
const PAGE = 10;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (d: Date, days: number) => { const x = new Date(d); x.setDate(x.getDate() + days); return x; };
const rangeDates = (r: Range): { from: string; to: string } => {
  const now = new Date();
  if (r === "today") return { from: ymd(now), to: ymd(now) };
  if (r === "month") return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
  return { from: ymd(shift(now, -6)), to: ymd(now) };
};
export const fmtTokens = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n));
const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtUsd = (n: number, digits = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const fmtDay = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()} ${["日", "一", "二", "三", "四", "五", "六"][d.getDay()]}`; };

export default function Monitoring() {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>("7d");
  const [custom, setCustom] = useState(rangeDates("7d"));
  const [department, setDepartment] = useState("");
  const [sort, setSort] = useState<UsageSort>("requests");
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [rows, setRows] = useState<AgentUsageRow[] | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const query: MonitoringQuery = useMemo(() => ({ ...(range === "custom" ? custom : rangeDates(range)), department }), [range, custom, department]);

  const load = useCallback(() => {
    setBusy(true); setErr("");
    Promise.all([api.monitoringSummary(query), api.monitoringAgents(query, sort)])
      .then(([s, r]) => { setSummary(s); setRows(r); })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  }, [query, sort]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [query, sort, q]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.monitoringCsv(query);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `tcvgh-agent-cost_${query.from}_${query.to}.csv` });
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setErr(String(e)); } finally { setExporting(false); }
  };

  const chart = useMemo(() => (summary?.daily ?? []).map((d) => ({
    date: fmtDay(d.date), cost: d.cost_usd, requests: d.requests,
    ...Object.fromEntries(d.by_model.map((m) => [m.model, m.tokens])),
  })), [summary]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter((r) => !needle || [r.name, r.owner_email, r.department, r.main_model, r.agent_id].some((s) => s?.toLowerCase().includes(needle))), [rows, needle]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);

  const tokens = (summary?.prompt_tokens ?? 0) + (summary?.completion_tokens ?? 0);
  const budgetPct = summary && summary.monthly_budget_usd > 0 ? (summary.month_cost_usd / summary.monthly_budget_usd) * 100 : 0;
  const budgetTone = budgetPct >= 100 ? "error" : budgetPct >= 85 ? "warning" : "primary";
  const successPct = summary && summary.requests > 0 ? ((summary.requests - summary.failed) / summary.requests) * 100 : null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <section className="card flex flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">Agent 監控與模型成本儀表板 <span className="chip">GCP Vertex AI · LiteLLM</span></h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant">
            全院自建 Agent 的推論呼叫、Token 消耗、模型成本與月度預算總覽。資料來自平台後端的每次模型呼叫紀錄（不含對話內容），成本依院內價格表估算。
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button className="btn-primary" onClick={exportCsv} disabled={exporting || !summary}>{exporting ? <Spinner className="h-4 w-4" /> : <Icon name="download" className="text-[18px]" />}匯出成本報表 (CSV)</button>
          <button className="btn-secondary" onClick={load} disabled={busy}><Icon name="refresh" className={`text-[18px] ${busy ? "animate-spin" : ""}`} />重新整理</button>
        </div>
      </section>

      <section className="card mt-4 flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-container-low p-1">
          {RANGES.map((r) => <button key={r.id} onClick={() => setRange(r.id)} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${range === r.id ? "bg-primary-dark text-white" : "text-on-surface-variant hover:bg-surface-container-high"}`}>{r.label}</button>)}
          {range === "custom" && (
            <span className="ml-1 flex items-center gap-1 font-mono text-xs">
              <input type="date" className="w-auto py-1 text-xs" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <span className="text-outline">→</span>
              <input type="date" className="w-auto py-1 text-xs" value={custom.to} min={custom.from} max={ymd(new Date())} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </span>
          )}
        </div>
        <span className="hidden flex-1 md:block" />
        <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">臨床部門過濾：
          <button onClick={() => setDepartment("")} className={`pill px-3 py-1 ${!department ? "bg-primary-dark text-white" : "bg-surface-container-low hover:bg-surface-container-high"}`}>全部科別 (全院)</button>
          <select className="w-auto py-1 text-xs" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">選擇科別…</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {department && <span className="chip">{department}<button className="ml-1" onClick={() => setDepartment("")}><Icon name="close" className="text-[12px]" /></button></span>}
        </div>
      </section>

      <ErrorBox msg={err} />

      {summary === null && !err ? <div className="grid place-items-center py-20"><Spinner /></div> : summary && (
        <>
          <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Total Tokens Used" title="總 Token 消耗量" icon="toll" value={fmtTokens(tokens).split(" ")[0]} unit={`${fmtTokens(tokens).split(" ")[1] ?? ""} Tokens`}
              foot={<><Delta pct={summary.tokens_delta_pct} /><span className="text-outline"> vs 上一期間</span></>}>
              <Row k="輸入 Prompt" v={fmtTokens(summary.prompt_tokens)} /><Row k="輸出 Completion" v={fmtTokens(summary.completion_tokens)} />
            </Kpi>
            <Kpi label="Inference Invocations" title="總請求次數 (Inferences)" icon="model_training" value={fmtInt(summary.requests)} unit="次呼叫"
              foot={<><Delta pct={summary.requests_delta_pct} /><span className="text-outline"> vs 上一期間</span></>}>
              <Row k="平均延遲時間" v={`${fmtInt(summary.avg_latency_ms)} ms`} />
              <Row k="成功率" v={successPct == null ? "—" : `${successPct.toFixed(2)}%（失敗 ${fmtInt(summary.failed)}）`} />
              <Row k="模型降級 (fallback)" v={fmtInt(summary.fallbacks)} tone={summary.fallbacks > 0 ? "warning" : undefined} />
            </Kpi>
            <Kpi label="Total Model Cost" title="累積總成本 (Cost)" icon="attach_money" value={fmtUsd(summary.cost_usd)} unit="USD"
              foot={<><span className="text-outline">約合 NT$ {fmtInt(Math.round(summary.cost_usd * summary.usd_twd_rate))}</span><span className="text-outline"> · 均次呼叫 {summary.requests ? fmtUsd(summary.cost_usd / summary.requests, 4) : "—"}</span></>}>
              <div className="flex items-center justify-between text-[11px]"><span className="text-on-surface-variant">月度預算上限 ({fmtUsd(summary.monthly_budget_usd, 0)} USD)</span>
                <span className={`font-mono font-semibold ${budgetTone === "error" ? "text-error" : budgetTone === "warning" ? "text-warning" : "text-primary"}`}>{budgetPct.toFixed(1)}%（{budgetTone === "error" ? "超支" : budgetTone === "warning" ? "警戒" : "安全"}）</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-container-high"><div className={`h-full rounded-full ${budgetTone === "error" ? "bg-error" : budgetTone === "warning" ? "bg-warning" : "bg-primary"}`} style={{ width: `${Math.min(100, budgetPct)}%` }} /></div>
              <p className="mt-1 font-mono text-[10px] text-outline">本月累計 {fmtUsd(summary.month_cost_usd)}（全院，不受上方篩選影響）</p>
            </Kpi>
            <Kpi label="Active Clinical Agents" title="期間內有呼叫的 Agent" icon="smart_toy" value={fmtInt(summary.active_agents)} unit="個智能體"
              foot={<span className="inline-flex items-center gap-1 text-primary"><Icon name="check_circle" className="text-[14px]" />全院共 {summary.total_agents} 個 Agent</span>}>
              <Row k="已發布上線" v={`${summary.published_agents} 個`} /><Row k="草稿 / 沙盒" v={`${summary.total_agents - summary.published_agents} 個`} />
            </Kpi>
          </section>

          <section className="card mt-5 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="section-title"><Icon name="stacked_bar_chart" className="text-primary" />每日 Token 消耗與推論費用趨勢 (Daily Token &amp; Cost Trend)</h2>
                <p className="mt-1 text-xs text-on-surface-variant">{summary.range_from} ～ {summary.range_to}：依實際服務模型堆疊的 Token 用量，滑鼠移至長條查看當日費用 (USD)</p></div>
            </div>
            {summary.requests === 0 ? <div className="mt-4"><Empty icon="stacked_bar_chart" title="此期間尚無模型呼叫" hint="在沙盒或已發布的 Agent 對話後，資料會立即出現在這裡。" /></div> : (
              <div className="mt-4 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid vertical={false} stroke="#e8efef" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "#6e7977" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => fmtTokens(v)} tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "#6e7977" }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip cursor={{ fill: "#f2f7f6" }} content={<ChartTip />} />
                    <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 11, fontFamily: "JetBrains Mono" }} />
                    {summary.models.map((m, i) => <Bar key={m} dataKey={m} stackId="t" isAnimationActive={false} fill={SERIES[i % SERIES.length]} radius={i === summary.models.length - 1 ? [3, 3, 0, 0] : 0} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="card mt-5 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
              <h2 className="section-title">全院自建 Agent 用量排行榜 <span className="chip">{shown.length} Agents</span></h2>
              <div className="flex flex-wrap gap-1 rounded-lg bg-surface-container-low p-1">
                {SORTS.map((s) => <button key={s.id} onClick={() => setSort(s.id)} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${sort === s.id ? "bg-white text-primary shadow-card" : "text-on-surface-variant hover:bg-surface-container-high"}`}>{s.label}</button>)}
              </div>
            </div>
            <div className="relative mx-6 mt-3">
              <Icon name="search" className="absolute left-3 top-2 text-[20px] text-outline" />
              <input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋 Agent 名稱、建立者、所屬科別或服務模型…" />
            </div>
            {rows === null ? <div className="grid place-items-center py-16"><Spinner /></div> : shown.length === 0 ? <div className="py-6"><Empty icon="smart_toy" title="沒有符合條件的 Agent" /></div> : (
              <table className="mt-4 w-full text-sm">
                <thead className="bg-surface-container-low font-mono text-[10px] uppercase tracking-wider text-outline">
                  <tr><Th>排名</Th><Th>Agent 資訊 / 科別</Th><Th>建立者</Th><Th>主要模型</Th><Th right>請求次數</Th><Th right>Token 用量</Th><Th right>累積花費 (USD)</Th><Th right>平均響應</Th><Th right>失敗 / 降級</Th><Th>操作</Th></tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const rank = (page - 1) * PAGE + i + 1;
                    const maxReq = rows[0]?.requests || 1;
                    return (
                      <tr key={r.agent_id} className="border-t border-hairline align-middle hover:bg-primary-tint/40">
                        <td className="px-4 py-3"><span className={`pill ${rank <= 3 ? "bg-primary-tint text-primary" : "bg-surface-container-low text-on-surface-variant"}`}>#{rank}</span></td>
                        <td className="px-4 py-3"><p className="font-semibold">{r.name}</p><p className="mt-0.5 text-xs text-on-surface-variant">{r.department || "未指定科別"}{r.status && r.status !== "published" && <span className="ml-1 font-mono text-[10px] text-outline">· {r.status === "deleted" ? "已刪除" : "草稿"}</span>}</p></td>
                        <td className="px-4 py-3 text-xs text-on-surface-variant">{r.owner_email || "—"}</td>
                        <td className="px-4 py-3"><span className="chip">{r.main_model || "—"}</span>{r.main_group && <p className="mt-1 font-mono text-[10px] text-outline">group: {r.main_group}</p>}</td>
                        <td className="px-4 py-3 text-right"><p className="font-mono text-sm font-semibold">{fmtInt(r.requests)} 次</p><div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-surface-container-high"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (r.requests / maxReq) * 100)}%` }} /></div></td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{fmtTokens(r.tokens)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-primary-dark">{fmtUsd(r.cost_usd)}<p className="font-mono text-[10px] font-normal text-outline">{r.requests ? `${fmtUsd(r.cost_usd / r.requests, 4)} / 次` : ""}</p></td>
                        <td className="px-4 py-3 text-right font-mono text-sm">{fmtInt(r.avg_latency_ms)} ms</td>
                        <td className="px-4 py-3 text-right font-mono text-sm"><span className={r.failed ? "text-error" : ""}>{r.failed}</span> / <span className={r.fallbacks ? "text-warning" : ""}>{r.fallbacks}</span></td>
                        <td className="px-4 py-3"><div className="flex gap-1">
                          <button className="btn-ghost px-2" title="在沙盒開啟" onClick={() => nav(`/sandbox/${r.agent_id}`)} disabled={r.status === "deleted"}><Icon name="query_stats" className="text-[18px]" /></button>
                          <button className="btn-ghost px-2" title="在 Studio 開啟" onClick={() => nav(`/studio/${r.agent_id}`)} disabled={r.status === "deleted"}><Icon name="tune" className="text-[18px]" /></button>
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {shown.length > PAGE && (
              <div className="flex items-center justify-between border-t border-hairline px-6 py-3 text-xs text-on-surface-variant">
                <span>顯示第 {(page - 1) * PAGE + 1} 至 {Math.min(page * PAGE, shown.length)} 項，共 {shown.length} 個 Agent</span>
                <div className="flex items-center gap-1">
                  <button className="btn-soft py-1" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>上一頁</button>
                  <span className="px-2 font-mono">{page} / {pages}</span>
                  <button className="btn-soft py-1" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>下一頁</button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const Th = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => <th className={`px-4 py-2 ${right ? "text-right" : "text-left"}`}>{children}</th>;

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string; payload: { cost: number; requests: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border border-hairline bg-white px-3 py-2 text-xs shadow-float">
      <p className="font-semibold">{label}</p>
      <p className="font-mono text-[11px] text-on-surface-variant">{fmtInt(payload[0].payload.requests)} 次呼叫 · {fmtTokens(total)} tokens · <b className="text-primary-dark">{fmtUsd(payload[0].payload.cost)}</b></p>
      <div className="mt-1 space-y-0.5">{[...payload].reverse().map((p) => <p key={p.name} className="flex items-center gap-1.5 font-mono text-[11px]"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.name}<span className="ml-auto pl-3">{fmtTokens(p.value || 0)}</span></p>)}</div>
    </div>
  );
}
