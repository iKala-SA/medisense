// Mirrors backend/app/schemas.py. Keep the two in sync.
export type ModelGroup = "fast" | "reasoning" | "budget" | "sovereign";
export type NodeType =
  // pii_mask is deprecated (no-op, kept so older canvases load): the platform de-identifies everything itself.
  | "input" | "his_emr" | "pii_mask" | "knowledge" | "llm" | "condition" | "tool" | "approval" | "structured_output" | "output";
export type AgentCategory = "clinical" | "admin" | "consultation";

/** Selectable LiteLLM groups. What each one runs comes live from /api/models (see modelGroups.ts), never hard-coded here. */
export const MODEL_GROUPS: { id: ModelGroup; label: string }[] = [
  { id: "fast", label: "fast · 快速" }, { id: "reasoning", label: "reasoning · 深度推理" },
  { id: "budget", label: "budget · 低成本" }, { id: "sovereign", label: "sovereign · 院內模型（不回退雲端）" },
];
/** Live routing table from LiteLLM: group members and fallback chain. */
export interface ModelGroupInfo { id: ModelGroup; models: string[]; configured: boolean; fallbacks: { name: string; models: string[] }[] }

// Mirrors pick_group in backend/app/engine/flow.py: the cost cap is a ceiling; sovereign is not a cost tier.
const COST_TIER: Record<string, number> = { budget: 0, fast: 1, reasoning: 2 };
export const clampToCap = (group: ModelGroup, cap: RoutingPolicy["max_cost_tier"]): ModelGroup =>
  group in COST_TIER && COST_TIER[group] > COST_TIER[cap] ? cap : group;

// Fixed department list; mirrors DEPARTMENTS in backend/app/schemas.py.
export const DEPARTMENTS = [
  "內科部", "外科部", "急診醫學部", "心臟血管中心", "神經醫學中心", "新陳代謝科", "放射線部", "護理部", "藥劑部",
  "感染管制中心", "臨床試驗與轉譯研究中心", "智慧醫療組 (IT)",
] as const;

export const CATEGORIES: { id: AgentCategory; label: string }[] = [
  { id: "clinical", label: "臨床診療 (Clinical)" },
  { id: "admin", label: "行政與衛教 (Admin & Education)" },
  { id: "consultation", label: "跨科會診 (Consultation)" },
];

/** `retired` kinds are hidden from the palette but still render and edit on older canvases. */
export const NODE_KINDS: { type: NodeType; label: string; icon: string; hint: string; retired?: boolean }[] = [
  { type: "his_emr", label: "HIS/EMR 輸入", icon: "input", hint: "院內 FHIR 閘道（尚未串接，stub）" },
  { type: "knowledge", label: "知識檢索 (RAG)", icon: "manage_search", hint: "從此 Agent 的知識庫檢索段落" },
  { type: "llm", label: "醫療大模型", icon: "psychology", hint: "一次模型推論" },
  { type: "condition", label: "條件判斷", icon: "alt_route", hint: "LLM 回答 YES/NO 決定分支" },
  { type: "structured_output", label: "結構化輸出", icon: "data_object", hint: "依 JSON Schema 輸出" },
  { type: "tool", label: "連接器動作", icon: "extension", hint: "Google Workspace（stub）" },
  // Retired 2026-10-26: publish now needs admin approval. Existing nodes still pause each run for the owner.
  { type: "approval", label: "人工核准", icon: "how_to_reg", hint: "暫停等待主治醫師審核", retired: true },
  // Retired 2026-10-26: the platform de-identifies everything itself; existing nodes are a no-op.
  { type: "pii_mask", label: "敏感資安遮蔽（已停用）", icon: "shield", hint: "平台已自動去識別化", retired: true },
  { type: "output", label: "回覆", icon: "output", hint: "最終回覆模板" },
];

export interface RoutingPolicy {
  reasoning_keywords: string[]; // matched against the user's message only
  sovereign_only: boolean;
  max_cost_tier: "budget" | "fast" | "reasoning";
}

export interface Connector {
  provider: "gmail" | "calendar" | "drive" | "docs";
  scopes: string[];
  requires_approval: boolean;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string | null;
}
export interface Flow { nodes: FlowNode[]; edges: FlowEdge[] }

export interface TestCase { title: string; message: string }

export interface AgentIn {
  name: string;
  description: string;
  instructions: string;
  category: AgentCategory;
  department: string;
  code: string;
  model_group: ModelGroup;
  temperature: number;
  top_p: number;
  routing: RoutingPolicy;
  connectors: Connector[];
  flow: Flow;
  test_cases: TestCase[];
  knowledge_doc_ids: string[]; // attached library documents
}
export interface AgentOut extends AgentIn {
  id: string;
  owner_uid: string;
  owner_email: string;
  status: "draft" | "published";
  version: number;
  rag_corpus?: string | null;
  knowledge_count: number;
  created_at?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
  review?: ReviewState | null;
  approved_by_email?: string;
  approved_at?: string | null;
}
/** Publish request (builders apply, an admin approves). Separate from `status`: v1 stays live while v2 is in review. */
export interface ReviewState {
  state: "pending" | "rejected";
  version: number;
  requested_by_email: string;
  requested_at?: string | null;
  reason: string;
  decided_by_email: string;
  decided_at?: string | null;
}
export interface SandboxActivity {
  runs_today: number;
  avg_latency_ms: number;
  pending_reviews: number;
  by_agent: Record<string, { runs: number; avg_latency_ms: number }>;
  capped: boolean;
}

// Hospital knowledge library (院內指引與醫學知識庫). Mirrors DocCategory in backend/app/schemas.py.
export type DocCategory = "guideline" | "pharmacy" | "nursing_sop" | "regulation" | "other";
export const DOC_CATEGORIES: { id: DocCategory; label: string }[] = [
  { id: "guideline", label: "臨床診療常規指引" }, { id: "pharmacy", label: "藥事與抗生素專冊" },
  { id: "nursing_sop", label: "護理標準作業 SOP" }, { id: "regulation", label: "TFDA / 衛福部法規" }, { id: "other", label: "其他" },
];
/** One library document. Only its de-identified text is indexed; the original stays in the CMEK bucket. */
export interface KnowledgeDoc {
  id: string;
  name: string;
  category: DocCategory;
  department: string;
  content_type: string;
  size_bytes: number;
  chars: number; // length of the de-identified text that was indexed
  version: number;
  status: "indexing" | "indexed" | "error";
  error: string;
  uploaded_by: string;
  uploaded_uid: string;
  created_at?: string | null;
  updated_at?: string | null;
  agents: { id: string; name: string }[];
}

export interface StepTrace {
  node_id: string;
  type: string;
  model?: string | null;
  group?: string | null;
  summary: string;
  ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}
export interface Citation { source: string; uri: string; score?: number | null; text: string }
export interface RunResponse {
  session_id: string;
  reply: string;
  trace: StepTrace[];
  citations: Citation[];
  structured?: Record<string, unknown> | null;
  pending_approval?: { node_id: string; message: string; preview: string } | null;
  latency_ms: number;
}

export type AuditCategory = "inference" | "connector" | "build" | "access" | "other";
export type AuditSeverity = "info" | "success" | "warning";
/** Category, severity, target and department are derived by the backend at read time (backend/app/routers/audit.py). */
export interface AuditEntry {
  id: string;
  actor: string;
  actor_email: string;
  action: string;
  at?: string | null;
  category: AuditCategory;
  severity: AuditSeverity;
  target_kind: "agent" | "connector" | "document" | "user" | "system" | "";
  target_id: string;
  target_label: string;
  agent_label: string;
  department: string;
  details: Record<string, unknown>;
}
export interface AuditPage { items: AuditEntry[]; next_cursor: string | null; scanned: number; truncated: boolean }
/** `category` is an AuditCategory, "alerts" (all warnings) or "" (all). Dates are YYYY-MM-DD, Asia/Taipei. */
export interface AuditQuery { from: string; to: string; category: string; severity: string; department: string; q: string }
export interface AuditCount { key: string; label: string; count: number }
export interface AuditSummary {
  day: string; total: number; total_yesterday: number; delta_pct: number | null;
  by_category: Partial<Record<AuditCategory, number>>;
  connector_calls: number; connector_failed: number; top_connectors: AuditCount[];
  warnings: number; warning_breakdown: AuditCount[];
  active_users: number; run_users: number; build_users: number; agents_invoked: number; capped: boolean;
}

export interface HubStats {
  my_agents: number;
  my_published: number;
  hospital_published: number;
  runs_today: number;
  knowledge_files: number;
}

export type Role = "admin" | "builder" | "user";
export interface Me { uid: string; email: string; name: string; role: Role; department: string }

// ---- accounts & access (admin-only)
export type AccountStatus = "active" | "suspended";
export interface UserOut {
  email: string; uid: string; name: string; role: Role; status: AccountStatus; department: string;
  bootstrap_admin: boolean; // in ADMIN_EMAILS: role and status are fixed by the deployment
  created_at: string | null; created_by: string; first_login_at: string | null; last_seen_at: string | null;
  status_reason: string; status_changed_at: string | null; status_changed_by: string; role_changed_at: string | null; role_changed_by: string;
}
export interface UserDetail extends UserOut { owned: { agents: number; published_agents: number; connectors: number; documents: number } }
/** What each role can really do (shown on the account pages). Order = role cards top to bottom. */
export const ROLES: { id: Role; label: string; en: string; icon: string; desc: string; can: string[] }[] = [
  { id: "admin", label: "系統管理員", en: "Admin", icon: "admin_panel_settings", desc: "可編輯與發布全院任何 Agent、核可發布申請，並檢視監控成本、資安稽核軌跡，管理同仁帳號與權限。", can: ["發布核可", "監控與成本", "資安稽核", "帳號管理"] },
  { id: "builder", label: "Agent 建置者", en: "Builder", icon: "construction", desc: "可在 Agent Studio 建立自己的 Agent、於沙盒測試並申請全院發布，新增連接器與上傳院內知識文件。", can: ["Agent Studio", "申請發布", "連接器", "知識庫上傳"] },
  { id: "user", label: "一般使用者", en: "User", icon: "person", desc: "只能在 Agent Hub 與全院已發布的 Agent 對話，看不到建置、連接器與知識庫功能。新登入的同仁預設為此角色。", can: ["已發布 Agent 對話"] },
];
export const ROLE_LABEL: Record<Role, string> = { admin: "系統管理員", builder: "Agent 建置者", user: "一般使用者" };
export interface UserDirectory { users: UserOut[]; domains: { domain: string; users: number }[] }
export interface UserPatch { role?: Role; status?: AccountStatus; department?: string; reason?: string }

// ---- monitoring (admin-only)
export interface ModelSlice { model: string; requests: number; tokens: number; cost_usd: number }
export interface DailyPoint { date: string; requests: number; prompt_tokens: number; completion_tokens: number; cost_usd: number; by_model: ModelSlice[] }
export interface MonitoringSummary {
  range_from: string; range_to: string; department: string;
  requests: number; failed: number; fallbacks: number; prompt_tokens: number; completion_tokens: number; cost_usd: number; avg_latency_ms: number;
  requests_delta_pct?: number | null; tokens_delta_pct?: number | null; cost_delta_pct?: number | null;
  active_agents: number; total_agents: number; published_agents: number;
  month_cost_usd: number; monthly_budget_usd: number; usd_twd_rate: number;
  daily: DailyPoint[]; models: string[];
}
export interface AgentUsageRow {
  agent_id: string; name: string; department: string; owner_email: string; status: string; main_model: string; main_group: string;
  requests: number; failed: number; fallbacks: number; tokens: number; cost_usd: number; avg_latency_ms: number;
}
export type UsageSort = "requests" | "tokens" | "cost_usd" | "cost_per_call" | "avg_latency_ms" | "fallbacks";
export interface MonitoringQuery { from: string; to: string; department: string }

/** Strip server-managed fields before PUT. */
export const toAgentIn = (a: AgentOut): AgentIn => ({
  name: a.name, description: a.description, instructions: a.instructions, category: a.category,
  department: a.department, code: a.code, model_group: a.model_group, temperature: a.temperature, top_p: a.top_p,
  routing: a.routing, connectors: a.connectors, flow: a.flow, test_cases: a.test_cases, knowledge_doc_ids: a.knowledge_doc_ids ?? [],
});

export const emptyAgent = (): AgentIn => ({
  name: "新的 Agent",
  description: "",
  instructions: "# 角色設定：臺中榮民總醫院 院內助理\n\n你是台中榮總的內部助理。回答精簡、使用繁體中文，引用知識庫時標註來源編號。",
  category: "clinical",
  department: "",
  code: "",
  model_group: "fast",
  temperature: 0.15,
  top_p: 0.85,
  routing: { reasoning_keywords: ["分析", "比較", "規劃", "為什麼"], sovereign_only: false, max_cost_tier: "reasoning" },
  connectors: [],
  flow: {
    nodes: [
      { id: "in", type: "input", position: { x: 40, y: 200 }, data: { label: "使用者輸入" } },
      { id: "kb", type: "knowledge", position: { x: 340, y: 200 }, data: { label: "知識檢索", query: "{{input}}", top_k: 5 } },
      { id: "llm", type: "llm", position: { x: 640, y: 200 }, data: { label: "臨床摘要生成", prompt: "{{input}}" } },
      { id: "out", type: "output", position: { x: 940, y: 200 }, data: { label: "回覆", template: "{{last}}" } },
    ],
    edges: [
      { id: "e-in-kb", source: "in", target: "kb" },
      { id: "e-kb-llm", source: "kb", target: "llm" },
      { id: "e-llm-out", source: "llm", target: "out" },
    ],
  },
  test_cases: [],
  knowledge_doc_ids: [],
});

// ---- connectors (shared, hospital-wide). Specs come from GET /api/connectors/types.
export interface FieldSpec {
  key: string; label: string; kind: "text" | "url" | "secret" | "select" | "textarea" | "checkboxes";
  required: boolean; hint: string; placeholder: string; options: { value: string; label: string; disabled?: boolean }[];
  default: unknown; section: "server" | "credentials";
}
export interface ActionSpec { id: string; label: string; description?: string; args: { key: string; label: string; kind: string; required?: boolean }[]; write: boolean }
export interface ConnectorType {
  id: string; label: string; category: string; protocol: string; icon: string; badge: string; available: boolean; coming?: string;
  description: string; fields: FieldSpec[]; actions: ActionSpec[] | "dynamic";
}
export interface ConnectorTypes { categories: { id: string; label: string }[]; types: ConnectorType[] }
export interface ConnectorIn {
  type: string; label: string; scope: string; config: Record<string, unknown>; secrets: Record<string, string>;
  redact_pii: boolean; audit_payloads: boolean;
}
export interface TestResult { ok: boolean; message: string; ms: number; at?: string; tools?: { id: string; label: string; description: string }[] }
export interface ConnectorOut extends Omit<ConnectorIn, "secrets"> {
  id: string; secret_fields: string[]; owner_uid: string; owner_email: string;
  status: "unverified" | "active" | "error"; last_test?: TestResult | null; agents_count: number;
  created_at?: string | null; updated_at?: string | null;
}
export interface ConnectorStats { connected: number; available_types: number; invocations_today: number; mcp_nodes: number }

