import type { ReactNode } from "react";

export const Icon = ({ name, className = "", fill = false }: { name: string; className?: string; fill?: boolean }) => (
  <span className={`icon ${fill ? "icon-fill" : ""} ${className}`} aria-hidden>{name}</span>
);

export const StatusPill = ({ status, version }: { status: "draft" | "published"; version?: number }) =>
  status === "published" ? (
    <span className="pill bg-primary-tint text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />ACTIVE{version ? ` v${version}` : ""}</span>
  ) : (
    <span className="pill bg-surface-container-high text-on-surface-variant"><span className="h-1.5 w-1.5 rounded-full bg-outline" />DRAFT（草稿）</span>
  );

export const Field = ({ label, hint, children, right }: { label: string; hint?: string; children: ReactNode; right?: ReactNode }) => (
  <div>
    <div className="flex items-end justify-between"><label className="label">{label}</label>{right}</div>
    {children}
    {hint && <p className="mt-1 text-[11px] text-outline">{hint}</p>}
  </div>
);

export const Spinner = ({ className = "" }: { className?: string }) => (
  <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent ${className}`} />
);

export const Empty = ({ icon, title, hint, action }: { icon: string; title: string; hint?: string; action?: ReactNode }) => (
  <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
    <Icon name={icon} className="text-[40px] text-outline-variant" />
    <p className="font-semibold">{title}</p>
    {hint && <p className="text-sm text-on-surface-variant">{hint}</p>}
    {action}
  </div>
);

export const ErrorBox = ({ msg }: { msg: string }) =>
  msg ? <div className="rounded border border-error/30 bg-error-container/40 px-3 py-2 text-xs text-on-error-container">{msg}</div> : null;

export const fmtTime = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "剛剛";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleDateString("zh-TW");
};

export const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`);

export const CATEGORY_ICON: Record<string, string> = { clinical: "cardiology", admin: "campaign", consultation: "diversity_3" };

export const Modal = ({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) => (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
    <div className={`card flex max-h-[85vh] w-full flex-col ${wide ? "max-w-4xl" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <p className="font-bold">{title}</p>
        <button className="btn-ghost px-1" onClick={onClose} aria-label="關閉"><Icon name="close" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
    </div>
  </div>
);
