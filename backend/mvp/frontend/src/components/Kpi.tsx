import type { ReactNode } from "react";
import { Icon } from "./ui";

/** KPI tile shared by the monitoring and audit dashboards. `tone="error"` turns the icon and value red. */
export function Kpi({ label, title, icon, value, unit, foot, children, tone, onClick }: {
  label: string; title: string; icon: string; value: string; unit: string; foot: ReactNode; children: ReactNode;
  tone?: "error"; onClick?: () => void;
}) {
  const err = tone === "error";
  return (
    <div className={`card flex flex-col px-5 py-4 ${onClick ? "cursor-pointer transition-shadow hover:shadow-float" : ""}`} onClick={onClick}>
      <div className="flex items-start justify-between">
        <div><p className="font-mono text-[10px] uppercase tracking-wider text-outline">{label}</p><p className="mt-0.5 text-base font-semibold">{title}</p></div>
        <span className={`grid h-10 w-10 place-items-center rounded-lg ${err ? "bg-error-container text-error" : "bg-primary-tint text-primary"}`}><Icon name={icon} /></span>
      </div>
      <p className={`mt-3 text-3xl font-bold ${err ? "text-error" : "text-primary-dark"}`}>{value} <span className="text-sm font-medium text-on-surface-variant">{unit}</span></p>
      <p className="mt-1 text-xs">{foot}</p>
      <div className="mt-3 flex-1 rounded-lg bg-surface-container-low p-3 text-xs">{children}</div>
    </div>
  );
}

export const Row = ({ k, v, tone }: { k: ReactNode; v: string; tone?: "warning" | "error" }) => (
  <div className="flex items-center justify-between gap-2 py-0.5"><span className="min-w-0 truncate text-on-surface-variant">{k}</span><span className={`shrink-0 font-mono text-[11px] font-semibold ${tone === "warning" ? "text-warning" : tone === "error" ? "text-error" : "text-on-surface"}`}>{v}</span></div>
);

export const Delta = ({ pct, invert = false }: { pct?: number | null; invert?: boolean }) => {
  if (pct == null) return <span className="font-mono text-[11px] text-outline">無上期資料</span>;
  const good = invert ? pct <= 0 : pct >= 0;
  return <span className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold ${good ? "text-primary" : "text-error"}`}><Icon name={pct >= 0 ? "trending_up" : "trending_down"} className="text-[14px]" />{pct >= 0 ? "+" : ""}{pct}%</span>;
};
