import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { auth, signOut } from "./firebase";
import { api } from "./api";
import type { Role } from "./types";
import Shell from "./components/Shell";
import Login from "./pages/Login";
import Hub from "./pages/Hub";
import Studio from "./pages/Studio";
import Sandbox from "./pages/Sandbox";
import SandboxCenter from "./pages/SandboxCenter";
import Knowledge from "./pages/Knowledge";
import Audit from "./pages/Audit";
import Monitoring from "./pages/Monitoring";
import Connectors from "./pages/Connectors";
import ConnectorSetup from "./pages/ConnectorSetup";
import Access from "./pages/Access";
import AccessEdit from "./pages/AccessEdit";
import { Icon, Spinner } from "./components/ui";
import { MOCK, mockUser } from "./mock";

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // null until /api/me answers: routes and the sidebar depend on it, so nothing renders before.
  const [role, setRole] = useState<Role | null>(null);
  const [denied, setDenied] = useState("");

  useEffect(() => (MOCK ? setUser(mockUser as unknown as User) : onAuthStateChanged(auth, setUser)), []);
  useEffect(() => {
    if (!user) return;
    setRole(null); setDenied("");
    api.me().then((m) => setRole(m.role)).catch((e) => setDenied(String(e)));
  }, [user]);

  if (user === undefined) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (!user || (MOCK && window.location.search.includes("login"))) return <Login />;
  if (denied) return <Denied email={user.email ?? ""} msg={denied} />;
  if (role === null) return <div className="grid h-full place-items-center"><Spinner /></div>;

  const builder = role !== "user";
  const gate = (ok: boolean, page: ReactNode) => (ok ? page : <Navigate to="/hub" replace />);
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell user={user} role={role} />}>
          <Route index element={<Navigate to="/hub" replace />} />
          <Route path="/hub" element={<Hub user={user} role={role} />} />
          <Route path="/studio" element={<Navigate to="/hub" replace />} />
          <Route path="/studio/:id" element={gate(builder, <Studio />)} />
          <Route path="/sandbox" element={gate(builder, <SandboxCenter role={role} />)} />
          <Route path="/sandbox/:id" element={<Sandbox role={role} />} />
          <Route path="/connectors" element={gate(builder, <Connectors />)} />
          <Route path="/connectors/new" element={gate(builder, <ConnectorSetup />)} />
          <Route path="/connectors/:id" element={gate(builder, <ConnectorSetup />)} />
          <Route path="/knowledge" element={gate(builder, <Knowledge role={role} />)} />
          <Route path="/audit" element={gate(role === "admin", <Audit />)} />
          <Route path="/monitoring" element={gate(role === "admin", <Monitoring />)} />
          <Route path="/access" element={gate(role === "admin", <Access />)} />
          <Route path="/access/:email" element={gate(role === "admin", <AccessEdit />)} />
          <Route path="*" element={<Navigate to="/hub" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

/** Signed in with Google but the platform refuses: suspended account or a domain outside the allow-list. */
function Denied({ email, msg }: { email: string; msg: string }) {
  const suspended = msg.includes("suspended");
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="card max-w-md px-8 py-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-error-container text-error"><Icon name={suspended ? "person_off" : "block"} /></span>
        <h1 className="mt-4 text-xl font-bold">{suspended ? "此帳號已暫停使用" : "無法存取平台"}</h1>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          {suspended ? "管理員已暫停此帳號的平台存取權限。如需恢復，請聯絡資訊室。" : "此帳號目前無法使用平台，請確認以院內公務帳號登入。"}
        </p>
        <p className="mt-3 font-mono text-[11px] text-outline">{email} · {msg}</p>
        <div className="mt-5 flex justify-center gap-2">
          {!msg.startsWith("403") && <button className="btn-soft" onClick={() => window.location.reload()}><Icon name="refresh" className="text-[18px]" />重新整理</button>}
          <button className="btn-secondary" onClick={() => signOut()}><Icon name="logout" className="text-[18px]" />登出並改用其他帳號</button>
        </div>
      </div>
    </div>
  );
}
