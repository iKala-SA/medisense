import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { emptyAgent } from "../types";
import { ErrorBox, Icon, Spinner, fmtTime } from "../components/ui";
import { currentUid } from "../mock";

// Sandbox: a plain list. Test an agent, then publish it (admins directly, everyone else by request).
const statusOf = (a) => a.review?.state === "pending" ? { label: `審核中 v${a.review.version}`, cls: "bg-warning-container text-warning" }
  : a.review?.state === "rejected" ? { label: `已退回 v${a.review.version}`, cls: "bg-error-container text-error" }
  : a.status === "published" ? { label: `已發布 v${a.version}`, cls: "bg-primary-tint text-primary" }
  : { label: "草稿", cls: "bg-surface-container-high text-on-surface-variant" };
const COLS = "grid grid-cols-[minmax(0,2.4fr)_130px_120px_minmax(230px,1.4fr)] items-center gap-4";

function SandboxCenter({ role }) {
  const nav = useNavigate();
  const admin = role === "admin";
  const [agents, setAgents] = useState(null);
  const [queue, setQueue] = useState([]);
  const [tab, setTab] = useState("mine");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const load = () => {
    api.listAgents().then(setAgents).catch((e) => setErr(String(e)));
    if (admin) api.reviewQueue().then(setQueue).catch((e) => setErr(String(e)));
  };
  useEffect(load, [admin]);
  const uid = currentUid();
  const mine = useMemo(() => (agents ?? []).filter((a) => a.owner_uid === uid).sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")), [agents, uid]);
  const published = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (agents ?? []).filter((a) => a.status === "published").filter((a) => !needle || [a.name, a.description, a.owner_email].some((s) => (s ?? "").toLowerCase().includes(needle)));
  }, [agents, q]);
  const act = async (id, f) => {
    setBusy(id);
    setErr("");
    try { await f(); load(); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const create = async () => nav(`/studio/${(await api.createAgent(emptyAgent())).id}`);
  const reject = (id) => act(id, async () => { await api.reviewAgent(id, false, reason); setRejecting(null); setReason(""); });
  const Spin = ({ id, icon }) => busy === id ? <Spinner /> : <Icon name={icon} className="text-[16px]" />;
  return <div>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[24px] font-bold tracking-tight text-on-surface">沙盒測試</h1>
        <button className="btn-primary rounded-full px-4 py-2" onClick={create}><Icon name="add" className="text-[18px]" />建立 Agent</button>
      </header>
      <p className="mt-1 text-[13px] text-on-surface-variant">先在沙盒測試 Agent；準備好後{admin ? "直接發布至全院" : "申請全院發布，由管理員核可後上線"}。</p>
      <ErrorBox msg={err} />

      {admin && queue.length > 0 && <section className="mt-5 overflow-hidden rounded-2xl border border-warning/30 bg-warning-container/30">
          <h2 className="flex items-center gap-2 px-5 py-3 text-sm font-semibold"><Icon name="pending_actions" className="text-[18px] text-warning" />待審核的發布申請 <span className="rounded-full bg-white px-2 py-0.5 text-xs">{queue.length}</span></h2>
          {queue.map((a) => <div key={a.id} className="border-t border-warning/20 bg-white px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.name} <span className="ml-1 text-xs font-normal text-on-surface-variant">v{a.review.version}</span></p>
                  <p className="text-xs text-on-surface-variant">申請人 {a.review.requested_by_email} · {fmtTime(a.review.requested_at)}</p>
                </div>
                <button className="btn-secondary rounded-full" onClick={() => nav(`/sandbox/${a.id}?version=${a.review.version}`)}>試用</button>
                <button className="btn-soft rounded-full" disabled={busy === a.id} onClick={() => { setRejecting(rejecting === a.id ? null : a.id); setReason(""); }}>退回</button>
                <button className="btn-primary rounded-full" disabled={busy === a.id} onClick={() => act(a.id, () => api.reviewAgent(a.id, true))}><Spin id={a.id} icon="verified" />核可發布</button>
              </div>
              {rejecting === a.id && <div className="mt-3 flex items-start gap-2">
                  <textarea rows={2} className="flex-1 text-sm" value={reason} placeholder="退回原因（負責人會看到）" onChange={(e) => setReason(e.target.value)} />
                  <button className="btn-danger" disabled={!reason.trim() || busy === a.id} onClick={() => reject(a.id)}>確認退回</button>
                </div>}
            </div>)}
        </section>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full bg-surface-container-low p-1">
          {[["mine", `我的 Agent${agents ? `（${mine.length}）` : ""}`], ["published", "全院已發布"]].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${tab === id ? "bg-white text-on-surface shadow-card" : "text-on-surface-variant hover:text-on-surface"}`}>{label}</button>)}
        </div>
        {tab === "published" && <label className="flex w-full max-w-sm items-center">
            <Icon name="search" className="pointer-events-none z-10 -mr-8 ml-3 text-[18px] text-outline" />
            <input className="rounded-full bg-surface-container-low pl-9" placeholder="搜尋 Agent、說明或負責人" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-white">
        <div className={`${COLS} hidden border-b border-hairline bg-surface-container-low px-5 py-2.5 text-xs font-medium text-outline md:grid`}>
          <span>名稱</span><span>狀態</span><span>{tab === "mine" ? "更新" : "負責人"}</span><span />
        </div>
        {agents === null ? <div className="flex justify-center py-14"><Spinner /></div>
          : tab === "mine" ? (mine.length === 0 ? <div className="py-14 text-center text-sm text-on-surface-variant">還沒有自建 Agent。按右上角「建立 Agent」開始。</div> : mine.map((a) => {
              const st = statusOf(a), pending = a.review?.state === "pending";
              return <div key={a.id} className="border-b border-hairline last:border-b-0">
                  <div className={`${COLS} px-5 py-3.5 text-sm hover:bg-surface-container-low/60 max-md:grid-cols-1 max-md:gap-2`}>
                    <button className="min-w-0 text-left" onClick={() => nav(`/studio/${a.id}`)}>
                      <span className="block truncate font-semibold text-on-surface">{a.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-on-surface-variant">{a.description || "（尚無說明）"}</span>
                    </button>
                    <span><span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span></span>
                    <span className="text-xs text-on-surface-variant">{fmtTime(a.updated_at)}</span>
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <button className="btn-secondary rounded-full px-3.5 py-1.5" onClick={() => nav(`/sandbox/${a.id}`)}>測試</button>
                      {admin ? <button className="btn-primary rounded-full px-3.5 py-1.5" disabled={busy === a.id} onClick={() => act(a.id, () => api.publishAgent(a.id))}><Spin id={a.id} icon="publish" />{a.status === "published" ? `發布 v${a.version + 1}` : "發布"}</button>
                        : pending ? <button className="btn-soft rounded-full px-3.5 py-1.5" disabled={busy === a.id} onClick={() => act(a.id, () => api.withdrawPublish(a.id))}><Spin id={a.id} icon="undo" />撤回申請</button>
                        : <button className="btn-primary rounded-full px-3.5 py-1.5" disabled={busy === a.id} onClick={() => act(a.id, () => api.requestPublish(a.id))}><Spin id={a.id} icon="send" />申請發布</button>}
                    </span>
                  </div>
                  {a.review?.state === "rejected" && <p className="mx-5 mb-3 rounded-lg bg-error-container/40 px-3 py-2 text-xs text-on-error-container">被 {a.review.decided_by_email} 退回：{a.review.reason}</p>}
                </div>;
            }))
          : (published.length === 0 ? <div className="py-14 text-center text-sm text-on-surface-variant">沒有符合的已發布 Agent</div> : published.map((a) => <div key={a.id} className={`${COLS} border-b border-hairline px-5 py-3.5 text-sm last:border-b-0 hover:bg-surface-container-low/60 max-md:grid-cols-1 max-md:gap-2`}>
              <div className="min-w-0">
                <span className="block truncate font-semibold text-on-surface">{a.name}</span>
                <span className="mt-0.5 block truncate text-xs text-on-surface-variant">{a.description || "（尚無說明）"}</span>
              </div>
              <span><span className="inline-flex items-center rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-medium text-primary">已發布 v{a.version}</span></span>
              <span className="truncate text-xs text-on-surface-variant">{a.owner_uid === uid ? "我" : (a.owner_email ?? "").split("@")[0]}</span>
              <span className="flex justify-end"><button className="btn-secondary rounded-full px-3.5 py-1.5" onClick={() => nav(`/sandbox/${a.id}`)}>試用</button></span>
            </div>))}
      </div>
    </div>;
}
export {
  SandboxCenter as default
};
