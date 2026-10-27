const Icon = ({ name, className = "", fill = false }) => <span className={`icon ${fill ? "icon-fill" : ""} ${className}`} aria-hidden>{name}</span>;
const StatusPill = ({ status, version }) => status === "published" ? <span className="pill bg-primary-tint text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />ACTIVE{version ? ` v${version}` : ""}</span> : <span className="pill bg-surface-container-high text-on-surface-variant"><span className="h-1.5 w-1.5 rounded-full bg-outline" />DRAFT（草稿）</span>;
const Field = ({ label, hint, children, right }) => <div>
    <div className="flex items-end justify-between"><label className="label">{label}</label>{right}</div>
    {children}
    {hint && <p className="mt-1 text-[11px] text-outline">{hint}</p>}
  </div>;
const Spinner = ({ className = "" }) => <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent ${className}`} />;
const Empty = ({ icon, title, hint, action }) => <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
    <Icon name={icon} className="text-[40px] text-outline-variant" />
    <p className="font-semibold">{title}</p>
    {hint && <p className="text-sm text-on-surface-variant">{hint}</p>}
    {action}
  </div>;
const ErrorBox = ({ msg }) => msg ? <div className="rounded border border-error/30 bg-error-container/40 px-3 py-2 text-xs text-on-error-container">{msg}</div> : null;
const fmtTime = (iso) => {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1e3;
  if (diff < 60) return "\u525B\u525B";
  if (diff < 3600) return `${Math.floor(diff / 60)} \u5206\u9418\u524D`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} \u5C0F\u6642\u524D`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} \u5929\u524D`;
  return d.toLocaleDateString("zh-TW");
};
const fmtBytes = (n) => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`;
const CATEGORY_ICON = { clinical: "cardiology", admin: "campaign", consultation: "diversity_3" };
const Modal = ({ title, onClose, children, wide = false }) => <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
    <div className={`card flex max-h-[85vh] w-full flex-col ${wide ? "max-w-4xl" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <p className="font-bold">{title}</p>
        <button className="btn-ghost px-1" onClick={onClose} aria-label="關閉"><Icon name="close" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
    </div>
  </div>;
export {
  CATEGORY_ICON,
  Empty,
  ErrorBox,
  Field,
  Icon,
  Modal,
  Spinner,
  StatusPill,
  fmtBytes,
  fmtTime
};
