import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ConnectorOut, ConnectorStats, ConnectorType, ConnectorTypes } from "../types";
import { ErrorBox, Icon, Spinner, fmtTime } from "../components/ui";

export const statusPill = (s: ConnectorOut["status"] | "available" | "coming") =>
  s === "active" ? <span className="pill bg-primary-tint text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />已連線 (Active)</span>
  : s === "error" ? <span className="pill bg-error-container text-on-error-container"><span className="h-1.5 w-1.5 rounded-full bg-error" />連線失敗</span>
  : s === "coming" ? <span className="pill bg-surface-container-high text-on-surface-variant"><span className="h-1.5 w-1.5 rounded-full bg-outline" />下一階段</span>
  : <span className="pill bg-surface-container-high text-on-surface-variant"><span className="h-1.5 w-1.5 rounded-full bg-outline" />待設定 (Not Connected)</span>;

/** Catalog = configured connectors (real objects) + available types not yet configured (templates). */
export default function Connectors() {
  const nav = useNavigate();
  const [types, setTypes] = useState<ConnectorTypes | null>(null);
  const [items, setItems] = useState<ConnectorOut[] | null>(null);
  const [stats, setStats] = useState<ConnectorStats | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [err, setErr] = useState("");

  const load = () => {
    api.connectorTypes().then(setTypes).catch((e) => setErr(String(e)));
    api.listConnectors().then(setItems).catch((e) => setErr(String(e)));
    api.connectorStats().then(setStats).catch(() => undefined);
  };
  useEffect(load, []);

  const typeOf = (id: string) => types?.types.find((t) => t.id === id);
  type Card = { kind: "connector"; c: ConnectorOut; t: ConnectorType } | { kind: "template"; t: ConnectorType };
  const cards = useMemo<Card[]>(() => {
    if (!types || !items) return [];
    const configured = new Set(items.map((c) => c.type));
    const list: Card[] = [
      ...items.flatMap((c) => { const t = typeOf(c.type); return t ? [{ kind: "connector" as const, c, t }] : []; }),
      ...types.types.filter((t) => !configured.has(t.id) || t.id === "mcp" || t.id === "webhook").map((t) => ({ kind: "template" as const, t })),
    ];
    const needle = q.toLowerCase();
    return list.filter((x) => (cat === "all" || x.t.category === cat))
      .filter((x) => !onlyConnected || (x.kind === "connector" && x.c.status === "active"))
      .filter((x) => !needle || [x.t.label, x.t.protocol, x.t.description, x.kind === "connector" ? x.c.label : ""].some((s) => s.toLowerCase().includes(needle)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types, items, q, cat, onlyConnected]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: 0 };
    for (const x of cards) { m.all++; m[x.t.category] = (m[x.t.category] ?? 0) + 1; }
    return m;
  }, [cards]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-bold"><span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name="cable" /></span>Connectors 連接器中心</h1>
        <div className="flex gap-2">
          <button className="btn-soft" onClick={load}><Icon name="network_check" className="text-[18px]" />重新整理狀態</button>
          <button className="btn-primary" onClick={() => nav("/connectors/new?type=mcp")}><Icon name="add" className="text-[18px]" />+ 自訂 MCP / REST 連接器</button>
        </div>
      </div>

      <section className="mt-5 grid gap-4 md:grid-cols-4">
        {[
          { label: "已連線服務 (CONNECTED)", value: stats?.connected, unit: "個活躍連接器", sub: "最近一次測試成功", icon: "check_circle" },
          { label: "可供串接 (AVAILABLE)", value: stats?.available_types, unit: "種協定", sub: "MCP / REST / Slack / Teams / Notion", icon: "apps" },
          { label: "今日 API 安全轉發", value: stats?.invocations_today, unit: "次", sub: "工具節點呼叫（含失敗）", icon: "verified_user" },
          { label: "MCP 遠端伺服器 (REMOTE)", value: stats?.mcp_nodes, unit: "組健康節點", sub: "Streamable HTTP", icon: "dns" },
        ].map((s) => (
          <div key={s.label} className="card px-5 py-4">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-outline"><span>{s.label}</span><Icon name={s.icon} className="text-[18px] text-primary" /></div>
            <p className="mt-1 text-3xl font-bold">{s.value ?? "—"} <span className="text-sm font-medium text-on-surface-variant">{s.unit}</span></p>
            <p className="text-xs text-on-surface-variant">{s.sub}</p>
          </div>
        ))}
      </section>

      <section className="card mt-5 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[280px] flex-1"><Icon name="search" className="absolute left-3 top-2.5 text-[20px] text-outline" />
            <input className="pl-10 py-2.5" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋連接器名稱、協定或應用服務（例如：Gmail, Slack, HIS Webhook, FHIR, Notion…）" /></div>
          <div className="flex rounded-lg border border-hairline p-0.5 text-xs">
            <button className={`rounded px-3 py-1.5 font-semibold ${!onlyConnected ? "bg-primary-dark text-white" : ""}`} onClick={() => setOnlyConnected(false)}>全部狀態</button>
            <button className={`rounded px-3 py-1.5 font-semibold ${onlyConnected ? "bg-primary-dark text-white" : ""}`} onClick={() => setOnlyConnected(true)}>僅顯示已連線</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[{ id: "all", label: "全部" }, ...(types?.categories ?? [])].map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={`pill px-3 py-1 text-xs ${cat === c.id ? "bg-primary-dark text-white" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"}`}>{c.label} <span className="opacity-70">{counts[c.id] ?? 0}</span></button>
          ))}
        </div>
      </section>

      <section className="mt-5 flex items-center gap-4 rounded-xl bg-primary-tint px-5 py-4">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary-dark text-white"><Icon name="hub" /></span>
        <div className="flex-1 text-sm"><p className="font-bold">支援 Anthropic / Google 官方開放標準 Model Context Protocol (MCP) <span className="chip ml-1">Streamable HTTP</span></p>
          <p className="text-on-surface-variant">Agent 工具節點可直接呼叫遠端 MCP 伺服器註冊的工具 (Tools)；連線測試成功後工具清單會自動出現在 Studio 的節點設定中。</p></div>
      </section>

      <ErrorBox msg={err} />
      {!types || !items ? <div className="grid place-items-center py-20"><Spinner /></div> : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((x, i) => {
            const t = x.t;
            const c = x.kind === "connector" ? x.c : null;
            return (
              <article key={c ? c.id : `tpl-${t.id}-${i}`} className={`card flex flex-col transition-shadow hover:shadow-float ${!t.available ? "opacity-80" : ""}`}>
                <div className="flex items-start justify-between px-4 pt-4">
                  <span className="grid h-12 w-12 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={t.icon} className="text-[26px]" /></span>
                  <div className="flex flex-col items-end gap-1"><span className="chip">{t.badge}</span>{c ? statusPill(c.status) : statusPill(t.available ? "unverified" : "coming")}</div>
                </div>
                <div className="flex-1 px-4 py-3">
                  <h3 className="text-lg font-bold leading-snug">{c ? c.label : t.label}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-on-surface-variant">{c?.scope || t.description}</p>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface-container-low px-3 py-2 font-mono text-[11px]">
                    <dt className="text-outline">通訊協定</dt><dd className="truncate text-right">{t.protocol}</dd>
                    {c && typeof c.config.url === "string" && <><dt className="text-outline">端點</dt><dd className="truncate text-right" title={String(c.config.url)}>{String(c.config.url).replace(/^https?:\/\//, "")}</dd></>}
                    {c?.last_test?.tools && <><dt className="text-outline">註冊工具</dt><dd className="text-right">{c.last_test.tools.length} Tools</dd></>}
                    {c?.last_test && <><dt className="text-outline">最近測試</dt><dd className="text-right">{c.last_test.ms} ms · {fmtTime(c.last_test.at)}</dd></>}
                  </dl>
                </div>
                <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-xs text-on-surface-variant">
                  <span>{c ? `已授權至 ${c.agents_count} 個 Agent` : t.available ? "尚未設定" : "規劃中"}</span>
                  {c ? <button className="btn-soft" onClick={() => nav(`/connectors/${c.id}`)}>管理設定 <Icon name="tune" className="text-[16px]" /></button>
                    : <button className={t.available ? "btn-primary" : "btn-soft"} onClick={() => nav(`/connectors/new?type=${t.id}`)}>{t.available ? "立即連線設定" : "預先設定"} <Icon name="link" className="text-[16px]" /></button>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {items && items.length > 0 && (
        <section className="card mt-6 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3"><p className="section-title text-base"><Icon name="verified_user" className="text-primary" />院內認證與合規轉發閘道狀態 (Gateway Audit)</p><span className="mono">Secret Manager · PII 去識別化</span></div>
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low font-mono text-[10px] uppercase tracking-wider text-outline"><tr><th className="px-5 py-2 text-left">服務節點 / 連接器</th><th className="px-5 py-2 text-left">協定架構</th><th className="px-5 py-2 text-left">認證層</th><th className="px-5 py-2 text-left">PII 去識別化</th><th className="px-5 py-2 text-left">延遲</th><th className="px-5 py-2 text-left">狀態</th></tr></thead>
            <tbody>{items.map((c) => { const t = typeOf(c.type); return (
              <tr key={c.id} className="border-t border-hairline hover:bg-primary-tint/40">
                <td className="px-5 py-2"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${c.status === "active" ? "bg-primary" : c.status === "error" ? "bg-error" : "bg-outline"}`} />{c.label}</span></td>
                <td className="px-5 py-2 font-mono text-xs">{t?.protocol}</td>
                <td className="px-5 py-2 font-mono text-xs">{c.secret_fields.length ? `${c.secret_fields.join(", ")} (Secret Manager)` : "無"}</td>
                <td className="px-5 py-2 text-xs">{c.redact_pii ? <span className="text-primary">已啟用 (Active)</span> : <span className="text-warning">未啟用</span>}</td>
                <td className="px-5 py-2 font-mono text-xs">{c.last_test ? `${c.last_test.ms} ms` : "—"}</td>
                <td className="px-5 py-2">{statusPill(c.status)}</td>
              </tr>); })}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
