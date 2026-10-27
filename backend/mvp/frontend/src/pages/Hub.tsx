import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "firebase/auth";
import { api } from "../api";
import { CATEGORIES, emptyAgent, type AgentOut, type HubStats, type Role } from "../types";
import { CATEGORY_ICON, Empty, ErrorBox, Icon, Spinner, StatusPill, fmtTime } from "../components/ui";

type Filter = "all" | "mine" | "clinical" | "admin" | "consultation" | "published";

export default function Hub({ user, role }: { user: User; role: Role }) {
  const builder = role !== "user"; // run-only users chat with published agents and build nothing
  const nav = useNavigate();
  const [agents, setAgents] = useState<AgentOut[] | null>(null);
  const [stats, setStats] = useState<HubStats | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [err, setErr] = useState("");

  const load = () => {
    // A demoted owner still gets their drafts from the API; run-only users can only chat with published ones.
    api.listAgents().then((all) => setAgents(builder ? all : all.filter((a) => a.status === "published"))).catch((e) => setErr(String(e)));
    api.stats().then(setStats).catch(() => undefined);
  };
  useEffect(load, []);

  const create = async () => {
    const a = await api.createAgent(emptyAgent());
    nav(`/studio/${a.id}`);
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, mine: 0, clinical: 0, admin: 0, consultation: 0, published: 0 };
    for (const a of agents ?? []) {
      c.all++; c[a.category]++;
      if (a.owner_uid === user.uid) c.mine++;
      if (a.status === "published") c.published++;
    }
    return c;
  }, [agents, user.uid]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (agents ?? [])
      .filter((a) => filter === "all" || (filter === "mine" ? a.owner_uid === user.uid : filter === "published" ? a.status === "published" : a.category === filter))
      .filter((a) => !needle || [a.name, a.description, a.department, a.code, a.owner_email].some((s) => s?.toLowerCase().includes(needle)))
      .sort((x, y) => (sort === "name" ? x.name.localeCompare(y.name, "zh-TW") : String(y.updated_at).localeCompare(String(x.updated_at))));
  }, [agents, filter, q, sort, user.uid]);

  const firstName = (user.displayName ?? user.email ?? "").split(/[\s@]/)[0];
  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "全部 (All)" }, { id: "mine", label: "我的 Agent (My Agents)" }, { id: "clinical", label: "臨床診療 (Clinical)" },
    { id: "admin", label: "行政與衛教 (Admin & Education)" }, { id: "consultation", label: "跨科會診 (Consultation)" }, { id: "published", label: "已發布全院 (Published)" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <section className="flex flex-wrap items-start justify-between gap-6 rounded-xl bg-gradient-to-r from-primary-tint to-transparent px-6 py-6">
        <div>
          <p className="chip"><span className="h-1.5 w-1.5 rounded-full bg-primary" />中榮 智慧臨床 Agent 平台 v0.4 · GCP asia-east1 (Taiwan) Secure Zone</p>
          <h1 className="mt-3 text-4xl font-bold">歡迎，{firstName}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-on-surface-variant">
            院內跨科團隊已發布 <b className="text-primary-dark">{stats?.hospital_published ?? "—"} 個專科臨床代理人</b>。利用臨床安全提示詞、院內指引檢索增強 (RAG) 與 Google Cloud Vertex AI，加速全院無紙化與高精準度醫療協作。
          </p>
        </div>
        {builder && (
          <div className="flex flex-col gap-2">
            <button className="btn-primary px-5 py-3 text-base" onClick={create}><Icon name="add_circle" />+ 建立新 Agent</button>
            <button className="btn-secondary" onClick={() => nav("/knowledge")}><Icon name="menu_book" className="text-[18px]" />查看院內知識庫</button>
          </div>
        )}
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-4">
        {[
          { label: "我的專屬 AGENT", value: stats?.my_agents, unit: "組配置", sub: `含 ${stats?.my_published ?? 0} 個已發布`, icon: "smart_toy" },
          { label: "已發布臨床上線", value: stats?.hospital_published, unit: "個 Production", sub: "全院可見並可對話", icon: "verified" },
          { label: "今日全院呼叫量", value: stats?.runs_today, unit: "次", sub: "沙盒 + 已發布版本", icon: "monitoring" },
          { label: "知識庫文件", value: stats?.knowledge_files, unit: "份", sub: "索引前一律去識別化", icon: "cloud_done" },
        ].map((s) => (
          <div key={s.label} className="card flex items-center justify-between px-5 py-4">
            <div><p className="font-mono text-[10px] uppercase tracking-wider text-outline">{s.label}</p>
              <p className="mt-1 text-3xl font-bold">{s.value ?? "—"} <span className="text-sm font-medium text-on-surface-variant">{s.unit}</span></p>
              <p className="text-xs text-on-surface-variant">{s.sub}</p></div>
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={s.icon} /></span>
          </div>
        ))}
      </section>

      <section className="card mt-5 px-5 py-4">
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-2.5 text-[20px] text-outline" />
          <input className="pl-10 pr-10 py-2.5" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋 Agent 名稱、專科代碼、臨床關鍵字（例如：門診處方助理、急診檢傷分類、出院病歷、ICD-10…）" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`pill px-3 py-1 text-xs transition-colors ${filter === f.id ? "bg-primary-dark text-white" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"}`}>
              {f.label} <span className="opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-on-surface-variant">排序依據：
          <select className="w-auto py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as "updated" | "name")}><option value="updated">最近更新時間（預設）</option><option value="name">名稱</option></select>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">專科 Agent 總覽工作區 <span className="chip">{shown.length} 組臨床工作流</span></h2>
          <p className="flex items-center gap-1 text-xs text-on-surface-variant"><Icon name="info" className="text-[16px]" />{builder ? "點擊「進入編輯」開啟視覺化節點工作台 (Agent Studio)；他人已發布的 Agent 可「進入對話」" : "點擊「進入對話」使用已發布的 Agent；如需自建 Agent，請洽管理員開通建置權限"}</p>
        </div>
        <ErrorBox msg={err} />
        {agents === null ? <div className="grid place-items-center py-20"><Spinner /></div> :
          shown.length === 0 ? <Empty icon="smart_toy" title="還沒有符合條件的 Agent" hint={builder ? "按「建立新 Agent」開始，或調整篩選條件。" : "調整篩選條件，或等待各科發布 Agent。"} action={builder && <button className="btn-primary mt-2" onClick={create}>＋ 建立新 Agent</button>} /> : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((a) => {
              const mine = a.owner_uid === user.uid;
              const editable = mine && builder;
              return (
                <article key={a.id} className="card flex flex-col transition-shadow hover:shadow-float">
                  <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={CATEGORY_ICON[a.category]} /></span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm font-semibold">{a.department || CATEGORIES.find((c) => c.id === a.category)?.label} {a.code && <span className="chip ml-1">{a.code}</span>}</p>
                      <p className="truncate text-[11px] text-on-surface-variant">{mine ? "負責人：我" : `負責人：${a.owner_email}`}</p>
                    </div>
                    <StatusPill status={a.status} version={a.version} />
                  </div>
                  <div className="flex-1 px-4 py-3">
                    <h3 className="text-lg font-bold leading-snug">{a.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-on-surface-variant">{a.description || "（尚無臨床業務說明）"}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="chip"><Icon name="psychology" className="text-[13px]" />{a.model_group}</span>
                      {a.knowledge_count > 0 && <span className="chip"><Icon name="menu_book" className="text-[13px]" />{a.knowledge_count} 份知識文件 (RAG)</span>}
                      {a.routing.sovereign_only && <span className="chip"><Icon name="lock" className="text-[13px]" />院內模型</span>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-xs text-on-surface-variant">
                    <span className="flex items-center gap-1"><Icon name="schedule" className="text-[14px]" />{fmtTime(a.updated_at)} 更新</span>
                    {editable ? <button className="btn-primary" onClick={() => nav(`/studio/${a.id}`)}>進入編輯 <Icon name="arrow_forward" className="text-[16px]" /></button>
                      : <button className="btn-secondary" onClick={() => nav(`/sandbox/${a.id}`)}>進入對話 <Icon name="chat" className="text-[16px]" /></button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8 flex flex-wrap items-center gap-4 rounded-xl bg-primary-tint px-6 py-5">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-primary-dark text-white"><Icon name="verified_user" fill /></span>
        <div className="flex-1"><p className="text-lg font-bold">臨床 AI 代理人安全治理承諾</p>
          <p className="text-sm text-on-surface-variant">所有在工作台訓練與發布之代理人，皆受中榮倫理委員會 (IRB) 指引規範與 GCP Vertex AI 隱私邊界隔離保護；病患資料於推論前先行去識別化。</p></div>
        {role === "admin" && <button className="btn-secondary bg-white" onClick={() => nav("/audit")}><Icon name="receipt_long" className="text-[18px]" />稽核軌跡報告</button>}
      </section>
    </div>
  );
}
