import { useState } from "react";
import { signInWithGoogle } from "../firebase";
import { ErrorBox, Icon } from "../components/ui";

const DOMAIN = import.meta.env.VITE_ALLOWED_DOMAIN || "vghtc.gov.tw";

export default function Login() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr("");
    try { await signInWithGoogle(); } catch (e) {
      // Suspending an account also disables its Firebase user (routers/users.py).
      setErr(String(e).includes("auth/user-disabled") ? "此帳號已被管理員暫停使用，如需恢復請聯絡資訊室。" : String(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_1px_1px,#dfe3e2_1px,transparent_0)] [background-size:28px_28px]">
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-tint text-primary"><Icon name="local_hospital" fill /></span>
          <div className="leading-tight">
            <p className="text-lg font-bold">臺中榮民總醫院 <span className="ml-2 font-mono text-xs font-medium uppercase tracking-wider text-outline">Taichung Veterans General Hospital</span></p>
            <p className="text-xs text-on-surface-variant">智慧醫療創新中心 · 臨床人工智慧協作工作台</p>
          </div>
        </div>
        <span className="hidden items-center gap-3 rounded-full bg-white px-4 py-1.5 font-mono text-[11px] text-on-surface-variant shadow-card md:flex">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />GWS SSO 連線正常</span>·
          <span className="flex items-center gap-1"><Icon name="lock" className="text-[14px]" />HIPAA / ISO 27001 白名單防護</span>
        </span>
      </header>
      <div className="mx-auto grid max-w-6xl gap-12 px-8 py-10 lg:grid-cols-2 lg:items-center">
        <section>
          <span className="chip mb-5"><Icon name="verified" className="text-[14px]" />TCVGH AI AGENT BUILDER HUB v0.4</span>
          <h1 className="text-4xl font-bold leading-tight">智慧醫療 Agent 平台</h1>
          <p className="mt-3 text-xl font-semibold text-primary-dark">全院醫事與行政同仁專屬 · 臨床智慧代理人協作入口</p>
          <p className="mt-4 max-w-xl text-sm leading-6 text-on-surface-variant">
            以免程式碼方式組裝臨床與行政 Agent：掛載院內指引知識庫（RAG）、串接 Vertex AI 大型語言模型，病患資料先去識別化再推論，貫徹醫學中心高規格資安守則。
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[["免程式碼", "No-Code", "拖拉式工作流"], ["知識庫", "RAG", "院內指引掛載"], ["去識別化", "Option B", "推論前遮蔽 PHI"]].map(([a, b, c]) => (
              <div key={a} className="card px-4 py-3"><p className="font-mono text-[10px] text-outline">{a}</p><p className="text-xl font-bold text-primary-dark">{b}</p><p className="text-xs text-on-surface-variant">{c}</p></div>
            ))}
          </div>
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-hairline bg-white/70 px-4 py-3 text-xs text-on-surface-variant">
            <Icon name="verified_user" className="text-primary" />
            <p><b className="text-on-surface">單一簽入 (SSO) 認證聲明</b><br />本系統僅限持有 <span className="font-mono text-primary">@{DOMAIN}</span> 院內公務電子郵件帳號之同仁登入存取。</p>
          </div>
        </section>
        <section className="card overflow-hidden border-t-4 border-t-primary">
          <div className="p-7">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name="passkey" /></span>
                <div><p className="text-lg font-bold">公務身分單一簽入</p><p className="font-mono text-[11px] text-outline">GWS SSO Verified · 醫學中心資安防護規範</p></div>
              </div>
              <span className="chip"><Icon name="shield" className="text-[14px]" />SSL 256-bit</span>
            </div>
            <button className="mt-6 flex w-full items-center gap-4 rounded-lg border border-hairline bg-surface-container-low px-5 py-4 text-left transition-colors hover:border-primary hover:bg-primary-tint disabled:opacity-60" onClick={go} disabled={busy}>
              <svg width="26" height="26" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.8l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-3.9-13.5-9.3l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
              <span className="flex-1"><span className="block text-base font-bold">以院內公務 Google 帳號登入</span><span className="block font-mono text-[11px] text-outline">Sign in with Google Workspace</span></span>
              <Icon name="arrow_forward" className="text-primary" />
            </button>
            <p className="mt-2 flex justify-between font-mono text-[11px] text-outline"><span>規範帳號：<span className="text-primary">代碼@{DOMAIN}</span></span><span>範例：dr_lin@{DOMAIN}</span></p>
            {err && <div className="mt-4"><ErrorBox msg={err} /></div>}
            <div className="mt-6 rounded-lg bg-surface-container-low px-4 py-3 text-xs text-on-surface-variant">
              <p className="flex items-center gap-2 font-semibold text-on-surface"><Icon name="key" className="text-[16px]" />強制啟用兩步驟動態驗證 (2-Step Verification) <span className="chip">MFA Required</span></p>
              <p className="mt-1">依醫療機構特權帳號規範，登入時由 Google Workspace 發送提示、FIDO2 金鑰或 Authenticator 驗證碼至您的註冊公務裝置。</p>
            </div>
          </div>
          <div className="flex justify-between border-t border-hairline bg-surface-container-low px-7 py-3 font-mono text-[10px] text-outline">
            <span>GWS 權限申請與帳號解鎖求助 · 分機 2108 / 2109（資訊室）</span><span>asia-east1</span>
          </div>
        </section>
      </div>
    </div>
  );
}
