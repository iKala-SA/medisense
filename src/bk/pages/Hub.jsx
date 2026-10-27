import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import ShareDialog, { ShareChip } from "../../live/ShareLive";
import { api } from "../api";
import { emptyAgent } from "../types";
import { ErrorBox, Icon, Spinner, fmtTime } from "../components/ui";

// Agent Hub: a plain list. Search, three filters, one action per row.
const statusOf = (a) => a.review?.state === "pending" ? { label: "待審核", cls: "bg-warning-container text-warning" }
  : a.review?.state === "rejected" ? { label: "已退回", cls: "bg-error-container text-error" }
  : a.status === "published" ? { label: `已發布 v${a.version}`, cls: "bg-primary-tint text-primary" }
  : { label: "草稿", cls: "bg-surface-container-high text-on-surface-variant" };
const TABS = [["all", "全部"], ["mine", "我的"], ["published", "已發布"]];
const COLS = "grid grid-cols-[minmax(0,2.6fr)_110px_minmax(0,1fr)_120px_150px_96px] items-center gap-4";

function Hub({ user, role }) {
  const builder = role !== "user";
  const nav = useNavigate();
  const [agents, setAgents] = useState(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [sharingId, setSharingId] = useState(null);
  const load = () => {
    api.listAgents().then((all) => setAgents(builder ? all : all.filter((a) => a.status === "published"))).catch((e) => setErr(String(e)));
  };
  useEffect(load, []);
  const create = async () => {
    setCreating(true);
    try {
      const a = await api.createAgent(emptyAgent());
      nav(`/studio/${a.id}`);
    } catch (e) {
      setErr(String(e));
      setCreating(false);
    }
  };
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (agents ?? [])
      .filter((a) => tab === "all" || (tab === "mine" ? a.owner_uid === user.uid : a.status === "published"))
      .filter((a) => !needle || [a.name, a.description, a.owner_email].some((t) => (t ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  }, [agents, tab, q, user.uid]);
  const sharingAgent = agents?.find((x) => x.id === sharingId);
  return <div>
      {sharingAgent && createPortal(<ShareDialog title={sharingAgent.name} value={sharingAgent.share} owner={sharingAgent.owner_email} onClose={() => setSharingId(null)} onDone={async (s) => { try { await api.shareAgent(sharingAgent.id, s); setAgents((l) => l.map((x) => x.id === sharingAgent.id ? { ...x, share: s } : x)); setSharingId(null); } catch (e) { setErr(String(e)); } }} />, document.body)}
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[24px] font-bold tracking-tight text-on-surface">Agent</h1>
        {builder && <button className="btn-primary rounded-full px-4 py-2" onClick={create} disabled={creating}>{creating ? <Spinner /> : <Icon name="add" className="text-[18px]" />}建立 Agent</button>}
      </header>
      <p className="mt-1 text-[13px] text-on-surface-variant">探索專科助理，讓專業工作更有條理。</p>
      <ErrorBox msg={err} />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <label className="flex w-full max-w-sm items-center">
          <Icon name="search" className="pointer-events-none z-10 -mr-8 ml-3 text-[18px] text-outline" />
          <input className="rounded-full bg-surface-container-low pl-9" placeholder="搜尋 Agent、說明或負責人" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="flex gap-1 rounded-full bg-surface-container-low p-1">
          {TABS.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${tab === id ? "bg-white text-on-surface shadow-card" : "text-on-surface-variant hover:text-on-surface"}`}>{label}</button>)}
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-hairline bg-white">
        <div className={`${COLS} hidden border-b border-hairline bg-surface-container-low px-5 py-2.5 text-xs font-medium text-outline md:grid`}>
          <span>名稱</span><span>狀態</span><span>負責人</span><span>更新</span><span>分享</span><span />
        </div>
        {agents === null ? <div className="flex justify-center py-14"><Spinner /></div>
          : !shown.length ? <div className="py-14 text-center text-sm text-on-surface-variant">{agents.length ? "沒有符合的 Agent" : "還沒有 Agent。"}</div>
          : shown.map((a) => {
            const mine = a.owner_uid === user.uid, editable = mine && builder, st = statusOf(a);
            return <div key={a.id} className={`${COLS} border-b border-hairline px-5 py-3.5 text-sm last:border-b-0 hover:bg-surface-container-low/60 max-md:grid-cols-1 max-md:gap-2`}>
                <button className="min-w-0 text-left" onClick={() => nav(editable ? `/studio/${a.id}` : `/sandbox/${a.id}`)}>
                  <span className="block truncate font-semibold text-on-surface">{a.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-on-surface-variant">{a.description || "（尚無說明）"}</span>
                </button>
                <span><span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span></span>
                <span className="truncate text-xs text-on-surface-variant">{mine ? "我" : (a.owner_email ?? "").split("@")[0]}</span>
                <span className="text-xs text-on-surface-variant">{fmtTime(a.updated_at)}</span>
                <span>{mine ? <ShareChip share={a.share} label={"分享 " + a.name} onClick={() => setSharingId(a.id)} /> : <span className="text-xs text-outline">—</span>}</span>
                <span className="flex justify-end">
                  <button className="btn-secondary rounded-full px-3.5 py-1.5" onClick={() => nav(editable ? `/studio/${a.id}` : `/sandbox/${a.id}`)}>{editable ? "編輯" : "對話"}</button>
                </span>
              </div>;
          })}
      </div>
    </div>;
}
export {
  Hub as default
};
