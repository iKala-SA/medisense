import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { DEPARTMENTS, ROLES, ROLE_LABEL, type AccountStatus, type Role, type UserDetail } from "../types";
import { ErrorBox, Icon, Spinner, fmtTime } from "../components/ui";
import { currentUid } from "../mock";
import { Avatar, RoleBadge, StatusBadge } from "./Access";

const STATUSES: { id: AccountStatus; label: string; tag: string; desc: string }[] = [
  { id: "active", label: "正常啟用", tag: "ACTIVE", desc: "可用院內 Google 帳號登入平台，依角色使用 Agent Hub、建置與管理功能。" },
  { id: "suspended", label: "暫停使用", tag: "SUSPENDED", desc: "立即阻擋平台 API（其他伺服器執行個體最多 30 秒內生效），並停用 Google 登入、撤銷登入權杖。Agent、連接器與知識文件保留不動，可隨時恢復。" },
];
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false }) : "—");

export default function AccessEdit() {
  const { email = "" } = useParams();
  const nav = useNavigate();
  const [u, setU] = useState<UserDetail | null>(null);
  const [role, setRole] = useState<Role>("user");
  const [status, setStatus] = useState<AccountStatus>("active");
  const [department, setDepartment] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const reset = (x: UserDetail) => { setU(x); setRole(x.role); setStatus(x.status); setDepartment(x.department); setReason(""); };
  useEffect(() => { api.getUser(email).then(reset).catch((e) => setErr(String(e))); }, [email]);

  if (!u) return <div className="grid h-full place-items-center">{err ? <div className="w-96"><ErrorBox msg={err} /></div> : <Spinner />}</div>;

  const self = !!u.uid && u.uid === currentUid();
  const locked = self || u.bootstrap_admin; // role and status cannot change here
  const accessChanged = role !== u.role || status !== u.status;
  const dirty = accessChanged || department !== u.department;
  const needReason = accessChanged && !reason.trim();

  const save = async () => {
    setBusy(true); setErr(""); setSaved(false);
    try {
      reset(await api.updateUser(u.email, { ...(role !== u.role ? { role } : {}), ...(status !== u.status ? { status } : {}),
        ...(department !== u.department ? { department } : {}), reason: reason.trim() }));
      setSaved(true);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const cancelPrereg = async () => {
    if (!confirm(`取消 ${u.email} 的預先登錄？對方之後登入時會以「一般使用者」建立帳號。`)) return;
    try { await api.cancelPreregistration(u.email); nav("/access"); } catch (e) { setErr(String(e)); }
  };
  const ownsSomething = u.owned.agents + u.owned.connectors + u.owned.documents > 0;

  return (
    <div className="mx-auto max-w-6xl px-6 pt-6">
      <p className="font-mono text-[11px] text-outline">系統管理與治理 › <button className="hover:text-primary" onClick={() => nav("/access")}>帳號與存取權限</button> › <span className="text-on-surface">編輯同仁帳號權限與狀態</span></p>
      <section className="mt-2 flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-5">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold">編輯同仁帳號權限與狀態</h1>
          <p className="mt-1 text-sm text-on-surface-variant">調整同仁在平台上的角色、所屬科別，或暫停其存取。角色與狀態變更需填寫原因，並寫入資安審計軌跡。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-soft" onClick={() => nav("/access")}><Icon name="arrow_back" className="text-[18px]" />返回帳號列表</button>
          <button className="btn-secondary" onClick={() => nav(`/audit?q=${encodeURIComponent(u.email)}&range=30d`)}><Icon name="history" className="text-[18px]" />檢視個人操作審計軌跡</button>
        </div>
      </section>

      <section className="card mt-5 flex flex-wrap items-start gap-5 px-6 py-5">
        <Avatar u={u} big />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{u.name || "（尚未登入）"}</h2>
            <RoleBadge role={u.role} /><StatusBadge u={u} />
            {u.bootstrap_admin && <span className="chip" title="ADMIN_EMAILS">固定管理員（部署設定）</span>}
            {self && <span className="chip">這是您自己的帳號</span>}
          </div>
          <p className="mt-1 flex items-center gap-1 font-mono text-xs text-on-surface-variant"><Icon name="mail" className="text-[15px]" />{u.email}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-on-surface-variant"><Icon name="local_hospital" className="text-[15px]" />所屬科別</span>
            <select className="w-auto py-1 text-xs" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">未設定</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="chip"><Icon name="smart_toy" className="text-[13px]" />{u.owned.agents} 個 Agent（{u.owned.published_agents} 個已發布）</span>
            <span className="chip"><Icon name="cable" className="text-[13px]" />{u.owned.connectors} 個連接器</span>
            <span className="chip"><Icon name="menu_book" className="text-[13px]" />{u.owned.documents} 份知識文件</span>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1.5 rounded-lg bg-surface-container-low px-4 py-3 text-xs">
          <dt className="text-outline">帳號建立</dt><dd className="font-mono">{u.created_by ? `${fmtDate(u.created_at)}（${u.created_by === "migrate_users" ? "既有建置者移轉" : `${u.created_by} 預先登錄`}）` : fmtDate(u.created_at)}</dd>
          <dt className="text-outline">首次登入</dt><dd className="font-mono">{u.first_login_at ? fmtDate(u.first_login_at) : "尚未登入"}</dd>
          <dt className="text-outline">最後活動</dt><dd className="font-mono">{u.last_seen_at ? `${fmtDate(u.last_seen_at)}（${fmtTime(u.last_seen_at)}）` : "—"}</dd>
        </dl>
      </section>

      {locked && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-surface-container-low px-4 py-2.5 text-xs text-on-surface-variant">
          <Icon name="lock" className="text-[16px]" />
          {self ? "不能變更自己的角色與狀態，請由另一位管理員操作。" : "此帳號列在部署設定 ADMIN_EMAILS，永遠是管理員且不能暫停，避免平台被鎖住。需變更請由資訊室重新部署。"}所屬科別仍可修改。
        </p>
      )}

      <section className="card mt-5 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name="toggle_on" /></span>
            <div><h2 className="section-title">帳號狀態</h2><p className="text-xs text-on-surface-variant">暫停會立即阻擋平台存取；恢復後依原角色繼續使用。</p></div>
          </div>
          {u.status_changed_at && (
            <p className="max-w-sm text-right text-[11px] text-on-surface-variant">上次由 {u.status_changed_by} 於 {fmtDate(u.status_changed_at)} 設為{u.status === "suspended" ? "暫停" : "啟用"}{u.status_reason && `：${u.status_reason}`}</p>
          )}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {STATUSES.map((s) => {
            const on = status === s.id, bad = s.id === "suspended";
            return (
              <button key={s.id} disabled={locked} onClick={() => setStatus(s.id)}
                className={`rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? (bad ? "border-error bg-error-container/30" : "border-primary bg-primary-tint/40") : "border-hairline hover:bg-surface-container-low"}`}>
                <span className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold"><Icon name={on ? "radio_button_checked" : "radio_button_unchecked"} className={`text-[20px] ${on ? (bad ? "text-error" : "text-primary") : "text-outline"}`} />{s.label}</span>
                  <span className={`pill ${bad ? "bg-error-container text-on-error-container" : "bg-primary-tint text-primary"}`}>{s.tag}</span>
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-on-surface-variant">{s.desc}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card mt-5 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name="assignment_ind" /></span>
            <div><h2 className="section-title">角色 (RBAC)</h2><p className="text-xs text-on-surface-variant">每位同仁只有一個角色，決定能使用哪些功能。</p></div>
          </div>
          {u.role_changed_at && <p className="text-right text-[11px] text-on-surface-variant">上次由 {u.role_changed_by === "migrate_users" ? "系統移轉" : u.role_changed_by} 於 {fmtDate(u.role_changed_at)} 變更</p>}
        </div>
        <div className="mt-4 grid gap-3">
          {ROLES.map((r) => {
            const on = role === r.id;
            return (
              <button key={r.id} disabled={locked} onClick={() => setRole(r.id)}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-primary bg-primary-tint/40" : "border-hairline hover:bg-surface-container-low"}`}>
                <Icon name={on ? "radio_button_checked" : "radio_button_unchecked"} className={`mt-0.5 text-[20px] ${on ? "text-primary" : "text-outline"}`} />
                <span className="flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-semibold"><Icon name={r.icon} className="text-[18px] text-primary" />{r.label} ({r.en}){r.id === u.role && <span className="pill bg-primary-dark text-white">目前角色</span>}</span>
                  <span className="mt-1 block text-xs leading-5 text-on-surface-variant">{r.desc}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">{r.can.map((c) => <span key={c} className="chip">{c}</span>)}</span>
                </span>
              </button>
            );
          })}
        </div>
        {role === "user" && u.role !== "user" && ownsSomething && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-container px-4 py-2.5 text-xs text-warning">
            <Icon name="info" className="text-[16px]" />
            此人擁有 {u.owned.agents} 個 Agent、{u.owned.connectors} 個連接器與 {u.owned.documents} 份知識文件。改為一般使用者後這些項目仍歸此人所有，但此人無法再編輯；已發布的 Agent 照常上線，管理員仍可編輯。
          </p>
        )}
      </section>

      {accessChanged && (
        <section className="card mt-5 px-6 py-5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1 text-sm font-semibold"><Icon name="edit_note" className="text-[18px]" />變更原因 <span className="text-error">*</span></label>
            <span className="font-mono text-[11px] text-outline">{reason.length} / 200</span>
          </div>
          <textarea className="mt-2 h-20" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：轉調護理部，改為一般使用者；留職停薪，暫停存取。" />
          <p className="mt-1 flex items-center gap-1 text-[11px] text-outline"><Icon name="shield" className="text-[14px]" />原因會連同變更前後的角色或狀態寫入資安審計軌跡。</p>
        </section>
      )}

      {!u.uid && (
        <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline px-6 py-4 text-xs text-on-surface-variant">
          <span>此帳號為預先登錄，對方尚未登入過。如果登錄錯誤，可以直接取消。</span>
          <button className="btn-danger" onClick={cancelPrereg}><Icon name="person_remove" className="text-[18px]" />取消預先登錄</button>
        </section>
      )}

      <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t border-hairline bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-4 px-6 py-3">
          <Icon name="verified_user" className="text-primary" />
          <div className="min-w-0 flex-1 text-sm">
            <p>您正在編輯 <b className="text-primary-dark">{u.name || u.email}</b> 的權限配置
              {dirty && <span className="ml-2 text-xs text-on-surface-variant">
                {[role !== u.role && `角色 ${ROLE_LABEL[u.role]} → ${ROLE_LABEL[role]}`, status !== u.status && (status === "suspended" ? "暫停帳號" : "恢復帳號"), department !== u.department && `科別 → ${department || "未設定"}`].filter(Boolean).join("、")}
              </span>}
            </p>
            {err ? <ErrorBox msg={err} /> : <p className="text-[11px] text-outline">{saved && !dirty ? "已儲存並寫入稽核軌跡。" : needReason ? "變更角色或狀態需要填寫原因。" : "角色與狀態的變更會寫入資安審計軌跡。"}</p>}
          </div>
          <button className="btn-soft" disabled={!dirty || busy} onClick={() => reset(u)}>取消變更</button>
          <button className={status === "suspended" && u.status !== "suspended" ? "btn bg-error text-white hover:bg-error/90" : "btn-primary"} disabled={!dirty || needReason || busy} onClick={save}>
            {busy ? <Spinner className="border-white border-t-transparent" /> : <Icon name="save" className="text-[18px]" />}{status === "suspended" && u.status !== "suspended" ? "確認暫停並儲存" : "確認並儲存變更"}
          </button>
        </div>
      </div>
    </div>
  );
}
