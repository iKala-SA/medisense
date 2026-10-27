import { idToken } from "./firebase";
import { MOCK, mockApi } from "./mock";
import type { ActionSpec, AgentIn, AgentOut, AgentUsageRow, AuditPage, AuditQuery, AuditSummary, ConnectorIn, ConnectorOut, ConnectorStats, ConnectorTypes, Flow, HubStats, SandboxActivity, UserDetail, UserDirectory, UserPatch, Role, DocCategory, KnowledgeDoc, Me, ModelGroupInfo, MonitoringQuery, MonitoringSummary, RunResponse, TestResult, UsageSort } from "./types";

async function call<T>(path: string, init: RequestInit = {}, json = true): Promise<T> {
  const token = await idToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...((init.headers as Record<string, string>) || {}) };
  if (json) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let detail = await res.text();
    try { detail = JSON.parse(detail).detail ?? detail; } catch { /* plain text */ }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const qs = (q: MonitoringQuery) => new URLSearchParams({ from: q.from, to: q.to, department: q.department }).toString();

/** Only non-empty filters go on the wire. */
const auditQs = (q: AuditQuery, extra: Record<string, string> = {}) =>
  new URLSearchParams(Object.entries({ ...q, ...extra }).filter(([, v]) => v !== "")).toString();
/** CSV downloads need the bearer token, so they are fetched as a Blob and saved client-side. */
const blob = async (path: string) => {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${await idToken()}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.blob();
};

const realApi = {
  me: () => call<Me>("/api/me"),
  modelGroups: () => call<{ groups: ModelGroupInfo[] }>("/api/models"),
  stats: () => call<HubStats>("/api/agents/stats"),
  listAgents: () => call<AgentOut[]>("/api/agents"),
  getAgent: (id: string) => call<AgentOut>(`/api/agents/${id}`),
  createAgent: (body: AgentIn) => call<AgentOut>("/api/agents", { method: "POST", body: JSON.stringify(body) }),
  updateAgent: (id: string, body: AgentIn) => call<AgentOut>(`/api/agents/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  validate: (flow: Flow) => call<{ problems: string[] }>("/api/agents/validate", { method: "POST", body: JSON.stringify(flow) }),
  publishAgent: (id: string) => call<AgentOut>(`/api/agents/${id}/publish`, { method: "POST" }), // admin only
  requestPublish: (id: string) => call<AgentOut>(`/api/agents/${id}/publish-request`, { method: "POST" }),
  withdrawPublish: (id: string) => call<AgentOut>(`/api/agents/${id}/publish-request/withdraw`, { method: "POST" }),
  reviewAgent: (id: string, approve: boolean, reason = "") =>
    call<AgentOut>(`/api/agents/${id}/review`, { method: "POST", body: JSON.stringify({ approve, reason }) }),
  reviewQueue: () => call<AgentOut[]>("/api/agents/reviews"),
  sandboxActivity: () => call<SandboxActivity>("/api/agents/activity"),
  unpublishAgent: (id: string) => call<AgentOut>(`/api/agents/${id}/unpublish`, { method: "POST" }),
  deleteAgent: (id: string) => call<void>(`/api/agents/${id}`, { method: "DELETE" }),
  run: (id: string, message: string, session_id?: string, use_published = false, version?: number) =>
    call<RunResponse>(`/api/agents/${id}/run`, { method: "POST", body: JSON.stringify({ message, session_id, use_published, version }) }),
  approve: (id: string, session_id: string, approve: boolean) =>
    call<RunResponse>(`/api/agents/${id}/approve`, { method: "POST", body: JSON.stringify({ session_id, approve }) }),
  listDocs: () => call<KnowledgeDoc[]>("/api/knowledge"),
  uploadDoc: (file: File, category: DocCategory, department: string) => {
    const fd = new FormData();
    fd.append("file", file); fd.append("category", category); fd.append("department", department);
    return call<KnowledgeDoc>("/api/knowledge", { method: "POST", body: fd }, false);
  },
  replaceDoc: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return call<KnowledgeDoc>(`/api/knowledge/${id}/version`, { method: "POST", body: fd }, false);
  },
  updateDoc: (id: string, category: DocCategory, department: string) =>
    call<KnowledgeDoc>(`/api/knowledge/${id}`, { method: "PATCH", body: JSON.stringify({ category, department }) }),
  reindexDoc: (id: string) => call<KnowledgeDoc>(`/api/knowledge/${id}/reindex`, { method: "POST" }), // admin only
  deleteDoc: (id: string) => call<void>(`/api/knowledge/${id}`, { method: "DELETE" }),
  /** De-identified text exactly as RAG Engine received it. */
  previewDoc: async (id: string) => {
    const res = await fetch(`/api/knowledge/${id}/preview`, { headers: { Authorization: `Bearer ${await idToken()}` } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.text();
  },
  audit: (q: AuditQuery, cursor?: string | null, limit = 25) => call<AuditPage>(`/api/audit?${auditQs(q, { limit: String(limit), cursor: cursor ?? "" })}`),
  auditSummary: () => call<AuditSummary>("/api/audit/summary"),
  auditCsv: (q: AuditQuery) => blob(`/api/audit/export.csv?${auditQs(q)}`),
  connectorTypes: () => call<ConnectorTypes>("/api/connectors/types"),
  connectorStats: () => call<ConnectorStats>("/api/connectors/stats"),
  listConnectors: () => call<ConnectorOut[]>("/api/connectors"),
  getConnector: (id: string) => call<ConnectorOut>(`/api/connectors/${id}`),
  createConnector: (body: ConnectorIn) => call<ConnectorOut>("/api/connectors", { method: "POST", body: JSON.stringify(body) }),
  updateConnector: (id: string, body: ConnectorIn) => call<ConnectorOut>(`/api/connectors/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  testConnector: (id: string) => call<TestResult>(`/api/connectors/${id}/test`, { method: "POST" }),
  connectorActions: (id: string) => call<ActionSpec[]>(`/api/connectors/${id}/actions`),
  deleteConnector: (id: string) => call<void>(`/api/connectors/${id}`, { method: "DELETE" }),
  monitoringSummary: (q: MonitoringQuery) => call<MonitoringSummary>(`/api/monitoring/summary?${qs(q)}`),
  monitoringAgents: (q: MonitoringQuery, sort: UsageSort) => call<AgentUsageRow[]>(`/api/monitoring/agents?${qs(q)}&sort=${sort}`),
  monitoringCsv: (q: MonitoringQuery) => blob(`/api/monitoring/export.csv?${qs(q)}`),
  listUsers: () => call<UserDirectory>("/api/users"),
  getUser: (email: string) => call<UserDetail>(`/api/users/${encodeURIComponent(email)}`),
  preregisterUser: (email: string, role: Role, department: string) =>
    call<UserDetail>("/api/users", { method: "POST", body: JSON.stringify({ email, role, department }) }),
  updateUser: (email: string, patch: UserPatch) => call<UserDetail>(`/api/users/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  cancelPreregistration: (email: string) => call<void>(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE" }),
  usersCsv: () => blob("/api/users/export.csv"),
};

export const api: typeof realApi = MOCK ? (mockApi as typeof realApi) : realApi;
