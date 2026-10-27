import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { CATEGORIES, DEPARTMENTS, emptyAgent } from "../types";
import { CATEGORY_ICON, Empty, ErrorBox, Icon, Spinner, StatusPill, fmtTime } from "../components/ui";
import { currentUid } from "../mock";
const TABS = [
  { id: "all", label: "\u5168\u90E8\u81EA\u5EFA", test: () => true },
  { id: "draft", label: "\u8349\u7A3F", test: (a) => a.status === "draft" && !a.review },
  { id: "pending", label: "\u5BE9\u6838\u4E2D", test: (a) => a.review?.state === "pending" },
  { id: "rejected", label: "\u5DF2\u9000\u56DE", test: (a) => a.review?.state === "rejected" },
  { id: "published", label: "\u5DF2\u767C\u5E03", test: (a) => a.status === "published" }
];
const ReviewPill = ({ a }) => a.review?.state === "pending" ? <span className="pill bg-warning-container text-warning"><Icon name="hourglass_top" className="text-[13px]" />v{a.review.version} 審核中</span> : a.review?.state === "rejected" ? <span className="pill bg-error-container text-on-error-container"><Icon name="undo" className="text-[13px]" />v{a.review.version} 已退回</span> : null;
const ApprovedBadge = ({ a }) => <span className="pill bg-primary-tint text-primary-dark" title={a.approved_by_email || "\u5BE9\u6838\u5236\u5EA6\u4E0A\u7DDA\u524D\u767C\u5E03"}>
    <Icon name="verified" className="text-[13px]" fill />管理員核可 · {fmtTime(a.approved_at ?? a.published_at)}
  </span>;
function SandboxCenter({ role }) {
  const nav = useNavigate();
  const admin = role === "admin";
  const [agents, setAgents] = useState(null);
  const [queue, setQueue] = useState([]);
  const [activity, setActivity] = useState(null);
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState("runs");
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const load = () => {
    api.listAgents().then(setAgents).catch((e) => setErr(String(e)));
    api.sandboxActivity().then(setActivity).catch(() => void 0);
    api.stats().then(setStats).catch(() => void 0);
    if (admin) api.reviewQueue().then(setQueue).catch((e) => setErr(String(e)));
  };
  useEffect(load, [admin]);
  const uid = currentUid();
  const mine = useMemo(() => (agents ?? []).filter((a) => a.owner_uid === uid), [agents, uid]);
  const runs = (id) => activity?.by_agent[id];
  const hospital = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (agents ?? []).filter((a) => a.status === "published").filter((a) => (!dept || a.department === dept) && (!cat || a.category === cat)).filter((a) => !needle || [a.name, a.description, a.department, a.code, a.owner_email].some((s) => s?.toLowerCase().includes(needle)));
    const by = {
      runs: (a, b) => (runs(b.id)?.runs ?? 0) - (runs(a.id)?.runs ?? 0),
      newest: (a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? "")),
      name: (a, b) => a.name.localeCompare(b.name, "zh-Hant")
    }[sort];
    return rows.sort(by);
  }, [agents, q, dept, cat, sort, activity]);
  const act = async (id, f) => {
    setBusy(id);
    setErr("");
    try {
      await f();
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };
  const create = async () => nav(`/studio/${(await api.createAgent(emptyAgent())).id}`);
  const reject = (id) => act(id, async () => {
    await api.reviewAgent(id, false, reason);
    setRejecting(null);
    setReason("");
  });
  const shownMine = mine.filter(TABS.find((t) => t.id === tab).test);
  const pendingMine = mine.filter((a) => a.review?.state === "pending").length;
  return <div>
      <nav className="flex items-center gap-1 text-xs text-on-surface-variant">院區智能總覽<Icon name="chevron_right" className="text-[14px]" /><span className="font-semibold text-primary">沙盒測試與全院發布中心</span></nav>
      <section className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">沙盒測試與全院發布中心</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-on-surface-variant">在沙盒中以預載個案測試自建 Agent，確認無誤後申請全院發布；經管理員核可的版本才會出現在全院專區，供全院同仁直接試用。</p>
        </div>
        <button className="btn-primary px-5 py-2.5" onClick={create}><Icon name="add_box" className="text-[18px]" />建立新測試沙盒</button>
      </section>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
        <span className="pill bg-surface-container-low text-on-surface-variant"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Vertex AI · 經 LiteLLM 路由</span>
        <span className="pill bg-surface-container-low text-on-surface-variant"><Icon name="shield" className="text-[13px]" />去識別化：平台強制啟用</span>
        <span className="pill bg-surface-container-low text-on-surface-variant"><Icon name="gavel" className="text-[13px]" />全院發布需管理員核可</span>
      </div>

      <section className="mt-5 grid gap-4 md:grid-cols-4">
        {[
    { label: "\u6211\u7684\u81EA\u5EFA\u6C99\u76D2", value: agents ? mine.length : void 0, unit: "\u500B Agent", sub: `${mine.filter(TABS[1].test).length} \u8349\u7A3F \xB7 ${pendingMine} \u5BE9\u6838\u4E2D \xB7 ${mine.filter(TABS[4].test).length} \u5DF2\u767C\u5E03`, icon: "science" },
    { label: "\u5168\u9662\u6B63\u5F0F\u767C\u5E03\u76EE\u9304", value: stats?.hospital_published, unit: "\u500B\u4E0A\u7DDA Agent", sub: `\u6DB5\u84CB ${new Set((agents ?? []).filter((a) => a.status === "published" && a.department).map((a) => a.department)).size} \u500B\u79D1\u5225`, icon: "fact_check" },
    { label: "\u4ECA\u65E5\u63A8\u8AD6\u6B21\u6578", value: activity?.runs_today.toLocaleString(), unit: "\u6B21\u5C0D\u8A71", sub: activity?.runs_today ? `\u5E73\u5747\u5EF6\u9072 ${activity.avg_latency_ms.toLocaleString()} ms${activity.capped ? "\uFF08\u5DF2\u9054\u7D71\u8A08\u4E0A\u9650\uFF09" : ""}` : "\u4ECA\u65E5\u5C1A\u7121\u63A8\u8AD6", icon: "speed" },
    { label: admin ? "\u5168\u9662\u5F85\u5BE9\u767C\u5E03" : "\u6211\u7684\u5F85\u5BE9\u7533\u8ACB", value: activity?.pending_reviews, unit: "\u4EF6", sub: admin ? "\u7531\u7BA1\u7406\u54E1\u6838\u53EF\u5F8C\u4E0A\u7DDA" : "\u7BA1\u7406\u54E1\u5BE9\u6838\u4E2D", icon: "pending_actions" }
  ].map((s) => <div key={s.label} className="card flex items-center justify-between px-5 py-4">
            <div><p className="font-mono text-[10px] uppercase tracking-wider text-outline">{s.label}</p>
              <p className="mt-1 text-3xl font-bold">{s.value ?? "\u2014"} <span className="text-sm font-medium text-on-surface-variant">{s.unit}</span></p>
              <p className="text-xs text-on-surface-variant">{s.sub}</p></div>
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={s.icon} /></span>
          </div>)}
      </section>
      <div className="mt-3"><ErrorBox msg={err} /></div>

      {admin && queue.length > 0 && <section className="mt-6">
          <h2 className="section-title"><Icon name="pending_actions" className="text-warning" />待我審核的發布申請 <span className="chip">{queue.length} 件</span></h2>
          <p className="mt-1 text-xs text-on-surface-variant">審核的是申請當下凍結的版本；負責人之後對草稿的修改不包含在本次申請內。</p>
          <div className="mt-3 space-y-2">
            {queue.map((a) => <div key={a.id} className="card px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-warning-container text-warning"><Icon name={CATEGORY_ICON[a.category]} /></span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="font-semibold">{a.name} <span className="chip ml-1">v{a.review.version}</span>{a.status === "published" && <span className="chip ml-1">目前上線 v{a.version}</span>}</p>
                    <p className="text-xs text-on-surface-variant">{a.department || "\u672A\u6307\u5B9A\u79D1\u5225"} · 申請人 {a.review.requested_by_email} · {fmtTime(a.review.requested_at)}</p>
                  </div>
                  <button className="btn-secondary" onClick={() => nav(`/sandbox/${a.id}?version=${a.review.version}`)}><Icon name="science" className="text-[16px]" />試用待審版本</button>
                  <button className="btn-soft" disabled={busy === a.id} onClick={() => {
    setRejecting(rejecting === a.id ? null : a.id);
    setReason("");
  }}><Icon name="undo" className="text-[16px]" />退回</button>
                  <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api.reviewAgent(a.id, true))}>{busy === a.id ? <Spinner /> : <Icon name="verified" className="text-[16px]" />}核可發布</button>
                </div>
                {rejecting === a.id && <div className="mt-3 flex items-start gap-2">
                    <textarea rows={2} className="flex-1 text-sm" value={reason} placeholder="退回原因（負責人會在卡片上看到）" onChange={(e) => setReason(e.target.value)} />
                    <button className="btn-danger" disabled={!reason.trim() || busy === a.id} onClick={() => reject(a.id)}>確認退回</button>
                  </div>}
              </div>)}
          </div>
        </section>}

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="section-title">我的自建 Agent 測試與沙盒實驗區</h2>
            <p className="mt-1 text-xs text-on-surface-variant">以預載個案進行多輪對話測試；{admin ? "\u7BA1\u7406\u54E1\u53EF\u76F4\u63A5\u767C\u5E03\u81F3\u5168\u9662\u3002" : "\u6E96\u5099\u597D\u5F8C\u7533\u8ACB\u5168\u9662\u767C\u5E03\uFF0C\u7531\u7BA1\u7406\u54E1\u6838\u53EF\u5F8C\u4E0A\u7DDA\u3002"}</p>
          </div>
          <div className="flex rounded-lg bg-surface-container-low p-1 text-xs">
            {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1.5 ${tab === t.id ? "bg-white font-semibold text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}>
                {t.label} <span className="opacity-70">({mine.filter(t.test).length})</span>
              </button>)}
          </div>
        </div>
        {agents === null ? <div className="grid place-items-center py-16"><Spinner /></div> : shownMine.length === 0 ? <div className="mt-3"><Empty icon="science" title={mine.length ? "\u6B64\u5206\u985E\u6C92\u6709 Agent" : "\u60A8\u9084\u6C92\u6709\u81EA\u5EFA Agent"} action={!mine.length && <button className="btn-primary mt-2" onClick={create}>＋ 建立新測試沙盒</button>} /></div> : <div className="mt-3 grid gap-4 md:grid-cols-2">
            {shownMine.map((a) => {
    const r = runs(a.id);
    const pending = a.review?.state === "pending";
    return <article key={a.id} className="card flex flex-col">
                  <div className="flex items-start gap-3 px-4 pt-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={CATEGORY_ICON[a.category]} /></span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <h3 className="font-bold">{a.name}</h3>
                      <p className="mt-0.5 font-mono text-[11px] text-outline">{a.department || "\u672A\u6307\u5B9A\u79D1\u5225"} · 模型群組 {a.model_group} · {fmtTime(a.updated_at)} 更新</p>
                    </div>
                    <div className="flex flex-col items-end gap-1"><StatusPill status={a.status} version={a.version} /><ReviewPill a={a} /></div>
                  </div>
                  <div className="mx-4 mt-3 grid grid-cols-4 gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-center text-xs">
                    {[["\u7BC0\u9EDE", a.flow.nodes.length], ["\u77E5\u8B58\u6587\u4EF6", a.knowledge_count], ["\u9810\u8F09\u500B\u6848", a.test_cases.length], ["\u4ECA\u65E5\u63A8\u8AD6", r?.runs ?? 0]].map(([k, v]) => <div key={k}><p className="text-[10px] text-outline">{k}</p><p className="font-mono font-semibold">{v}</p></div>)}
                  </div>
                  <div className="flex-1 px-4 py-2 text-xs">
                    {r?.runs ? <p className="text-on-surface-variant">今日平均延遲 {r.avg_latency_ms.toLocaleString()} ms</p> : null}
                    {pending && <p className="mt-1 flex items-center gap-1 text-warning"><Icon name="hourglass_top" className="text-[14px]" />v{a.review.version} 於 {fmtTime(a.review.requested_at)} 送審，之後的草稿修改不在此次申請內</p>}
                    {a.review?.state === "rejected" && <div className="mt-1 rounded border border-error/30 bg-error-container/40 px-3 py-2 text-on-error-container">
                        <p className="font-semibold">v{a.review.version} 被 {a.review.decided_by_email} 退回 · {fmtTime(a.review.decided_at)}</p>
                        <p className="mt-0.5">{a.review.reason}</p>
                      </div>}
                    {a.status === "published" && !pending && <div className="mt-1"><ApprovedBadge a={a} /></div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
                    <button className="btn-ghost text-xs" onClick={() => nav(`/studio/${a.id}`)}><Icon name="account_tree" className="text-[16px]" />編輯工作流</button>
                    <span className="flex-1" />
                    <button className="btn-secondary" onClick={() => nav(`/sandbox/${a.id}`)}><Icon name="science" className="text-[16px]" />進入沙盒測試</button>
                    {admin ? <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api.publishAgent(a.id))}>{busy === a.id ? <Spinner /> : <Icon name="publish" className="text-[16px]" />}{a.status === "published" ? `\u767C\u5E03 v${a.version + 1}` : "\u76F4\u63A5\u767C\u5E03\u5168\u9662"}</button> : pending ? <button className="btn-soft" disabled={busy === a.id} onClick={() => act(a.id, () => api.withdrawPublish(a.id))}>{busy === a.id ? <Spinner /> : <Icon name="undo" className="text-[16px]" />}撤回申請</button> : <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api.requestPublish(a.id))}>{busy === a.id ? <Spinner /> : <Icon name="send" className="text-[16px]" />}申請全院發布 (v{a.version + 1})</button>}
                  </div>
                </article>;
  })}
          </div>}
      </section>

      <section className="mt-10">
        <h2 className="section-title"><Icon name="verified" className="text-primary" />全院正式發布 Agent 專區</h2>
        <p className="mt-1 text-xs text-on-surface-variant">經管理員核可的 Agent，全院同仁可直接在沙盒中試用已發布版本。</p>
        <div className="card mt-3 grid gap-3 px-4 py-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="relative"><Icon name="search" className="absolute left-3 top-2.5 text-[20px] text-outline" />
            <input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋全院發布之 Agent、科別、負責人…" /></div>
          <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">全院各科別</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">所有類別</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="runs">今日使用量最高</option><option value="newest">最新發布</option><option value="name">名稱</option></select>
        </div>
        {agents === null ? null : hospital.length === 0 ? <div className="mt-3"><Empty icon="verified" title="沒有符合條件的已發布 Agent" /></div> : <div className="mt-3 grid gap-4 md:grid-cols-2">
            {hospital.map((a) => <article key={a.id} className="card flex flex-col">
                <div className="flex items-start gap-3 px-4 pt-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={CATEGORY_ICON[a.category]} /></span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <h3 className="font-bold">{a.name}</h3>
                    <p className="mt-0.5 text-[11px] text-on-surface-variant">發布來源：{a.department || "\u672A\u6307\u5B9A\u79D1\u5225"} · {a.owner_uid === uid ? "\u6211" : a.owner_email}</p>
                  </div>
                  <span className="chip">v{a.version}</span>
                </div>
                <p className="line-clamp-3 flex-1 px-4 pt-2 text-sm leading-6 text-on-surface-variant">{a.description || "\uFF08\u5C1A\u7121\u81E8\u5E8A\u696D\u52D9\u8AAA\u660E\uFF09"}</p>
                <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
                  <ApprovedBadge a={a} />
                  <span className="chip"><Icon name="trending_up" className="text-[13px]" />今日 {(runs(a.id)?.runs ?? 0).toLocaleString()} 次</span>
                  {a.knowledge_count > 0 && <span className="chip"><Icon name="menu_book" className="text-[13px]" />{a.knowledge_count} 份知識文件</span>}
                </div>
                <div className="flex justify-end border-t border-hairline px-4 py-3">
                  <button className="btn-primary" onClick={() => nav(`/sandbox/${a.id}`)}><Icon name="science" className="text-[16px]" />立即在沙盒試用</button>
                </div>
              </article>)}
          </div>}
      </section>
    </div>;
}
export {
  SandboxCenter as default
};
