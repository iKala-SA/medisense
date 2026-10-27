import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import type { User } from "firebase/auth";
import { signOut } from "../firebase";
import { MOCK } from "../mock";
import type { Role } from "../types";
import { Icon } from "./ui";

// `min` = lowest role that sees the item (user < builder < admin). Run-only users get the Hub only.
const RANK: Record<Role, number> = { user: 0, builder: 1, admin: 2 };
type NavItem = { group: string } | { to: string; icon: string; label: string; min: Role };
const NAV: NavItem[] = [
  { group: "院區智能總覽" },
  { to: "/hub", icon: "hub", label: "Agent Hub / 我的工作台", min: "user" },
  { to: "/connectors", icon: "cable", label: "Connectors 連接器", min: "builder" },
  { to: "/sandbox", icon: "rocket_launch", label: "沙盒測試與發布中心", min: "builder" },
  { to: "/monitoring", icon: "monitoring", label: "Agent 監控與成本", min: "admin" },
  { group: "治理與臨床指引" },
  { to: "/knowledge", icon: "menu_book", label: "院內指引與醫學知識庫", min: "builder" },
  { to: "/audit", icon: "shield", label: "資安審計與推論軌跡", min: "admin" },
  { to: "/access", icon: "manage_accounts", label: "帳號與存取權限", min: "admin" },
];

const sees = (role: Role, n: { min: Role }) => RANK[role] >= RANK[n.min];
/** Items under the group header at `i`, up to the next header (headers with nothing visible are hidden). */
const groupItems = (i: number) => {
  const end = NAV.findIndex((x, j) => j > i && "group" in x);
  return NAV.slice(i + 1, end < 0 ? undefined : end).filter((x): x is Extract<NavItem, { to: string }> => "to" in x);
};

export default function Shell({ user, role }: { user: User; role: Role }) {
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("nav.collapsed") === "1");
  useEffect(() => localStorage.setItem("nav.collapsed", collapsed ? "1" : "0"), [collapsed]);
  const domain = user.email?.split("@")[1] ?? "";
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-hairline bg-white px-4">
        <button className="flex items-center gap-3 text-left" onClick={() => nav("/hub")}>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-tint text-primary"><Icon name="local_hospital" fill /></span>
          <span className="leading-tight">
            <span className="block text-base font-bold text-primary-dark">中榮 智慧 Agent 工作台</span>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-outline">TCVGH AI Agent Builder Hub</span>
          </span>
        </button>
        <span className="flex-1" />
        <span className="hidden items-center gap-2 rounded-full bg-surface-container-low px-3 py-1 font-mono text-[11px] text-on-surface-variant md:flex">
          <span className="h-2 w-2 rounded-full bg-primary" /> {MOCK ? "MOCK 展示模式（無後端）" : "Vertex AI / Cloud Run 連線正常"}
        </span>
        <div className="flex items-center gap-3 text-right">
          <span className="leading-tight">
            <span className="block text-sm font-semibold">{user.displayName ?? user.email}{role === "admin" ? <span className="chip ml-1">ADMIN</span> : role === "user" && <span className="chip ml-1">一般使用者</span>}</span>
            <span className="block font-mono text-[10px] text-outline">{user.email}</span>
          </span>
          {user.photoURL ? <img src={user.photoURL} className="h-9 w-9 rounded-full border border-hairline" alt="" referrerPolicy="no-referrer" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-dark text-white"><Icon name="person" /></span>}
          <button className="btn-ghost px-2" title="登出" onClick={() => signOut()}><Icon name="logout" className="text-[20px]" /></button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className={`hidden shrink-0 flex-col border-r border-hairline bg-white pb-3 transition-[width] duration-200 md:flex ${collapsed ? "w-16 px-2" : "w-60 px-3"}`}>
          {NAV.filter((n, i) => ("to" in n ? sees(role, n) : groupItems(i).some((x) => sees(role, x)))).map((n, i) =>
            "group" in n ? (
              collapsed ? <div key={i} className="mx-auto my-3 h-px w-6 bg-hairline" /> : <div key={i} className="nav-group">{n.group}</div>
            ) : (
              <NavLink key={n.to} to={n.to} title={n.label} className={({ isActive }) => `nav-item ${isActive ? "active" : ""} ${collapsed ? "justify-center px-0" : ""}`}>
                <Icon name={n.icon} className="text-[20px]" />{!collapsed && <span>{n.label}</span>}
              </NavLink>
            ),
          )}
          <span className="flex-1" />
          <button className={`nav-item ${collapsed ? "justify-center px-0" : ""}`} onClick={() => setCollapsed((c) => !c)} title={collapsed ? "展開側邊欄" : "收合側邊欄"}>
            <Icon name={collapsed ? "keyboard_double_arrow_right" : "keyboard_double_arrow_left"} className="text-[20px]" />{!collapsed && <span>收合側邊欄</span>}
          </button>
          {!collapsed && <p className="px-3 pt-1 font-mono text-[10px] text-outline">臺中榮民總醫院 資訊室 · {domain}</p>}
        </aside>
        <main className="min-w-0 flex-1 overflow-auto"><Outlet /></main>
      </div>
    </div>
  );
}
