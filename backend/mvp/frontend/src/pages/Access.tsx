import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { DEPARTMENTS, ROLES, ROLE_LABEL, type Role, type UserDirectory, type UserOut } from "../types";
import { Empty, ErrorBox, Icon, Modal, Spinner, fmtTime } from "../components/ui";

const PAGE = 20;
type Tab = "all" | Role | "suspended" | "pending";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "全部同仁" }, { id: "admin", label: "系統管理員" }, { id: "builder", label: "Agent 建置者" },
  { id: "user", label: "一般使用者" }, { id: "suspended", label: "已暫停" }, { id: "pending", label: "待首次登入" },
];
const inTab = (u: UserOut, t: Tab) =>
  t === "all" || (t === "suspended" ? u.status === "suspended" : t === "pending" ? !u.uid : u.role === t);

export const RoleBadge = ({ role }: { role: Role }) => {
  const r = ROLES.find((x) => x.id === role)!;
  const tone = role === "admin" ? "bg-primary-dark text-white" : role === "builder" ? "bg-primary-tint text-primary-dark" : "bg-surface-container-high text-on-surface-variant";
  return <span className={`pill ${tone}`}><Icon name={r.icon} className="text-[13px]" />{r.label}</span>;
};

export const StatusBadge = ({ u }: { u: UserOut }) =>
  u.status === "suspended" ? <span className="pill bg-error-container text-on-error-container"><span className="h-1.5 w-1.5 rounded-full bg-error" />已暫停</span>
    : !u.uid ? <span className="pill bg-warning-container text-warning"><span className="h-1.5 w-1.5 rounded-full bg-warning" />待首次登入</span>
    : <span className="pill bg-primary-tint text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />正常啟用</span>;

export const Avatar = ({ u, big = false }: { u: UserOut; big?: boolean }) => (
  <span className={`grid shrink-0 place-items-center rounded-lg font-bold ${big ? "h-16 w-16 text-2xl" : "h-9 w-9 text-sm"} ${u.status === "suspended" ? "bg-surface-container-high text-outline" : "bg-primary-tint text-primary-dark"}`}>
    {(u.name || u.email).slice(0, 1).toUpperCase()}
  </span>
);

export default function Access() {
  const nav = useNavigate();
  const [dir, setDir] = useState<UserDirectory | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState("");

  const load = () => { api.listUsers().then(setDir).catch((e) => setErr(String(e))); };
  useEffect(load, []);
  useEffect(() => setPage(1), [tab, q, dept]);

  const users = dir?.users ?? [];
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, users.filter((u) => inTab(u, t.id)).length])) as Record<Tab, number>, [users]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => users
    .filter((u) => inTab(u, tab) && (!dept || u.department === dept))
    .filter((u) => !needle || [u.name, u.email, u.department].some((s) => s.toLowerCase().includes(needle))), [users, tab, dept, needle]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const rows = shown.slice((page - 1) * PAGE, page * PAGE);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const url = URL.createObjectURL(await api.usersCsv());
      Object.assign(document.createElement("a"), { href: url, download: "tcvgh-accounts.csv" }).click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(String(e)); } finally { setExporting(false); }
  };

  const signedIn = users.filter((u) => u.uid).length;
  const active7d = users.filter((u) => u.last_seen_at && Date.now() - new Date(u.last_seen_at).getTime() < 7 * 864e5).length;
  const tiles = [
    { label: "PLATFORM ACCOUNTS", title: "平台帳號", value: users.length, unit: "人", sub: `${signedIn} 人已登入過 · ${users.length - signedIn} 人待首次登入`, icon: "badge" },
    { label: "ADMINS", title: "系統管理員", value: counts.admin, unit: "位", sub: `其中 ${users.filter((u) => u.bootstrap_admin).length} 位由部署設定固定`, icon: "admin_panel_settings" },
    { label: "ACTIVE (7 DAYS)", title: "近 7 日活躍", value: active7d, unit: "人", sub: `建置者 ${counts.builder} · 一般使用者 ${counts.user}`, icon: "groups" },
    { label: "SUSPENDED", title: "暫停中帳號", value: counts.suspended, unit: "個", sub: counts.suspended ? "無法登入，也無法呼叫平台 API" : "目前沒有暫停的帳號", icon: "person_off", warn: counts.suspended > 0 },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <p className="font-mono text-[11px] text-outline">系統管理與治理 › <span className="text-on-surface">帳號與存取權限</span></p>
      <section className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">帳號與存取權限管理
            <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Google Workspace 登入</span>
            <span className="chip">{users.length} 個帳號</span>
          </h1>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            同仁以院內 Google 帳號登入後即出現在此，預設為「一般使用者」（只能使用已發布的 Agent）。管理員可調整角色、暫停帳號，或在同仁首次登入前先登錄其角色。
            所有角色與狀態變更都需填寫原因，並寫入資安審計軌跡。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv} disabled={exporting || !dir}>{exporting ? <Spinner /> : <Icon name="download" className="text-[18px]" />}匯出帳號清冊 (CSV)</button>
          <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="person_add" className="text-[18px]" />預先登錄同仁</button>
        </div>
      </section>

      <ErrorBox msg={err} />

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card flex items-start justify-between px-5 py-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-outline">{t.label}</p>
              <p className="text-sm font-semibold">{t.title}</p>
              <p className={`mt-2 text-3xl font-bold ${t.warn ? "text-error" : "text-primary-dark"}`}>{dir ? t.value : "—"} <span className="text-sm font-medium text-on-surface-variant">{t.unit}</span></p>
              <p className="mt-1 text-xs text-on-surface-variant">{t.sub}</p>
            </div>
            <span className={`grid h-10 w-10 place-items-center rounded-lg ${t.warn ? "bg-error-container text-error" : "bg-primary-tint text-primary"}`}><Icon name={t.icon} /></span>
          </div>
        ))}
      </section>

      <section className="card mt-5 px-6 py-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name="domain_verification" /></span>
          <div>
            <h2 className="section-title">Google Workspace 允許登入網域</h2>
            <p className="text-xs text-on-surface-variant">只有下列網域的 Google 帳號能登入平台。網域清單由部署設定（ALLOWED_DOMAINS）管理，需變更請由資訊室重新部署，避免誤操作開放或鎖住平台。</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {(dir?.domains ?? []).map((d, i) => (
            <div key={d.domain} className={`rounded-lg border px-4 py-3 ${i === 0 ? "border-primary/40 bg-primary-tint/40" : "border-hairline"}`}>
              <div className="flex items-center justify-between">
                <p className="font-mono text-base font-semibold">@{d.domain}</p>
                <Icon name="verified" className="text-[18px] text-primary" />
              </div>
              <span className="chip mt-1">{i === 0 ? "主要網域" : "允許網域"}</span>
              <p className="mt-2 flex justify-between text-xs text-on-surface-variant"><span>部署設定 · 唯讀</span><b className="font-mono text-on-surface">{d.users} 個帳號</b></p>
            </div>
          ))}
          {dir && dir.domains.length === 0 && <p className="text-sm text-warning">未設定 ALLOWED_DOMAINS：任何 Google 帳號都能登入。</p>}
        </div>
      </section>

      <section className="card mt-5">
        <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-5">
          <div>
            <h2 className="section-title">全院同仁帳號與角色</h2>
            <p className="text-xs text-on-surface-variant">依角色決定可使用的功能：系統管理員、Agent 建置者、一般使用者。</p>
          </div>
          <button className="btn-ghost px-2 text-xs" onClick={load}><Icon name="refresh" className="text-[16px]" />重新整理</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-1 px-6">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${tab === t.id ? "bg-primary-dark text-white" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"}`}>
              {t.label} <span className="opacity-70">({counts[t.id] ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 px-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-2.5 text-[20px] text-outline" />
            <input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋姓名、電子郵件或科別…" />
          </div>
          <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">全部所屬科別</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        </div>

        <div className="mt-4 overflow-x-auto">
          {dir === null ? <div className="grid place-items-center py-16"><Spinner /></div> : rows.length === 0 ? (
            <div className="px-6 pb-6"><Empty icon="group_off" title="沒有符合條件的帳號" hint="調整篩選條件，或預先登錄尚未登入的同仁。" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-y border-hairline bg-surface-container-low text-left font-mono text-[10px] uppercase tracking-wider text-outline">
                <tr><th className="px-6 py-2.5">同仁與帳號</th><th className="px-4 py-2.5">所屬科別</th><th className="px-4 py-2.5">角色</th><th className="px-4 py-2.5">狀態</th><th className="px-4 py-2.5">最後活動</th><th className="px-6 py-2.5 text-right">操作</th></tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.email} className="cursor-pointer border-b border-hairline last:border-0 hover:bg-surface-container-low/60" onClick={() => nav(`/access/${encodeURIComponent(u.email)}`)}>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar u={u} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{u.name || <span className="text-outline">（尚未登入）</span>}{u.bootstrap_admin && <span className="chip ml-1.5" title="ADMIN_EMAILS 部署設定">固定管理員</span>}</p>
                          <p className="truncate font-mono text-[11px] text-on-surface-variant">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{u.department || <span className="text-outline">未設定</span>}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3"><StatusBadge u={u} /></td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-on-surface-variant">{u.last_seen_at ? fmtTime(u.last_seen_at) : u.created_by ? `${fmtTime(u.created_at)} 登錄` : "—"}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-soft px-3 py-1 text-xs" onClick={() => nav(`/access/${encodeURIComponent(u.email)}`)}>編輯權限</button>
                      <button className="btn-ghost ml-1 px-1.5" title="檢視此人的操作審計軌跡" onClick={() => nav(`/audit?q=${encodeURIComponent(u.email)}&range=30d`)}><Icon name="history" className="text-[18px]" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {shown.length > 0 && (
          <div className="flex items-center justify-between border-t border-hairline px-6 py-3 text-xs text-on-surface-variant">
            <span>顯示第 {(page - 1) * PAGE + 1} 至 {Math.min(page * PAGE, shown.length)} 筆，共 {shown.length} 位同仁</span>
            <div className="flex items-center gap-1">
              <button className="btn-ghost px-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><Icon name="chevron_left" className="text-[18px]" /></button>
              <span className="font-mono">{page} / {pages}</span>
              <button className="btn-ghost px-1.5" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><Icon name="chevron_right" className="text-[18px]" /></button>
            </div>
          </div>
        )}
      </section>

      {adding && <Preregister onClose={() => setAdding(false)} onDone={(email) => nav(`/access/${encodeURIComponent(email)}`)} />}
    </div>
  );
}

/** Give someone a role before their first sign-in. The account itself belongs to Google Workspace. */
function Preregister({ onClose, onDone }: { onClose: () => void; onDone: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("builder");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try { const u = await api.preregisterUser(email.trim(), role, department); onDone(u.email); } catch (e) { setErr(String(e)); setBusy(false); }
  };
  return (
    <Modal title="預先登錄同仁" onClose={onClose}>
      <p className="text-xs leading-5 text-on-surface-variant">先為尚未登入的同仁指定角色與科別；對方第一次以院內 Google 帳號登入時就會套用。帳號本身仍由 Google Workspace 管理，這裡不會建立 Google 帳號。</p>
      <label className="label">院內 Google 帳號（電子郵件）</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@vghtc.gov.tw" autoFocus />
      <label className="label">角色</label>
      <div className="grid gap-2">
        {ROLES.map((r) => (
          <button key={r.id} onClick={() => setRole(r.id)} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left ${role === r.id ? "border-primary bg-primary-tint/50" : "border-hairline hover:bg-surface-container-low"}`}>
            <Icon name={role === r.id ? "radio_button_checked" : "radio_button_unchecked"} className={`mt-0.5 text-[18px] ${role === r.id ? "text-primary" : "text-outline"}`} />
            <span><span className="block text-sm font-semibold">{r.label}</span><span className="block text-[11px] text-on-surface-variant">{r.can.join(" · ")}</span></span>
          </button>
        ))}
      </div>
      <label className="label">所屬科別</label>
      <select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="">未設定</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
      <div className="mt-3"><ErrorBox msg={err} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-soft" onClick={onClose}>取消</button>
        <button className="btn-primary" onClick={save} disabled={busy || !email.includes("@")}>{busy ? <Spinner className="border-white border-t-transparent" /> : <Icon name="person_add" className="text-[18px]" />}登錄為{ROLE_LABEL[role]}</button>
      </div>
    </Modal>
  );
}
