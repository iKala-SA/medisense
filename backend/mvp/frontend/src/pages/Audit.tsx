import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DEPARTMENTS, ROLE_LABEL, type AuditCategory, type AuditEntry, type AuditPage, type AuditQuery, type AuditSeverity, type AuditSummary, type Role } from "../types";
import { Empty, ErrorBox, Icon, Spinner, fmtBytes } from "../components/ui";
import { Delta, Kpi, Row } from "../components/Kpi";

const PAGE = 25;

export const ACTION_LABEL: Record<string, string> = {
  "agent.create": "建立 Agent", "agent.update": "更新草稿", "agent.publish": "發布版本", "agent.unpublish": "下架", "agent.delete": "刪除 Agent",
  "agent.publish_request": "申請全院發布", "agent.publish_withdraw": "撤回發布申請", "agent.publish_approve": "核可發布", "agent.publish_reject": "退回發布申請",
  "agent.run": "推論呼叫", "agent.approve": "核准外部動作", "agent.reject": "駁回外部動作",
  "knowledge.upload": "上傳知識文件", "knowledge.delete": "移除知識文件", "knowledge.error": "知識索引失敗", "knowledge.reindex": "去識別化重建索引",
  "connector.create": "新增連接器", "connector.update": "更新連接器設定", "connector.delete": "刪除連接器", "connector.test": "連線測試", "connector.invoke": "連接器調用",
  "monitoring.export": "匯出成本報表", "audit.export": "匯出稽核報表", "users.export": "匯出帳號清冊",
  "user.first_login": "首次登入", "user.preregister": "預先登錄帳號", "user.preregister_cancel": "取消預先登錄", "user.role": "變更角色",
  "user.suspend": "暫停帳號", "user.reactivate": "恢復帳號", "user.update": "更新帳號資料",
};
const CAT: Record<AuditCategory, { label: string; icon: string; chip: string; dot: string; bar: string }> = {
  inference: { label: "Agent 推論", icon: "smart_toy", chip: "bg-primary-tint text-primary-dark", dot: "bg-primary", bar: "bg-primary" },
  connector: { label: "連接器調用", icon: "cable", chip: "bg-secondary-container/60 text-on-secondary-container", dot: "bg-secondary", bar: "bg-primary-fixed-dim" },
  build: { label: "建置與知識", icon: "construction", chip: "bg-tertiary-fixed/70 text-tertiary", dot: "bg-tertiary", bar: "bg-tertiary" },
  access: { label: "帳號、金鑰與匯出", icon: "key", chip: "bg-warning-container text-warning", dot: "bg-warning", bar: "bg-warning" },
  other: { label: "其他", icon: "more_horiz", chip: "bg-surface-container-high text-on-surface-variant", dot: "bg-outline", bar: "bg-outline-variant" },
};
const TABS: { id: string; label: string }[] = [
  { id: "", label: "全部軌跡 (All Logs)" }, { id: "inference", label: "Agent 推論 (Inference)" }, { id: "connector", label: "連接器 & MCP (Connectors)" },
  { id: "build", label: "建置與知識 (Build)" }, { id: "access", label: "帳號、金鑰與匯出 (Access & Export)" }, { id: "alerts", label: "異常警示 (Alerts)" },
];
const SEVERITIES: { id: "" | AuditSeverity; label: string }[] = [
  { id: "", label: "所有狀態" }, { id: "info", label: "一般紀錄 (Info)" }, { id: "success", label: "成功 (Success)" }, { id: "warning", label: "異常 / 失敗 (Warning)" },
];
type Range = "today" | "7d" | "30d" | "custom";
const RANGES: { id: Range; label: string }[] = [{ id: "today", label: "今日" }, { id: "7d", label: "近 7 天" }, { id: "30d", label: "近 30 天" }, { id: "custom", label: "自訂日期區間" }];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 864e5));
const rangeDates = (r: Range) => ({ from: r === "today" ? daysAgo(0) : r === "30d" ? daysAgo(29) : daysAgo(6), to: daysAgo(0) });
const fmtInt = (n: number) => n.toLocaleString("en-US");
const clock = (iso?: string | null) => {
  if (!iso) return { time: "—", day: "" };
  const d = new Date(iso);
  const time = `${d.toLocaleTimeString("zh-TW", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  return { time, day: ymd(d) === daysAgo(0) ? "今日" : `${d.getMonth() + 1}/${d.getDate()}` };
};
const str = (v: unknown) => (v == null ? "" : String(v));

/** One human sentence per event plus an optional evidence line, built only from what the audit doc holds. */
function describe(e: AuditEntry): { text: string; sub?: string; subIcon?: string; subTone?: "ok" | "warn" | "muted" } {
  const d = e.details;
  switch (e.action) {
    case "agent.run": {
      const models = Array.isArray(d.models) ? (d.models as string[]).join("、") : "";
      return { text: `執行推論${d.latency_ms != null ? ` · ${fmtInt(Number(d.latency_ms))} ms` : ""}${models ? ` · ${models}` : ""}`, sub: "使用者輸入已於進入時去識別化，對話內容不寫入稽核紀錄", subIcon: "verified_user", subTone: "ok" };
    }
    case "agent.approve": return { text: `核准流程中的外部動作（節點 ${str(d.node_id) || "—"}）`, sub: "人工核可後才繼續執行", subIcon: "how_to_reg", subTone: "ok" };
    case "agent.reject": return { text: `駁回流程中的外部動作（節點 ${str(d.node_id) || "—"}）`, sub: "流程已停止，未呼叫外部系統", subIcon: "block", subTone: "warn" };
    case "connector.invoke": {
      const ok = d.ok !== false;
      return {
        text: `${str(d.connector_action) || "呼叫"}${ok ? " · 成功" : ` · 失敗：${str(d.error) || "未知錯誤"}`}`,
        sub: d.args !== undefined ? "呼叫參數已依連接器設定留存於稽核紀錄" : "此連接器設定為不留存呼叫參數",
        subIcon: d.args !== undefined ? "receipt_long" : "visibility_off", subTone: ok ? "muted" : "warn",
      };
    }
    case "connector.test": return { text: `連線測試${d.ok === false ? "失敗" : "成功"}：${str(d.message)}`, subTone: d.ok === false ? "warn" : "ok" };
    case "connector.create": return { text: `新增連接器（${str(d.type)}）${str(d.label)}`, sub: "憑證存於 Secret Manager，不寫入稽核紀錄", subIcon: "key", subTone: "muted" };
    case "connector.update": return { text: d.credentials_changed ? "更新設定並輪替憑證" : "更新連接器設定", sub: d.credentials_changed ? "新憑證已寫入 Secret Manager" : undefined, subIcon: "key", subTone: "muted" };
    case "connector.delete": return { text: "刪除連接器與其憑證" };
    case "agent.create": return { text: `建立 Agent「${str(d.name) || e.target_label}」` };
    case "agent.update": return { text: "更新 Agent 草稿（流程、提示詞或設定）" };
    case "agent.publish": return { text: `發布為全院可用版本 v${str(d.version)}`, subTone: "ok" };
    case "agent.unpublish": return { text: "自全院下架，回到草稿狀態" };
    case "agent.publish_request": return { text: `申請將 v${str(d.version)} 發布至全院，等待管理員審核` };
    case "agent.publish_withdraw": return { text: `撤回 v${str(d.version)} 的發布申請` };
    case "agent.publish_approve": return { text: `核可 v${str(d.version)}，已成為全院可用版本`, subTone: "ok" };
    case "agent.publish_reject": return { text: `退回 v${str(d.version)} 的發布申請`, sub: str(d.reason), subIcon: "undo", subTone: "warn" };
    case "agent.delete": return { text: "刪除 Agent 及其知識文件與檢索語料庫" };
    case "knowledge.upload": return { text: `上傳「${str(d.file)}」${d.bytes ? ` · ${fmtBytes(Number(d.bytes))}` : ""}`,
      ...(d.deidentified ? { sub: "內容已去識別化後才建立索引", subIcon: "verified_user", subTone: "ok" as const } : { sub: "舊紀錄：當時未去識別化，需重建索引", subIcon: "warning", subTone: "warn" as const }) };
    case "knowledge.reindex": return { text: `「${str(d.file)}」以去識別化文字重建索引`, sub: "原檔保留於 CMEK 加密儲存桶", subIcon: "verified_user", subTone: "ok" };
    case "knowledge.delete": return { text: `移除「${str(d.file)}」` };
    case "knowledge.error": return { text: `「${str(d.file)}」索引失敗`, sub: str(d.error), subIcon: "error", subTone: "warn" };
    case "user.first_login": return { text: `首次登入平台，角色為${ROLE_LABEL[str(d.role) as Role] ?? str(d.role)}`, sub: d.preregistered ? "使用管理員預先登錄的角色" : undefined, subIcon: "how_to_reg", subTone: "muted" };
    case "user.preregister": return { text: `預先登錄 ${e.target_label}，角色為${ROLE_LABEL[str(d.role) as Role] ?? str(d.role)}` };
    case "user.preregister_cancel": return { text: `取消 ${e.target_label} 的預先登錄` };
    case "user.role": return { text: `角色：${ROLE_LABEL[str(d.old) as Role] ?? (str(d.old) || "—")} → ${ROLE_LABEL[str(d.new) as Role] ?? str(d.new)}`, sub: str(d.reason), subIcon: "edit_note", subTone: "muted" };
    case "user.suspend": return { text: "暫停帳號：無法登入與呼叫平台 API", sub: `${str(d.reason)}${d.firebase_synced === false ? "（Firebase 帳號停用失敗，僅由平台阻擋）" : ""}`, subIcon: "person_off", subTone: "warn" };
    case "user.reactivate": return { text: "恢復帳號存取", sub: str(d.reason), subIcon: "how_to_reg", subTone: "ok" };
    case "user.update": return { text: `所屬科別：${str(d.old) || "未設定"} → ${str(d.department) || "未設定"}` };
    case "users.export": return { text: `匯出帳號清冊${d.rows != null ? ` · ${fmtInt(Number(d.rows))} 列` : ""}`, subIcon: "download", subTone: "muted" };
    case "monitoring.export":
    case "audit.export": return { text: `匯出 ${str(d.range_from)} ～ ${str(d.range_to)}${d.rows != null ? ` · ${fmtInt(Number(d.rows))} 列` : ""}`, sub: d.department ? `科別：${str(d.department)}` : undefined, subIcon: "download", subTone: "muted" };
    default: return { text: Object.entries(d).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : str(v)}`).join(" · ") || "—" };
  }
}

export default function Audit() {
  // Deep link from the account page: /audit?q=<email>&range=30d
  const [params] = useSearchParams();
  const [tab, setTab] = useState("");
  const [range, setRange] = useState<Range>(() => (RANGES.some((r) => r.id === params.get("range")) ? params.get("range") as Range : "7d"));
  const [custom, setCustom] = useState(rangeDates("7d"));
  const [department, setDepartment] = useState("");
  const [severity, setSeverity] = useState("");
  const [qInput, setQInput] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [cursors, setCursors] = useState<(string | null)[]>([null]); // cursors[i] opens page i
  const [pageIdx, setPageIdx] = useState(0);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0); // bump to re-fetch the current page

  useEffect(() => { const t = setTimeout(() => setQ(qInput.trim()), 350); return () => clearTimeout(t); }, [qInput]);
  const query: AuditQuery = useMemo(() => ({ ...(range === "custom" ? custom : rangeDates(range)), category: tab, severity, department, q }), [range, custom, tab, severity, department, q]);
  useEffect(() => { setCursors([null]); setPageIdx(0); setOpen(null); }, [query]);

  useEffect(() => {
    let live = true;
    setBusy(true); setErr("");
    api.audit(query, cursors[pageIdx], PAGE)
      .then((p) => { if (!live) return; setPage(p); setSyncedAt(new Date()); setCursors((c) => [...c.slice(0, pageIdx + 1), p.next_cursor]); })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
    // Not keyed on `cursors`: this effect advances it, so depending on it would refetch in a loop.
  }, [query, pageIdx, nonce]);

  const loadSummary = useCallback(() => { api.auditSummary().then(setSummary).catch((e) => setErr(String(e))); }, []);
  useEffect(loadSummary, [loadSummary]);
  const refresh = () => { loadSummary(); setCursors([null]); setPageIdx(0); setNonce((n) => n + 1); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const url = URL.createObjectURL(await api.auditCsv(query));
      Object.assign(document.createElement("a"), { href: url, download: `tcvgh-audit_${query.from}_${query.to}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(String(e)); } finally { setExporting(false); }
  };
  const showAlertsToday = () => { setTab("alerts"); setRange("today"); setSeverity(""); };

  const items = page?.items ?? [];
  const hasNext = !!cursors[pageIdx + 1];

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <section className="card flex flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div className="max-w-3xl">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold"><span className="h-7 w-1.5 rounded-full bg-primary-dark" />資安審計與操作軌跡日誌<span className="chip">Firestore · 僅追加不可改</span></h1>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            管理員檢視：全院所有人員對 Agent 的建立、發布、推論呼叫、知識文件、連接器調用與憑證變更、帳號角色與狀態異動，以及報表匯出。
            使用者輸入在進入平台時即去識別化，對話內容與連接器憑證都不寫入稽核紀錄。
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button className="btn-primary" onClick={exportCsv} disabled={exporting}>{exporting ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : <Icon name="ios_share" className="text-[18px]" />}匯出稽核報表 (CSV)</button>
          <p className="text-right font-mono text-[10px] text-outline">依目前篩選條件，最多 5,000 筆；匯出動作本身也會留下紀錄</p>
        </div>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summary === null ? [0, 1, 2, 3].map((i) => <div key={i} className="card grid h-48 place-items-center"><Spinner /></div>) : (
          <>
            <Kpi label="Audit Events Today" title="全院今日總審計事件" icon="analytics" value={fmtInt(summary.total)} unit="筆"
              foot={<><Delta pct={summary.delta_pct} /><span className="text-outline"> vs 昨日（{fmtInt(summary.total_yesterday)} 筆）</span></>}>
              <CategoryBar by={summary.by_category} total={summary.total} />
            </Kpi>
            <Kpi label="Connector Invocations" title="連接器 & MCP 調用數" icon="hub" value={fmtInt(summary.connector_calls)} unit="次"
              foot={summary.connector_calls === 0 ? <span className="text-outline">今日尚無連接器調用</span>
                : <span className={summary.connector_failed ? "font-semibold text-error" : "text-primary"}>成功率 {(((summary.connector_calls - summary.connector_failed) / summary.connector_calls) * 100).toFixed(1)}%{summary.connector_failed ? `（失敗 ${summary.connector_failed}）` : ""}</span>}>
              {summary.top_connectors.length === 0 ? <p className="text-outline">—</p> : summary.top_connectors.map((c) => <Row key={c.key} k={c.label} v={`${fmtInt(c.count)} 次`} />)}
            </Kpi>
            <Kpi label="Warnings & Failures" title="異常與失敗事件" icon="gpp_maybe" value={fmtInt(summary.warnings)} unit="筆" tone={summary.warnings ? "error" : undefined} onClick={showAlertsToday}
              foot={summary.warnings ? <span className="inline-flex items-center gap-1 font-semibold text-error">點此檢視今日異常<Icon name="arrow_forward" className="text-[14px]" /></span>
                : <span className="inline-flex items-center gap-1 text-primary"><Icon name="check_circle" className="text-[14px]" />今日無異常事件</span>}>
              {summary.warning_breakdown.length === 0 ? <p className="text-outline">連接器失敗、知識索引失敗與人工駁回會列在這裡</p>
                : summary.warning_breakdown.map((w) => <Row key={w.key} k={ACTION_LABEL[w.key] ?? w.key} v={`${fmtInt(w.count)} 筆`} tone="error" />)}
            </Kpi>
            <Kpi label="Active Staff Today" title="今日活躍醫事人員" icon="groups" value={fmtInt(summary.active_users)} unit="人"
              foot={<span className="text-outline">依今日稽核紀錄中的操作者計算</span>}>
              <Row k="執行 Agent 推論" v={`${fmtInt(summary.run_users)} 人`} />
              <Row k="建置 / 設定變更" v={`${fmtInt(summary.build_users)} 人`} />
              <Row k="被呼叫的 Agent" v={`${fmtInt(summary.agents_invoked)} 個`} />
            </Kpi>
          </>
        )}
      </section>
      {summary?.capped && <p className="mt-2 font-mono text-[10px] text-warning">今日事件超過統計上限，以上數字為下限值。</p>}

      <section className="card mt-5 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => {
            const on = tab === t.id, alert = t.id === "alerts";
            return (
              <button key={t.id || "all"} onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${on ? (alert ? "bg-error text-white" : "bg-primary-dark text-white") : alert ? "bg-error-container/60 text-on-error-container hover:bg-error-container" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"}`}>
                {alert && <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${on ? "bg-white" : "bg-error"}`} />}{t.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-outline">
          最後同步：{syncedAt ? syncedAt.toLocaleTimeString("zh-TW", { hour12: false }) : "—"}
          <button className="btn-ghost px-1 py-0.5" title="重新整理" onClick={refresh} disabled={busy}><Icon name="refresh" className={`text-[16px] ${busy ? "animate-spin" : ""}`} /></button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-2 text-[20px] text-outline" />
            <input className="py-2 pl-10" value={qInput} onChange={(e) => setQInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setQ(qInput.trim())}
              placeholder="搜尋操作者 e-mail、Agent 名稱、連接器、事件 ID 或內容…" />
          </div>
          <SelectBox icon="domain" value={department} onChange={setDepartment}>
            <option value="">全院所有科室部門</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </SelectBox>
          <SelectBox icon="calendar_today" value={range} onChange={(v) => setRange(v as Range)}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </SelectBox>
          <SelectBox icon="tune" value={severity} onChange={setSeverity}>
            {SEVERITIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </SelectBox>
        </div>
        {range === "custom" && (
          <div className="mt-2 flex items-center justify-end gap-1 font-mono text-xs">
            <input type="date" className="w-auto py-1 text-xs" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-outline">～</span>
            <input type="date" className="w-auto py-1 text-xs" value={custom.to} min={custom.from} max={daysAgo(0)} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        {department && <p className="mt-2 text-[11px] text-outline">科別依事件所屬 Agent 的科別判斷；匯出報表等與 Agent 無關的事件不會出現在科別篩選結果中。</p>}
      </section>

      <div className="mt-4"><ErrorBox msg={err} /></div>

      <section className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
          <h2 className="section-title">審計追蹤清單<span className="chip">每頁 {PAGE} 筆 · 新到舊</span></h2>
          <span className="font-mono text-[11px] text-outline">{query.from} ～ {query.to}</span>
        </div>
        {page === null ? <div className="grid place-items-center py-20"><Spinner /></div> : items.length === 0 ? (
          <div className="p-6"><Empty icon="shield" title="此條件下沒有稽核紀錄" hint={page.truncated ? "已掃描的紀錄中沒有符合項目，可按「下一頁」繼續往更早的紀錄搜尋。" : "調整日期區間、類別或搜尋字詞後再試一次。"} /></div>
        ) : (
          <div className={`mt-4 overflow-x-auto transition-opacity ${busy ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-surface-container-low font-mono text-[10px] uppercase tracking-wider text-outline">
                <tr><Th>事件時間與追蹤號</Th><Th>操作者</Th><Th>事件類別</Th><Th>目標 Agent / 連接器</Th><Th>操作詳情</Th><Th>狀態</Th><Th><span className="sr-only">展開</span></Th></tr>
              </thead>
              <tbody>
                {items.map((e) => <EventRow key={e.id} e={e} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))} />)}
              </tbody>
            </table>
          </div>
        )}
        {page !== null && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-6 py-3 text-xs text-on-surface-variant">
            <span>第 <b className="font-mono">{pageIdx + 1}</b> 頁{items.length > 0 && <>，本頁 {items.length} 筆（第 {pageIdx * PAGE + 1} 至 {pageIdx * PAGE + items.length} 筆）</>}
              {page.truncated && <span className="ml-2 text-warning">篩選條件較嚴格，本頁未填滿；按「下一頁」可繼續往前搜尋。</span>}</span>
            <div className="flex items-center gap-1">
              <button className="btn-soft py-1" disabled={busy || pageIdx === 0} onClick={() => setPageIdx(0)} title="第一頁"><Icon name="first_page" className="text-[16px]" /></button>
              <button className="btn-soft py-1" disabled={busy || pageIdx === 0} onClick={() => setPageIdx((p) => p - 1)}><Icon name="chevron_left" className="text-[16px]" />上一頁</button>
              <button className="btn-soft py-1" disabled={busy || !hasNext} onClick={() => setPageIdx((p) => p + 1)}>下一頁<Icon name="chevron_right" className="text-[16px]" /></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function EventRow({ e, open, onToggle }: { e: AuditEntry; open: boolean; onToggle: () => void }) {
  const warn = e.severity === "warning";
  const c = CAT[e.category] ?? CAT.other;
  const t = clock(e.at);
  const desc = describe(e);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify({ event_id: e.id, at: e.at, actor: { uid: e.actor, email: e.actor_email }, action: e.action, category: e.category, severity: e.severity,
    target: { kind: e.target_kind, id: e.target_id, label: e.target_label }, agent: e.agent_label || undefined, department: e.department || undefined, details: e.details }, null, 2);
  const copy = () => navigator.clipboard.writeText(json).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  const [local, domain] = e.actor_email.split("@");
  return (
    <Fragment>
      <tr className={`cursor-pointer border-t border-hairline align-top transition-colors ${warn ? "bg-error-container/20 hover:bg-error-container/40" : "hover:bg-primary-tint/40"}`} onClick={onToggle}>
        <td className="whitespace-nowrap px-4 py-3">
          <p className={`font-mono text-xs font-semibold ${warn ? "text-error" : "text-on-surface"}`}>{t.time}<span className="ml-1.5 font-normal text-outline">{t.day}</span></p>
          <p className={`mt-0.5 font-mono text-[10px] ${warn ? "text-error/80" : "text-primary"}`}>{e.id}</p>
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <p className={`font-semibold ${warn ? "text-error" : ""}`}>{local || e.actor}</p>
          <p className="font-mono text-[10px] text-outline">{domain ? `@${domain}` : e.actor}</p>
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <span className={`pill ${warn ? "bg-error-container text-on-error-container" : c.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${warn ? "bg-error" : c.dot}`} />{c.label}</span>
          <p className="mt-1 text-[11px] text-on-surface-variant">{ACTION_LABEL[e.action] ?? e.action}</p>
        </td>
        <td className="max-w-[16rem] px-4 py-3">
          {e.target_kind ? (
            <>
              <p className={`flex items-center gap-1.5 font-semibold ${warn ? "text-error" : "text-primary-dark"}`}>
                <Icon name={e.target_kind === "connector" ? "cable" : e.target_kind === "agent" ? "smart_toy" : e.target_kind === "user" ? "person" : "description"} className="shrink-0 text-[16px]" /><span className="truncate">{e.target_label}</span>
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-outline">
                {e.target_kind === "connector" && e.agent_label ? `經由 ${e.agent_label}` : e.target_kind === "user" ? "平台帳號" : [e.department, e.target_id].filter(Boolean).join(" · ") || "平台"}
              </p>
            </>
          ) : <span className="text-outline">—</span>}
        </td>
        <td className="max-w-[22rem] px-4 py-3">
          <p className={`line-clamp-2 text-[13px] ${warn ? "font-semibold text-error" : ""}`}>{desc.text}</p>
          {desc.sub && (
            <p className={`mt-0.5 flex items-start gap-1 text-[11px] ${desc.subTone === "warn" ? "text-error" : desc.subTone === "ok" ? "text-secondary" : "text-outline"}`}>
              {desc.subIcon && <Icon name={desc.subIcon} className="mt-px shrink-0 text-[13px]" />}<span className="line-clamp-2">{desc.sub}</span>
            </p>
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-3"><SeverityPill s={e.severity} /></td>
        <td className="px-2 py-3 text-right"><Icon name={open ? "expand_less" : "expand_more"} className="text-[20px] text-outline" /></td>
      </tr>
      {open && (
        <tr className="border-t border-hairline bg-surface-container-low/60">
          <td colSpan={7} className="px-6 py-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                <Meta k="事件 ID" v={e.id} mono />
                <Meta k="發生時間" v={e.at ? new Date(e.at).toLocaleString("zh-TW", { hour12: false }) : "—"} />
                <Meta k="操作者" v={e.actor_email || "—"} />
                <Meta k="操作者 UID" v={e.actor} mono />
                <Meta k="動作" v={`${ACTION_LABEL[e.action] ?? e.action}（${e.action}）`} />
                {e.target_id && <Meta k={{ connector: "連接器 ID", agent: "Agent ID", document: "文件 ID", user: "帳號" }[e.target_kind as string] ?? "目標 ID"} v={e.target_id} mono />}
                {e.agent_label && e.target_kind === "connector" && <Meta k="呼叫來源 Agent" v={e.agent_label} />}
                <Meta k="所屬科別" v={e.department || "—"} />
              </dl>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-outline">事件原始紀錄 (JSON)</p>
                  <button className="btn-ghost px-2 py-0.5 text-xs" onClick={copy}><Icon name={copied ? "check" : "content_copy"} className="text-[14px]" />{copied ? "已複製" : "複製"}</button>
                </div>
                <pre className="max-h-72 overflow-auto rounded-lg border border-hairline bg-white p-3 font-mono text-[11px] leading-5 text-on-surface">{json}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function CategoryBar({ by, total }: { by: AuditSummary["by_category"]; total: number }) {
  const parts = (Object.keys(CAT) as AuditCategory[]).map((k) => ({ k, n: by[k] ?? 0 })).filter((p) => p.n > 0);
  if (!total) return <p className="text-outline">今日尚無事件</p>;
  return (
    <>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-container-high">
        {parts.map((p) => <div key={p.k} className={CAT[p.k].bar} style={{ width: `${(p.n / total) * 100}%` }} title={`${CAT[p.k].label} ${p.n}`} />)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        {parts.map((p) => (
          <span key={p.k} className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CAT[p.k].bar}`} />{CAT[p.k].label}<span className="ml-auto font-mono text-outline">{Math.round((p.n / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </>
  );
}

const SeverityPill = ({ s }: { s: AuditSeverity }) =>
  s === "warning" ? <span className="pill bg-error-container text-on-error-container"><Icon name="error" className="text-[13px]" />異常</span>
  : s === "success" ? <span className="pill bg-secondary-container/70 text-on-secondary-container"><Icon name="check_circle" className="text-[13px]" />成功</span>
  : <span className="pill bg-surface-container-high text-on-surface-variant"><Icon name="radio_button_checked" className="text-[13px]" />已記錄</span>;

const SelectBox = ({ icon, value, onChange, children }: { icon: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) => (
  <div className="relative">
    <Icon name={icon} className="pointer-events-none absolute left-3 top-2 text-[20px] text-outline" />
    <select className="py-2 pl-10" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
  </div>
);
const Meta = ({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) => (
  <><dt className="text-outline">{k}</dt><dd className={`min-w-0 break-all ${mono ? "font-mono text-[11px]" : ""}`}>{v}</dd></>
);
const Th = ({ children }: { children: React.ReactNode }) => <th className="px-4 py-2 text-left">{children}</th>;
