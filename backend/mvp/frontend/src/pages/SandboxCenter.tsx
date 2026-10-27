import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { CATEGORIES, DEPARTMENTS, emptyAgent, type AgentOut, type HubStats, type Role, type SandboxActivity } from "../types";
import { CATEGORY_ICON, Empty, ErrorBox, Icon, Spinner, StatusPill, fmtTime } from "../components/ui";
import { currentUid } from "../mock";

type Tab = "all" | "draft" | "pending" | "rejected" | "published";
const TABS: { id: Tab; label: string; test: (a: AgentOut) => boolean }[] = [
  { id: "all", label: "全部自建", test: () => true },
  { id: "draft", label: "草稿", test: (a) => a.status === "draft" && !a.review },
  { id: "pending", label: "審核中", test: (a) => a.review?.state === "pending" },
  { id: "rejected", label: "已退回", test: (a) => a.review?.state === "rejected" },
  { id: "published", label: "已發布", test: (a) => a.status === "published" },
];
type Sort = "runs" | "newest" | "name";

const ReviewPill = ({ a }: { a: AgentOut }) =>
  a.review?.state === "pending" ? <span className="pill bg-warning-container text-warning"><Icon name="hourglass_top" className="text-[13px]" />v{a.review.version} 審核中</span>
    : a.review?.state === "rejected" ? <span className="pill bg-error-container text-on-error-container"><Icon name="undo" className="text-[13px]" />v{a.review.version} 已退回</span> : null;

/** Published agents are admin-approved; ones published before review existed count as approved too. */
const ApprovedBadge = ({ a }: { a: AgentOut }) => (
  <span className="pill bg-primary-tint text-primary-dark" title={a.approved_by_email || "審核制度上線前發布"}>
    <Icon name="verified" className="text-[13px]" fill />管理員核可 · {fmtTime(a.approved_at ?? a.published_at)}
  </span>
);

export default function SandboxCenter({ role }: { role: Role }) {
  const nav = useNavigate();
  const admin = role === "admin";
  const [agents, setAgents] = useState<AgentOut[] | null>(null);
  const [queue, setQueue] = useState<AgentOut[]>([]);
  const [activity, setActivity] = useState<SandboxActivity | null>(null);
  const [stats, setStats] = useState<HubStats | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<Sort>("runs");
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    api.listAgents().then(setAgents).catch((e) => setErr(String(e)));
    api.sandboxActivity().then(setActivity).catch(() => undefined);
    api.stats().then(setStats).catch(() => undefined);
    if (admin) api.reviewQueue().then(setQueue).catch((e) => setErr(String(e)));
  };
  useEffect(load, [admin]);

  const uid = currentUid();
  const mine = useMemo(() => (agents ?? []).filter((a) => a.owner_uid === uid), [agents, uid]);
  const runs = (id: string) => activity?.by_agent[id];
  const hospital = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (agents ?? []).filter((a) => a.status === "published")
      .filter((a) => (!dept || a.department === dept) && (!cat || a.category === cat))
      .filter((a) => !needle || [a.name, a.description, a.department, a.code, a.owner_email].some((s) => s?.toLowerCase().includes(needle)));
    const by = { runs: (a: AgentOut, b: AgentOut) => (runs(b.id)?.runs ?? 0) - (runs(a.id)?.runs ?? 0),
      newest: (a: AgentOut, b: AgentOut) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? "")),
      name: (a: AgentOut, b: AgentOut) => a.name.localeCompare(b.name, "zh-Hant") }[sort];
    return rows.sort(by);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, q, dept, cat, sort, activity]);

  const act = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id); setErr("");
    try { await f(); load(); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const create = async () => nav(`/studio/${(await api.createAgent(emptyAgent())).id}`);
  const reject = (id: string) => act(id, async () => { await api.reviewAgent(id, false, reason); setRejecting(null); setReason(""); });

  const shownMine = mine.filter(TABS.find((t) => t.id === tab)!.test);
  const pendingMine = mine.filter((a) => a.review?.state === "pending").length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
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
          { label: "我的自建沙盒", value: agents ? mine.length : undefined, unit: "個 Agent", sub: `${mine.filter(TABS[1].test).length} 草稿 · ${pendingMine} 審核中 · ${mine.filter(TABS[4].test).length} 已發布`, icon: "science" },
          { label: "全院正式發布目錄", value: stats?.hospital_published, unit: "個上線 Agent", sub: `涵蓋 ${new Set((agents ?? []).filter((a) => a.status === "published" && a.department).map((a) => a.department)).size} 個科別`, icon: "fact_check" },
          { label: "今日推論次數", value: activity?.runs_today.toLocaleString(), unit: "次對話", sub: activity?.runs_today ? `平均延遲 ${activity.avg_latency_ms.toLocaleString()} ms${activity.capped ? "（已達統計上限）" : ""}` : "今日尚無推論", icon: "speed" },
          { label: admin ? "全院待審發布" : "我的待審申請", value: activity?.pending_reviews, unit: "件", sub: admin ? "由管理員核可後上線" : "管理員審核中", icon: "pending_actions" },
        ].map((s) => (
          <div key={s.label} className="card flex items-center justify-between px-5 py-4">
            <div><p className="font-mono text-[10px] uppercase tracking-wider text-outline">{s.label}</p>
              <p className="mt-1 text-3xl font-bold">{s.value ?? "—"} <span className="text-sm font-medium text-on-surface-variant">{s.unit}</span></p>
              <p className="text-xs text-on-surface-variant">{s.sub}</p></div>
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={s.icon} /></span>
          </div>
        ))}
      </section>
      <div className="mt-3"><ErrorBox msg={err} /></div>

      {admin && queue.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title"><Icon name="pending_actions" className="text-warning" />待我審核的發布申請 <span className="chip">{queue.length} 件</span></h2>
          <p className="mt-1 text-xs text-on-surface-variant">審核的是申請當下凍結的版本；負責人之後對草稿的修改不包含在本次申請內。</p>
          <div className="mt-3 space-y-2">
            {queue.map((a) => (
              <div key={a.id} className="card px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-warning-container text-warning"><Icon name={CATEGORY_ICON[a.category]} /></span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="font-semibold">{a.name} <span className="chip ml-1">v{a.review!.version}</span>{a.status === "published" && <span className="chip ml-1">目前上線 v{a.version}</span>}</p>
                    <p className="text-xs text-on-surface-variant">{a.department || "未指定科別"} · 申請人 {a.review!.requested_by_email} · {fmtTime(a.review!.requested_at)}</p>
                  </div>
                  <button className="btn-secondary" onClick={() => nav(`/sandbox/${a.id}?version=${a.review!.version}`)}><Icon name="science" className="text-[16px]" />試用待審版本</button>
                  <button className="btn-soft" disabled={busy === a.id} onClick={() => { setRejecting(rejecting === a.id ? null : a.id); setReason(""); }}><Icon name="undo" className="text-[16px]" />退回</button>
                  <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api.reviewAgent(a.id, true))}>{busy === a.id ? <Spinner /> : <Icon name="verified" className="text-[16px]" />}核可發布</button>
                </div>
                {rejecting === a.id && (
                  <div className="mt-3 flex items-start gap-2">
                    <textarea rows={2} className="flex-1 text-sm" value={reason} placeholder="退回原因（負責人會在卡片上看到）" onChange={(e) => setReason(e.target.value)} />
                    <button className="btn-danger" disabled={!reason.trim() || busy === a.id} onClick={() => reject(a.id)}>確認退回</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="section-title">我的自建 Agent 測試與沙盒實驗區</h2>
            <p className="mt-1 text-xs text-on-surface-variant">以預載個案進行多輪對話測試；{admin ? "管理員可直接發布至全院。" : "準備好後申請全院發布，由管理員核可後上線。"}</p>
          </div>
          <div className="flex rounded-lg bg-surface-container-low p-1 text-xs">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1.5 ${tab === t.id ? "bg-white font-semibold text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}>
                {t.label} <span className="opacity-70">({mine.filter(t.test).length})</span>
              </button>
            ))}
          </div>
        </div>
        {agents === null ? <div className="grid place-items-center py-16"><Spinner /></div> :
          shownMine.length === 0 ? <div className="mt-3"><Empty icon="science" title={mine.length ? "此分類沒有 Agent" : "您還沒有自建 Agent"} action={!mine.length && <button className="btn-primary mt-2" onClick={create}>＋ 建立新測試沙盒</button>} /></div> : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {shownMine.map((a) => {
              const r = runs(a.id);
              const pending = a.review?.state === "pending";
              return (
                <article key={a.id} className="card flex flex-col">
                  <div className="flex items-start gap-3 px-4 pt-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={CATEGORY_ICON[a.category]} /></span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <h3 className="font-bold">{a.name}</h3>
                      <p className="mt-0.5 font-mono text-[11px] text-outline">{a.department || "未指定科別"} · 模型群組 {a.model_group} · {fmtTime(a.updated_at)} 更新</p>
                    </div>
                    <div className="flex flex-col items-end gap-1"><StatusPill status={a.status} version={a.version} /><ReviewPill a={a} /></div>
                  </div>
                  <div className="mx-4 mt-3 grid grid-cols-4 gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-center text-xs">
                    {[["節點", a.flow.nodes.length], ["知識文件", a.knowledge_count], ["預載個案", a.test_cases.length], ["今日推論", r?.runs ?? 0]].map(([k, v]) => (
                      <div key={k}><p className="text-[10px] text-outline">{k}</p><p className="font-mono font-semibold">{v}</p></div>
                    ))}
                  </div>
                  <div className="flex-1 px-4 py-2 text-xs">
                    {r?.runs ? <p className="text-on-surface-variant">今日平均延遲 {r.avg_latency_ms.toLocaleString()} ms</p> : null}
                    {pending && <p className="mt-1 flex items-center gap-1 text-warning"><Icon name="hourglass_top" className="text-[14px]" />v{a.review!.version} 於 {fmtTime(a.review!.requested_at)} 送審，之後的草稿修改不在此次申請內</p>}
                    {a.review?.state === "rejected" && (
                      <div className="mt-1 rounded border border-error/30 bg-error-container/40 px-3 py-2 text-on-error-container">
                        <p className="font-semibold">v{a.review.version} 被 {a.review.decided_by_email} 退回 · {fmtTime(a.review.decided_at)}</p>
                        <p className="mt-0.5">{a.review.reason}</p>
                      </div>
                    )}
                    {a.status === "published" && !pending && <div className="mt-1"><ApprovedBadge a={a} /></div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
                    <button className="btn-ghost text-xs" onClick={() => nav(`/studio/${a.id}`)}><Icon name="account_tree" className="text-[16px]" />編輯工作流</button>
                    <span className="flex-1" />
                    <button className="btn-secondary" onClick={() => nav(`/sandbox/${a.id}`)}><Icon name="science" className="text-[16px]" />進入沙盒測試</button>
                    {admin ? (
                      <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api.publishAgent(a.id))}>{busy === a.id ? <Spinner /> : <Icon name="publish" className="text-[16px]" />}{a.status === "published" ? `發布 v${a.version + 1}` : "直接發布全院"}</button>
                    ) : pending ? (
                      <button className="btn-soft" disabled={busy === a.id} onClick={() => act(a.id, () => api.withdrawPublish(a.id))}>{busy === a.id ? <Spinner /> : <Icon name="undo" className="text-[16px]" />}撤回申請</button>
                    ) : (
                      <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a.id, () => api.requestPublish(a.id))}>{busy === a.id ? <Spinner /> : <Icon name="send" className="text-[16px]" />}申請全院發布 (v{a.version + 1})</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="section-title"><Icon name="verified" className="text-primary" />全院正式發布 Agent 專區</h2>
        <p className="mt-1 text-xs text-on-surface-variant">經管理員核可的 Agent，全院同仁可直接在沙盒中試用已發布版本。</p>
        <div className="card mt-3 grid gap-3 px-4 py-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="relative"><Icon name="search" className="absolute left-3 top-2.5 text-[20px] text-outline" />
            <input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋全院發布之 Agent、科別、負責人…" /></div>
          <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">全院各科別</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">所有類別</option>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="runs">今日使用量最高</option><option value="newest">最新發布</option><option value="name">名稱</option></select>
        </div>
        {agents === null ? null : hospital.length === 0 ? <div className="mt-3"><Empty icon="verified" title="沒有符合條件的已發布 Agent" /></div> : (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {hospital.map((a) => (
              <article key={a.id} className="card flex flex-col">
                <div className="flex items-start gap-3 px-4 pt-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={CATEGORY_ICON[a.category]} /></span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <h3 className="font-bold">{a.name}</h3>
                    <p className="mt-0.5 text-[11px] text-on-surface-variant">發布來源：{a.department || "未指定科別"} · {a.owner_uid === uid ? "我" : a.owner_email}</p>
                  </div>
                  <span className="chip">v{a.version}</span>
                </div>
                <p className="line-clamp-3 flex-1 px-4 pt-2 text-sm leading-6 text-on-surface-variant">{a.description || "（尚無臨床業務說明）"}</p>
                <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
                  <ApprovedBadge a={a} />
                  <span className="chip"><Icon name="trending_up" className="text-[13px]" />今日 {(runs(a.id)?.runs ?? 0).toLocaleString()} 次</span>
                  {a.knowledge_count > 0 && <span className="chip"><Icon name="menu_book" className="text-[13px]" />{a.knowledge_count} 份知識文件</span>}
                </div>
                <div className="flex justify-end border-t border-hairline px-4 py-3">
                  <button className="btn-primary" onClick={() => nav(`/sandbox/${a.id}`)}><Icon name="science" className="text-[16px]" />立即在沙盒試用</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
