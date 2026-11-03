import { TrendUp, TrendDown } from "@phosphor-icons/react";
import { Icon } from "./ui";
function Kpi({ label, title, icon, value, unit, foot, children, tone, onClick }) {
  const err = tone === "error";
  return <div className={`card flex flex-col px-4 py-3 ${onClick ? "cursor-pointer transition-shadow hover:shadow-float" : ""}`} onClick={onClick}>
      <div className="flex items-start justify-between">
        <div><p className="text-[13px] font-semibold">{title}</p><p className="mt-0.5 text-[11px] text-outline-variant">{label}</p></div>
        <span className={`grid h-8 w-8 place-items-center rounded-[10px] ${err ? "bg-error-container text-error" : "bg-surface-container text-on-surface-variant"}`}><Icon name={icon} className="text-[18px]" /></span>
      </div>
      <p className={`mt-2 text-[22px] font-semibold ${err ? "text-error" : "text-on-surface"}`}>{value} <span className="text-xs font-normal text-outline">{unit}</span></p>
      <p className="mt-0.5 text-[11px]">{foot}</p>
      <div className="mt-2 flex-1 rounded-[10px] bg-surface-container-low px-3 py-2 text-xs">{children}</div>
    </div>;
}
const Row = ({ k, v, tone }) => <div className="flex items-center justify-between gap-2 py-0.5"><span className="min-w-0 truncate text-on-surface-variant">{k}</span><span className={`shrink-0 font-mono text-[11px] font-semibold ${tone === "warning" ? "text-warning" : tone === "error" ? "text-error" : "text-on-surface"}`}>{v}</span></div>;
const Delta = ({ pct, invert = false }) => {
  if (pct == null) return <span className="font-mono text-[11px] text-outline">無上期資料</span>;
  const good = invert ? pct <= 0 : pct >= 0;
  return <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold ${good ? "text-primary" : "text-error"}`}>{pct >= 0 ? <TrendUp size={13} /> : <TrendDown size={13} />}{pct >= 0 ? "+" : ""}{pct}%</span>;
};
export {
  Delta,
  Kpi,
  Row
};
