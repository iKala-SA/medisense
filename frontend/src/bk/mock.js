import { auth } from "./firebase";
import { emptyAgent } from "./types";
import connectorTypes from "./connectorTypes.json";
const MOCK = import.meta.env.VITE_BK_PREVIEW === "1";
const mockUser = { uid: "u-lin", email: "chlin@vghtc.gov.tw", displayName: "\u6797\u5FD7\u8C6A \u4E3B\u6CBB\u91AB\u5E2B", photoURL: null };
const currentUid = () => MOCK ? mockUser.uid : auth.currentUser?.uid;
const currentName = () => MOCK ? mockUser.displayName : auth.currentUser?.displayName;
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
const mk = (id, p) => ({
  ...emptyAgent(),
  id,
  owner_uid: "u-lin",
  owner_email: mockUser.email,
  status: "draft",
  version: 0,
  updated_at: ago(2),
  ...p,
  knowledge_count: (p.knowledge_doc_ids ?? []).length
});
let agents = [
  mk("ag-cardio-094", {
    name: "\u5FC3\u81DF\u5167\u79D1\u51FA\u9662\u75C5\u6B77\u667A\u6167\u6574\u7406 Agent",
    department: "\u5FC3\u81DF\u8840\u7BA1\u4E2D\u5FC3",
    code: "CARD-801",
    status: "published",
    version: 3,
    knowledge_doc_ids: ["d-acs", "d-lex"],
    model_group: "reasoning",
    description: "\u81EA\u52D5\u7D71\u6574\u51A0\u72C0\u52D5\u8108\u651D\u5F71\u7D00\u9304\u3001\u5FC3\u5C0E\u7BA1\u4ECB\u5165\u8655\u7F6E (PCI) \u6578\u64DA\u8207\u5FC3\u81DF\u8D85\u97F3\u6CE2\u5831\u544A\uFF0C\u6A19\u6E96\u5316\u8F49\u8B6F\u70BA\u4E2D\u69AE ICD-10 \u51FA\u9662\u6458\u8981\u3002",
    published_at: ago(5),
    test_cases: [{ title: "\u6848\u4F8B 1\uFF1A\u6025\u6027\u5FC3\u808C\u6897\u585E (AMI) \u8853\u5F8C\u7B2C5\u5929\u75C5\u6B77", message: "\u8ACB\u5E6B\u6211\u6574\u7406\u75C5\u6B77\u865F #8839201 \u7684\u5FC3\u5C0E\u7BA1\u624B\u8853\u7D00\u9304\u8207\u6628\u5929\u7684 Echo \u5831\u544A\uFF0C\u751F\u6210\u51FA\u9662\u885B\u6559\u91CD\u9EDE\u3002" }]
  }),
  mk("ag-nur-104", { name: "\u9580\u8A3A\u885B\u6559\u5373\u6642\u554F\u7B54\u52A9\u624B", department: "\u8B77\u7406\u90E8", code: "NUR-104", status: "published", version: 1, category: "admin", owner_uid: "u-other", owner_email: "nurse@vghtc.gov.tw", updated_at: ago(4), knowledge_doc_ids: ["d-push"] }),
  mk("ag-er-023", { name: "\u6025\u8A3A\u6AA2\u50B7\u6D41\u75C5\u5FEB\u901F\u6BD4\u5C0D Agent", department: "\u6025\u8A3A\u91AB\u5B78\u90E8", code: "ER-023", status: "published", version: 2, owner_uid: "u-other", owner_email: "er@vghtc.gov.tw", updated_at: ago(20), knowledge_doc_ids: ["d-ttas", "d-acs", "d-abx"] }),
  mk("ag-rad-302", { name: "\u653E\u5C04\u79D1\u5F71\u50CF\u5831\u544A\u7D50\u69CB\u5316\u5DE5\u5177", department: "\u653E\u5C04\u7DDA\u90E8", code: "RAD-302", updated_at: ago(72) }),
  mk("ag-endo-509", { name: "\u7CD6\u5C3F\u75C5\u5171\u540C\u7167\u8B77\u8FFD\u8E64\u52A9\u7406", department: "\u65B0\u9673\u4EE3\u8B1D\u79D1", code: "DM-509", status: "published", version: 1, category: "consultation", updated_at: ago(120), knowledge_doc_ids: ["d-dkd"] }),
  mk("ag-icc-018", {
    name: "\u9662\u5167\u611F\u67D3\u7BA1\u5236\u611F\u63A7\u901A\u5831 Agent",
    department: "\u611F\u67D3\u7BA1\u5236\u4E2D\u5FC3",
    code: "ICC-018",
    updated_at: ago(168),
    review: { state: "rejected", version: 1, requested_by_email: mockUser.email, requested_at: ago(30), reason: "\u901A\u5831\u6D41\u7A0B\u7F3A\u5C11\u611F\u63A7\u8B77\u7406\u5E2B\u6838\u51C6\u7BC0\u9EDE\uFF0C\u8ACB\u88DC\u4E0A\u5F8C\u518D\u7533\u8ACB\u3002", decided_by_email: "it-admin@vghtc.gov.tw", decided_at: ago(26) }
  }),
  mk("ag-pharm-212", {
    name: "\u5FC3\u8870\u7AED\u7528\u85E5\u4EA4\u4E92\u4F5C\u7528\u8B66\u793A Agent",
    department: "\u85E5\u5291\u90E8",
    code: "PHA-212",
    owner_uid: "u-pha",
    owner_email: "pharm@vghtc.gov.tw",
    updated_at: ago(6),
    knowledge_doc_ids: ["d-abx", "d-dkd"],
    description: "\u6BD4\u5C0D ACEI / ARNI / MRA \u4F75\u7528\u8207\u814E\u529F\u80FD\u3001\u8840\u9240\u6578\u503C\uFF0C\u63D0\u793A\u7981\u5FCC\u8207\u5291\u91CF\u8ABF\u6574\u3002",
    review: { state: "pending", version: 1, requested_by_email: "pharm@vghtc.gov.tw", requested_at: ago(6), reason: "", decided_by_email: "", decided_at: null }
  })
];
agents = agents.map((a) => a.status === "published" && !a.approved_by_email ? { ...a, approved_by_email: "it-admin@vghtc.gov.tw", approved_at: a.published_at ?? a.updated_at } : a);
const D = (id, name, category, department, mb, by, h, extra = {}) => ({
  id,
  name,
  category,
  department,
  content_type: name.endsWith(".pdf") ? "application/pdf" : "text/plain",
  size_bytes: mb * 1e6,
  chars: Math.round(mb * 42e3),
  version: 1,
  status: "indexed",
  error: "",
  uploaded_by: by,
  uploaded_uid: by === mockUser.email ? mockUser.uid : "u-other",
  created_at: ago(h),
  updated_at: ago(h),
  agents: [],
  ...extra
});
let docs = [
  D("d-acs", "\u81FA\u4E2D\u69AE\u7E3D 2024 \u6025\u6027\u51A0\u5FC3\u75C7 (ACS) \u81E8\u5E8A\u8A3A\u65B7\u8207\u8655\u65B9\u8655\u7F6E\u5E38\u898F\u6307\u5F15\uFF08\u7B2C 7 \u7248\uFF09.pdf", "guideline", "\u5FC3\u81DF\u8840\u7BA1\u4E2D\u5FC3", 6.4, mockUser.email, 30, { version: 7 }),
  D("d-abx", "\u4E2D\u69AE\u91CD\u75C7\u8207\u9662\u5167\u6297\u751F\u7D20\u9078\u7528\u5EFA\u8B70\u6307\u5F15 (v2024.10).pdf", "pharmacy", "\u611F\u67D3\u7BA1\u5236\u4E2D\u5FC3", 12.8, "pharm@vghtc.gov.tw", 50, { version: 2 }),
  D("d-ttas", "\u885B\u798F\u90E8 \u6025\u8A3A\u4E94\u7D1A\u6AA2\u50B7\u5206\u985E (TTAS) \u6A19\u6E96\u4F5C\u696D\u6307\u5F15.pdf", "regulation", "\u6025\u8A3A\u91AB\u5B78\u90E8", 4.2, "er@vghtc.gov.tw", 90),
  D("d-lex", "\u653E\u5C04\u8A3A\u65B7\u79D1 CT \u8207 MRI \u5224\u8B80\u7D50\u69CB\u5316\u8A9E\u610F\u5B57\u5178.docx", "guideline", "\u653E\u5C04\u7DDA\u90E8", 3.1, mockUser.email, 120),
  D("d-dkd", "\u7CD6\u5C3F\u75C5\u814E\u75C5\u8B8A (DKD) SGLT2i \u8207 GLP-1 RA \u806F\u5408\u7528\u85E5\u6307\u5F15 (2024 \u5C08\u5BB6\u5171\u8B58).pdf", "pharmacy", "\u65B0\u9673\u4EE3\u8B1D\u79D1", 5.8, mockUser.email, 20),
  D("d-push", "\u8B77\u7406\u90E8 \u52A0\u8B77\u75C5\u623F\u58D3\u7621\u50B7\u53E3\u7167\u8B77\u8207 PUSH \u8A55\u5206\u81E8\u5E8A\u64CD\u4F5C\u6307\u5F15.pdf", "nursing_sop", "\u8B77\u7406\u90E8", 8.5, "nurse@vghtc.gov.tw", 10),
  D("d-mdt", "\u5168\u9662\u591A\u5C08\u79D1\u764C\u75C7\u8A3A\u7642\u5718\u968A (MDT) \u6668\u6703\u5E38\u898F\u4F5C\u696D\u6E96\u5247.md", "other", "", 1.2, "it-admin@vghtc.gov.tw", 4, { status: "error", error: "422 indexing failed: NoTextError: no extractable text (scanned / image-only file?)" })
];
const withAgents = (d) => ({ ...d, agents: agents.filter((a) => a.knowledge_doc_ids.includes(d.id)).map((a) => ({ id: a.id, name: a.name })) });
const findDoc = (id) => {
  const d = docs.find((x) => x.id === id);
  if (!d) throw new Error("404 document not found");
  return d;
};
const setDoc = (id, f) => {
  const d = f(findDoc(id));
  docs = docs.map((x) => x.id === id ? d : x);
  return delay(withAgents(d), 600);
};
const AUDIT_CAT = {
  "agent.run": "inference",
  "agent.approve": "inference",
  "agent.reject": "inference",
  "connector.invoke": "connector",
  "connector.test": "connector",
  "agent.create": "build",
  "agent.update": "build",
  "agent.publish": "build",
  "agent.unpublish": "build",
  "agent.delete": "build",
  "agent.publish_request": "build",
  "agent.publish_withdraw": "build",
  "agent.publish_approve": "build",
  "agent.publish_reject": "build",
  "knowledge.upload": "build",
  "knowledge.delete": "build",
  "knowledge.error": "build",
  "knowledge.reindex": "build",
  "connector.create": "access",
  "connector.update": "access",
  "connector.delete": "access",
  "monitoring.export": "access",
  "audit.export": "access"
};
const auditSeverity = (action, d) => d.ok === false || action === "knowledge.error" || action === "agent.reject" || action === "agent.publish_reject" ? "warning" : d.ok === true || action === "agent.publish" || action === "agent.approve" || action === "agent.publish_approve" ? "success" : "info";
const AGENT_META = {
  "ag-cardio-094": ["\u5FC3\u81DF\u5167\u79D1\u51FA\u9662\u75C5\u6B77\u667A\u6167\u6574\u7406 Agent", "\u5FC3\u81DF\u8840\u7BA1\u4E2D\u5FC3"],
  "ag-nur-104": ["\u9580\u8A3A\u885B\u6559\u5373\u6642\u554F\u7B54\u52A9\u624B", "\u8B77\u7406\u90E8"],
  "ag-er-023": ["\u6025\u8A3A\u6AA2\u50B7\u6D41\u75C5\u5FEB\u901F\u6BD4\u5C0D Agent", "\u6025\u8A3A\u91AB\u5B78\u90E8"],
  "ag-rad-302": ["\u653E\u5C04\u79D1\u5F71\u50CF\u5831\u544A\u7D50\u69CB\u5316\u5DE5\u5177", "\u653E\u5C04\u7DDA\u90E8"]
};
const CONN_LABEL = { "cn-cardio-mcp": "Cardio-Guidelines Remote MCP Node", "cn-slack-er": "Slack \u8DE8\u79D1\u6025\u8A3A\u8B66\u5831 Bot (\u91AB\u7642\u5C08\u7528)", "cn-his": "TCVGH HIS \u6838\u5FC3\u7CFB\u7D71\u96D9\u5411 Webhook", "cn-teams-nur": "Microsoft Teams \u8B77\u7406\u7AD9\u901A\u77E5" };
const auditEntry = (id, actor, actor_email, action, at, details) => {
  const agentId = String(details.agent_id ?? ""), connId = String(details.connector_id ?? "");
  const agent_label = agentId ? AGENT_META[agentId]?.[0] ?? String(details.name ?? agentId) : "";
  const [target_kind, target_id, target_label] = action.startsWith("connector.") && connId ? ["connector", connId, CONN_LABEL[connId] ?? connId] : agentId ? ["agent", agentId, agent_label] : action.endsWith(".export") ? ["system", "", action === "audit.export" ? "\u7A3D\u6838\u5831\u8868" : "\u76E3\u63A7\u6210\u672C\u5831\u8868"] : ["", "", ""];
  return {
    id,
    actor,
    actor_email,
    action,
    at,
    category: AUDIT_CAT[action] ?? "other",
    severity: auditSeverity(action, details),
    target_kind,
    target_id,
    target_label,
    agent_label,
    department: AGENT_META[agentId]?.[1] ?? "",
    details
  };
};
const STAFF = [["u-lin", mockUser.email], ["u-nur", "nurse@vghtc.gov.tw"], ["u-er", "er@vghtc.gov.tw"], ["u-rad", "rad@vghtc.gov.tw"], ["u-it", "it-admin@vghtc.gov.tw"]];
const STAFF_AGENT = { "u-lin": "ag-cardio-094", "u-nur": "ag-nur-104", "u-er": "ag-er-023", "u-rad": "ag-rad-302", "u-it": "ag-cardio-094" };
const auditLog = (() => {
  let seed = 20261025;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const out = [];
  let h = 0.05;
  for (let i = 0; i < 160 && h < 7 * 24; i++, h += 0.15 + rnd() * 1.6) {
    const [uid, email] = pick(STAFF), ag = STAFF_AGENT[uid], r = rnd();
    const [action, d] = r < 0.42 ? ["agent.run", { agent_id: ag, session_id: `s-${i}`, latency_ms: 600 + Math.floor(rnd() * 2400), models: [pick(["gemini-3-flash-preview", "gemini-3.1-pro-preview"])] }] : r < 0.62 ? (() => {
      const ok = rnd() > 0.12;
      const cn = pick(["cn-cardio-mcp", "cn-cardio-mcp", "cn-slack-er", "cn-teams-nur"]);
      return ["connector.invoke", {
        agent_id: ag,
        connector_id: cn,
        type: cn === "cn-cardio-mcp" ? "mcp" : cn === "cn-slack-er" ? "slack" : "teams",
        connector_action: cn === "cn-cardio-mcp" ? pick(["search_guideline", "drug_dose"]) : "send_message",
        ok,
        error: ok ? "" : pick(["timeout after 15s", "401 token expired"]),
        ...cn === "cn-cardio-mcp" ? { args: { query: "STEMI PCI \u5F8C DAPT \u7642\u7A0B" } } : {}
      }];
    })() : r < 0.68 ? ["agent.approve", { agent_id: ag, session_id: `s-${i}`, node_id: "approval-1" }] : r < 0.71 ? ["agent.reject", { agent_id: ag, session_id: `s-${i}`, node_id: "approval-1" }] : r < 0.79 ? ["agent.update", { agent_id: ag }] : r < 0.83 ? ["agent.publish", { agent_id: ag, version: 1 + Math.floor(rnd() * 4) }] : r < 0.88 ? ["knowledge.upload", { agent_id: ag, file: pick(["\u4E2D\u69AE\u75C5\u6B77\u6A19\u6E96\u8A5E\u5F59\u5EAB v4.0.pdf", "AHA/ACC 2023 ACS Guideline.pdf", "\u9580\u8A3A\u885B\u6559\u624B\u518A 2026.docx"]), bytes: 2e5 + Math.floor(rnd() * 4e6) }] : r < 0.9 ? ["knowledge.error", { agent_id: ag, file: "\u6383\u63CF\u7248\u8B77\u7406\u7D00\u9304.pdf", error: "RAG import failed: unsupported scanned PDF" }] : r < 0.94 ? rnd() > 0.4 ? ["connector.test", { connector_id: "cn-cardio-mcp", ok: true, message: "MCP \u63E1\u624B\u6210\u529F\uFF1Acardio-guidelines \xB7 14 \u500B\u5DE5\u5177" }] : ["connector.test", { connector_id: "cn-his", ok: false, message: "HIS / FHIR \u9598\u9053\u5C1A\u672A\u4E32\u63A5" }] : r < 0.97 ? ["connector.update", { connector_id: pick(["cn-slack-er", "cn-teams-nur"]), credentials_changed: rnd() > 0.5 }] : ["monitoring.export", { range_from: "2026-10-01", range_to: "2026-10-25", department: "", rows: 12 }];
    out.push(auditEntry(`evt-${String(1e3 - i).padStart(4, "0")}`, uid, email, action, ago(h), d));
  }
  return out;
})();
const localDay = (iso) => iso ? ymdLocal(new Date(iso)) : "";
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const auditFilter = (q) => {
  const needle = q.q.trim().toLowerCase();
  return auditLog.filter((e) => {
    const day = localDay(e.at);
    if (day < q.from || day > q.to) return false;
    if (q.category === "alerts" ? e.severity !== "warning" : q.category && e.category !== q.category) return false;
    if (q.severity && e.severity !== q.severity || q.department && e.department !== q.department) return false;
    return !needle || [e.id, e.actor_email, e.action, e.target_id, e.target_label, e.agent_label, e.department, JSON.stringify(e.details)].join(" ").toLowerCase().includes(needle);
  });
};
const auditPage = (q, cursor, limit = 25) => {
  const rows = auditFilter(q);
  const start = cursor ? rows.findIndex((e) => e.id === cursor) + 1 : 0;
  const items = rows.slice(start, start + limit);
  return { items, next_cursor: start + limit < rows.length ? items[items.length - 1].id : null, scanned: rows.length, truncated: false };
};
const auditSummary = () => {
  const today = ymdLocal(/* @__PURE__ */ new Date()), yesterday = ymdLocal(new Date(Date.now() - 864e5));
  const rows = auditLog.filter((e) => localDay(e.at) === today);
  const prev = auditLog.filter((e) => localDay(e.at) === yesterday).length;
  const count = (xs) => Object.entries(xs.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const inv = rows.filter((e) => e.action === "connector.invoke");
  const warn = rows.filter((e) => e.severity === "warning");
  const by_category = {};
  rows.forEach((e) => {
    by_category[e.category] = (by_category[e.category] ?? 0) + 1;
  });
  const distinct = (xs, f) => new Set(xs.map(f)).size;
  return {
    day: today,
    total: rows.length,
    total_yesterday: prev,
    delta_pct: prev ? Math.round((rows.length - prev) / prev * 1e3) / 10 : null,
    by_category,
    connector_calls: inv.length,
    connector_failed: inv.filter((e) => e.details.ok === false).length,
    top_connectors: count(inv.map((e) => e.target_id)).slice(0, 3).map(([key, n]) => ({ key, label: CONN_LABEL[key] ?? key, count: n })),
    warnings: warn.length,
    warning_breakdown: count(warn.map((e) => e.action)).map(([key, n]) => ({ key, label: "", count: n })),
    active_users: distinct(rows, (e) => e.actor),
    run_users: distinct(rows.filter((e) => e.action === "agent.run"), (e) => e.actor),
    build_users: distinct(rows.filter((e) => e.category === "build" || ["connector.create", "connector.update", "connector.delete"].includes(e.action)), (e) => e.actor),
    agents_invoked: distinct(rows.filter((e) => e.action === "agent.run"), (e) => e.target_id),
    capped: false
  };
};
const TYPES = connectorTypes;
const conn = (id, p) => ({
  id,
  type: "mcp",
  label: "",
  scope: "",
  config: {},
  secret_fields: [],
  redact_pii: true,
  audit_payloads: true,
  owner_uid: "u-lin",
  owner_email: mockUser.email,
  status: "active",
  last_test: { ok: true, message: "OK", ms: 14, at: ago(1) },
  agents_count: 0,
  updated_at: ago(3),
  ...p
});
let connectors = [
  conn("cn-cardio-mcp", {
    type: "mcp",
    label: "Cardio-Guidelines Remote MCP Node",
    scope: "\u5FC3\u8840\u7BA1\u4E2D\u5FC3\u7BC0\u9EDE\uFF1A\u6307\u5F15\u8A9E\u7FA9\u6AA2\u7D22\u3001\u85E5\u7269\u5291\u91CF\u63DB\u7B97\u8207\u5C08\u79D1\u8A08\u7B97",
    config: { url: "https://mcp-cardio.vghtc.internal/mcp", auth_kind: "bearer" },
    secret_fields: ["token"],
    agents_count: 3,
    last_test: { ok: true, message: "MCP \u63E1\u624B\u6210\u529F\uFF1Acardio-guidelines \xB7 14 \u500B\u5DE5\u5177", ms: 8, at: ago(1), tools: [{ id: "search_guideline", label: "search_guideline", description: "\u8A9E\u7FA9\u6AA2\u7D22\u5FC3\u81DF\u5B78\u6703\u6307\u5F15" }, { id: "drug_dose", label: "drug_dose", description: "\u4F9D\u9AD4\u91CD\u8207 eGFR \u8A08\u7B97\u5291\u91CF" }] }
  }),
  conn("cn-slack-er", { type: "slack", label: "Slack \u8DE8\u79D1\u6025\u8A3A\u8B66\u5831 Bot (\u91AB\u7642\u5C08\u7528)", scope: "\u6025\u8A3A\u91CD\u75C7\u3001\u5FC3\u5C0E\u7BA1\u5BA4\u7570\u5E38\u8B66\u5831\u5373\u6642\u901A\u77E5", config: { default_channel: "#er-alerts", scopes: ["chat:write", "channels:read"] }, secret_fields: ["webhook_url"], status: "unverified", last_test: null, owner_uid: "u-other", owner_email: "er@vghtc.gov.tw" }),
  conn("cn-his", { type: "his_fhir", label: "TCVGH HIS \u6838\u5FC3\u7CFB\u7D71\u96D9\u5411 Webhook", scope: "\u9580\u8A3A\u5831\u5230\u3001\u5371\u6025\u503C\u958B\u7ACB", config: { base_url: "https://10.120.44.18:9092/fhir" }, status: "error", last_test: { ok: false, message: "HIS / FHIR \u9598\u9053\u5C1A\u672A\u4E32\u63A5", ms: 0, at: ago(2) } }),
  conn("cn-teams-nur", { type: "teams", label: "Microsoft Teams \u8B77\u7406\u7AD9\u901A\u77E5", scope: "\u8B77\u7406\u6392\u73ED\u8207\u503C\u73ED\u547C\u53EB", secret_fields: ["webhook_url"], agents_count: 1 })
];
const PRICE = { "gemini-3-flash-preview": [0.5, 3], "gemini-3.1-pro-preview": [2, 12], "gemini-2.5-flash": [0.3, 2.5] };
const PROFILE = {
  "ag-er-023": { calls: 1340, model: "gemini-3-flash-preview", fb: "gemini-2.5-flash", ms: 190 },
  "ag-cardio-094": { calls: 980, model: "gemini-3.1-pro-preview", fb: "gemini-3-flash-preview", ms: 1180 },
  "ag-nur-104": { calls: 720, model: "gemini-3-flash-preview", fb: "gemini-2.5-flash", ms: 210 },
  "ag-endo-509": { calls: 410, model: "gemini-3-flash-preview", fb: "gemini-2.5-flash", ms: 240 },
  "ag-rad-302": { calls: 160, model: "gemini-3.1-pro-preview", fb: "gemini-3-flash-preview", ms: 960 },
  "ag-icc-018": { calls: 40, model: "gemini-3-flash-preview", fb: "gemini-2.5-flash", ms: 200 }
};
const seeded = (s) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 1e3 / 1e3;
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const days = (from, to) => {
  const out = [];
  for (let d = /* @__PURE__ */ new Date(`${from}T00:00:00`); ymd(d) <= to; d.setDate(d.getDate() + 1)) out.push(ymd(d));
  return out;
};
const usageCell = (aid, day) => {
  const p = PROFILE[aid] ?? { calls: 20, model: "gemini-3-flash-preview", fb: "gemini-2.5-flash", ms: 200 };
  const dow = (/* @__PURE__ */ new Date(`${day}T00:00:00`)).getDay();
  const r = seeded(aid + day);
  const weekend = dow === 0 || dow === 6 ? 0.45 : 1;
  const today = day === ymd(/* @__PURE__ */ new Date()) ? 0.55 : 1;
  const calls = Math.max(1, Math.round(p.calls * weekend * today * (0.8 + r * 0.4)));
  const fallbacks = Math.round(calls * (r > 0.85 ? 0.08 : 0.01));
  const failed = Math.round(calls * 4e-3);
  const pt = calls * (1400 + Math.round(r * 900));
  const ct = calls * (260 + Math.round(r * 220));
  const cost = (m, c) => (c * (pt / calls) * PRICE[m][0] + c * (ct / calls) * PRICE[m][1]) / 1e6;
  const main = calls - fallbacks;
  const slices = [{ model: p.model, requests: main, tokens: Math.round((pt + ct) * main / calls), cost_usd: cost(p.model, main) }];
  if (fallbacks) slices.push({ model: p.fb, requests: fallbacks, tokens: Math.round((pt + ct) * fallbacks / calls), cost_usd: cost(p.fb, fallbacks) });
  return { calls, failed, fallbacks, pt, ct, ms: p.ms * (0.9 + r * 0.3), slices };
};
const inDept = (q) => agents.filter((a) => !q.department || a.department === q.department);
const monitoringSummary = (q) => {
  const span = days(q.from, q.to);
  const list = inDept(q);
  const models = /* @__PURE__ */ new Set();
  const t = { requests: 0, failed: 0, fallbacks: 0, pt: 0, ct: 0, cost: 0, ms: 0 };
  const daily = span.map((day) => {
    const by = {};
    let requests = 0, pt = 0, ct = 0, cost = 0;
    for (const a of list) {
      const u = usageCell(a.id, day);
      requests += u.calls;
      pt += u.pt;
      ct += u.ct;
      t.failed += u.failed;
      t.fallbacks += u.fallbacks;
      t.ms += u.ms * u.calls;
      for (const s of u.slices) {
        models.add(s.model);
        const b = by[s.model] ??= { model: s.model, requests: 0, tokens: 0, cost_usd: 0 };
        b.requests += s.requests;
        b.tokens += s.tokens;
        b.cost_usd += s.cost_usd;
        cost += s.cost_usd;
      }
    }
    t.requests += requests;
    t.pt += pt;
    t.ct += ct;
    t.cost += cost;
    return { date: day, requests, prompt_tokens: pt, completion_tokens: ct, cost_usd: cost, by_model: Object.values(by).sort((x, y) => y.tokens - x.tokens) };
  });
  const prevFrom = /* @__PURE__ */ new Date(`${q.from}T00:00:00`);
  prevFrom.setDate(prevFrom.getDate() - span.length);
  const prevTo = /* @__PURE__ */ new Date(`${q.from}T00:00:00`);
  prevTo.setDate(prevTo.getDate() - 1);
  let pr = 0, ptk = 0, pc = 0;
  for (const day of days(ymd(prevFrom), ymd(prevTo))) for (const a of list) {
    const u = usageCell(a.id, day);
    pr += u.calls;
    ptk += u.pt + u.ct;
    pc += u.slices.reduce((s, x) => s + x.cost_usd, 0);
  }
  const now2 = /* @__PURE__ */ new Date();
  let month = 0;
  for (const day of days(ymd(new Date(now2.getFullYear(), now2.getMonth(), 1)), ymd(now2))) for (const a of agents) month += usageCell(a.id, day).slices.reduce((s, x) => s + x.cost_usd, 0);
  const pct = (c, p) => p > 0 ? Math.round((c - p) / p * 1e3) / 10 : null;
  return {
    range_from: q.from,
    range_to: q.to,
    department: q.department,
    requests: t.requests,
    failed: t.failed,
    fallbacks: t.fallbacks,
    prompt_tokens: t.pt,
    completion_tokens: t.ct,
    cost_usd: t.cost,
    avg_latency_ms: t.requests ? Math.round(t.ms / t.requests) : 0,
    requests_delta_pct: pct(t.requests, pr),
    tokens_delta_pct: pct(t.pt + t.ct, ptk),
    cost_delta_pct: pct(t.cost, pc),
    active_agents: list.length,
    total_agents: agents.length,
    published_agents: agents.filter((a) => a.status === "published").length,
    month_cost_usd: month,
    monthly_budget_usd: 5e3,
    usd_twd_rate: 32,
    daily,
    models: [...models].sort()
  };
};
const monitoringAgents = (q, sort) => {
  const rows = inDept(q).map((a) => {
    let requests = 0, failed = 0, fallbacks = 0, tokens = 0, cost = 0, ms = 0;
    for (const day of days(q.from, q.to)) {
      const u = usageCell(a.id, day);
      requests += u.calls;
      failed += u.failed;
      fallbacks += u.fallbacks;
      tokens += u.pt + u.ct;
      ms += u.ms * u.calls;
      cost += u.slices.reduce((s, x) => s + x.cost_usd, 0);
    }
    return { agent_id: a.id, name: a.name, department: a.department, owner_email: a.owner_email, status: a.status, main_model: (PROFILE[a.id] ?? { model: "gemini-3-flash-preview" }).model, main_group: a.model_group, requests, failed, fallbacks, tokens, cost_usd: cost, avg_latency_ms: requests ? Math.round(ms / requests) : 0 };
  });
  const key = { requests: (r) => -r.requests, tokens: (r) => -r.tokens, cost_usd: (r) => -r.cost_usd, fallbacks: (r) => -r.fallbacks, cost_per_call: (r) => r.requests ? r.cost_usd / r.requests : 1e9, avg_latency_ms: (r) => r.avg_latency_ms || 1e9 };
  return rows.sort((x, y) => key[sort](x) - key[sort](y));
};
const delay = (v, ms = 150) => new Promise((r) => setTimeout(() => r(v), ms));
const now = () => (/* @__PURE__ */ new Date()).toISOString();
const mockRole = () => new URLSearchParams(window.location.search).get("role") ?? "admin";
const U = (email, name, role, department, seenH, p = {}) => ({
  email,
  uid: seenH === null ? "" : `u-${email.split("@")[0]}`,
  name,
  role,
  status: "active",
  department,
  bootstrap_admin: false,
  created_at: ago(24 * 40),
  created_by: "",
  first_login_at: seenH === null ? null : ago(24 * 30),
  last_seen_at: seenH === null ? null : ago(seenH),
  status_reason: "",
  status_changed_at: null,
  status_changed_by: "",
  role_changed_at: null,
  role_changed_by: "",
  ...p
});
let users = [
  U(mockUser.email, mockUser.displayName, "admin", "\u5FC3\u81DF\u8840\u7BA1\u4E2D\u5FC3", 0.02, { bootstrap_admin: true }),
  U("ycchen@vghtc.gov.tw", "\u9673\u7389\u82AC \u8B77\u7406\u9577", "builder", "\u6025\u8A3A\u91AB\u5B78\u90E8", 0.2),
  U("jtlee@vghtc.gov.tw", "\u674E\u4FCA\u5FB7 \u85E5\u5E2B", "builder", "\u85E5\u5291\u90E8", 1.5),
  U("wtko@vghtc.gov.tw", "\u67EF\u5B9B\u5EF7 \u4E3B\u4EFB", "admin", "\u653E\u5C04\u7DDA\u90E8", 3, { role_changed_at: ago(24 * 9), role_changed_by: mockUser.email }),
  U("ylchang@vghtc.gov.tw", "\u5F35\u96C5\u5D50 \u7814\u7A76\u54E1", "user", "\u81E8\u5E8A\u8A66\u9A57\u8207\u8F49\u8B6F\u7814\u7A76\u4E2D\u5FC3", 2),
  U("cwwang@vghtc.gov.tw", "\u738B\u5FD7\u5049 \u67B6\u69CB\u5E2B", "builder", "\u667A\u6167\u91AB\u7642\u7D44 (IT)", 4),
  U("hhtsai@vghtc.gov.tw", "\u8521\u6B23\u6167 \u8B77\u7406\u5E2B", "user", "\u8B77\u7406\u90E8", 26),
  U("mhwu@vghtc.gov.tw", "\u5433\u660E\u8F1D \u91AB\u5E2B", "user", "\u5167\u79D1\u90E8", 24 * 12, { status: "suspended", status_reason: "\u7559\u8077\u505C\u85AA\uFF0C\u66AB\u505C\u5B58\u53D6", status_changed_at: ago(24 * 5), status_changed_by: mockUser.email }),
  U("sylin@vghtc.gov.tw", "", "builder", "\u795E\u7D93\u91AB\u5B78\u4E2D\u5FC3", null, { created_by: mockUser.email, created_at: ago(20) })
];
const findUser = (email) => {
  const u = users.find((x) => x.email === email);
  if (!u) throw new Error("404 user not found");
  return u;
};
const detail = (u) => {
  const own = agents.filter((a) => a.owner_uid === u.uid);
  return { ...u, owned: { agents: own.length, published_agents: own.filter((a) => a.status === "published").length, connectors: u.uid === mockUser.uid ? 2 : 0, documents: u.uid === mockUser.uid ? 3 : 0 } };
};
const setAgent = (id, f) => {
  const a = f(find(id));
  agents = agents.map((x) => x.id === id ? a : x);
  return delay(a);
};
const find = (id) => {
  const a = agents.find((x) => x.id === id);
  if (!a) throw new Error("404 agent not found");
  return a;
};
const mockSkills = [
  { id: "sk-1", name: "院內文件摘要", enabled: true },
  { id: "sk-2", name: "用藥規範查詢", enabled: true },
  { id: "sk-3", name: "交班格式整理", enabled: false },
];
const mockApiExtras = {
  listSkills: async () => mockSkills,
  directory: async (q = "") => ({
    users: [{ email: "wang@vghtc.gov.tw", name: "王雅婷", department: "藥劑部" }, { email: "lin@vghtc.gov.tw", name: "林建宏", department: "心臟科" }].filter((u) => !q || (u.name + u.email).includes(q)),
    groups: [{ id: "g-pharm", name: "藥劑部", description: "", member_count: 12 }, { id: "g-card", name: "心臟科", description: "", member_count: 18 }].filter((g) => !q || g.name.includes(q)),
  }),
  shareAgent: async (id, share) => { const a = agents.find((x) => x.id === id); if (a) a.share = share; return a; },
};
const mockApi = {
  // Same shape /api/models returns from the live LiteLLM proxy (checked 2026-10-26).
  modelGroups: () => delay({ groups: [
    { id: "fast", models: ["gemini-3-flash-preview"], configured: true, fallbacks: [{ name: "gemini-2.5-flash", models: ["gemini-2.5-flash"] }] },
    { id: "reasoning", models: ["gemini-3.1-pro-preview"], configured: true, fallbacks: [{ name: "fast", models: ["gemini-3-flash-preview"] }] },
    { id: "budget", models: ["gemini-3-flash-preview"], configured: true, fallbacks: [{ name: "fast", models: ["gemini-3-flash-preview"] }] },
    { id: "sovereign", models: [], configured: false, fallbacks: [] }
  ] }),
  // `?role=builder` previews the non-admin experience (publish requests instead of direct publish); `?role=user` the run-only one.
  me: () => delay({ uid: mockUser.uid, email: mockUser.email, name: mockUser.displayName, role: mockRole(), department: "\u5FC3\u81DF\u8840\u7BA1\u4E2D\u5FC3" }),
  stats: () => delay({ my_agents: agents.filter((a) => a.owner_uid === "u-lin").length, my_published: 2, hospital_published: agents.filter((a) => a.status === "published").length, runs_today: 1840, knowledge_files: docs.length }),
  listAgents: () => delay(agents.filter((a) => a.owner_uid === "u-lin" || a.status === "published")),
  getAgent: (id) => delay(find(id)),
  createAgent: (body) => {
    const a = mk(`ag-${Math.random().toString(36).slice(2, 7)}`, { ...body, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    agents = [a, ...agents];
    return delay(a);
  },
  updateAgent: (id, body) => {
    const a = { ...find(id), ...body, knowledge_count: body.knowledge_doc_ids.length, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
    agents = agents.map((x) => x.id === id ? a : x);
    return delay(a);
  },
  validate: (flow) => delay({ problems: flow.nodes.some((n) => n.type === "output") ? [] : ["\u7F3A\u5C11\u300C\u56DE\u8986\u300D\u7BC0\u9EDE"] }),
  publishAgent: (id) => setAgent(id, (a) => ({ ...a, status: "published", version: a.version + 1, published_at: now(), approved_by_email: mockUser.email, approved_at: now(), review: null })),
  requestPublish: (id) => setAgent(id, (a) => ({ ...a, review: { state: "pending", version: a.version + 1, requested_by_email: mockUser.email, requested_at: now(), reason: "", decided_by_email: "", decided_at: null } })),
  withdrawPublish: (id) => setAgent(id, (a) => ({ ...a, review: null })),
  reviewAgent: (id, approve, reason = "") => setAgent(id, (a) => approve ? { ...a, status: "published", version: a.review.version, published_at: now(), approved_by_email: mockUser.email, approved_at: now(), review: null } : { ...a, review: { ...a.review, state: "rejected", reason, decided_by_email: mockUser.email, decided_at: now() } }),
  reviewQueue: () => delay(agents.filter((a) => a.review?.state === "pending")),
  sandboxActivity: () => delay({
    runs_today: 1842,
    avg_latency_ms: 1860,
    pending_reviews: agents.filter((a) => a.review?.state === "pending" && (mockRole() === "admin" || a.owner_uid === mockUser.uid)).length,
    capped: false,
    by_agent: Object.fromEntries(agents.map((a, i) => [a.id, { runs: a.status === "published" ? [412, 268, 940, 0, 131][i % 5] : 6 + i * 3, avg_latency_ms: 900 + i * 210 }]))
  }),
  unpublishAgent: (id) => {
    const a = { ...find(id), status: "draft" };
    agents = agents.map((x) => x.id === id ? a : x);
    return delay(a);
  },
  deleteAgent: (id) => {
    agents = agents.filter((x) => x.id !== id);
    return delay(void 0);
  },
  run: (id, message, session_id) => delay({
    session_id: session_id ?? "s1",
    latency_ms: 1180,
    reply: `\u3010\u51FA\u9662\u885B\u6559\u91CD\u9EDE\u6458\u8981\uFF1A\u6025\u6027\u5FC3\u808C\u6897\u585E PCI \u8853\u5F8C\u3011

\u51A0\u72C0\u52D5\u8108\u4ECB\u5165\u6CBB\u7642\u7D00\u9304 (PCI)\uFF1ALAD \u653E\u7F6E DES \u5857\u85E5\u652F\u67B6 (3.0 x 24mm)\uFF0C\u8840\u6D41\u81EA TIMI-1 \u6062\u5FA9\u81F3 TIMI-3\u3002
\u6628\u65E5\u5FC3\u81DF\u8D85\u97F3\u6CE2\uFF1ALVEF 48%\uFF08\u5FC3\u5C16\u524D\u58C1\u6536\u7E2E\u529F\u80FD\u8F15\u5FAE\u6E1B\u640D\uFF09\u3002

\u8B77\u7406\u51FA\u9662\u885B\u6559\u8981\u9EDE\uFF1A
\u2022 \u80A1\u52D5\u8108/\u6A48\u52D5\u8108\u7A7F\u523A\u8655\uFF1A\u8853\u5F8C\u89C0\u5BDF\u7121\u8840\u816B\uFF0C\u907F\u514D\u55AE\u624B\u63D0\u91CD\u7269 (>3kg) 7 \u5929\u3002
\u2022 \u80F8\u75DB\u8B66\u6212\u4FE1\u865F\uFF1A\u82E5\u51FA\u73FE\u58D3\u8FEB\u6027\u80F8\u75DB\u5408\u4F75\u51B7\u6C57\u6216\u8F3B\u5C04\u81F3\u5DE6\u80A9\uFF0C\u9700\u7ACB\u5373\u64A5\u6253 119\u3002
\u2022 \u56DE\u8A3A\u6392\u7A0B\uFF1A\u5FC3\u81DF\u5167\u79D1\u9580\u8A3A\u9810\u7D04\u65BC\u4E0B\u9031\u56DB\u4E0A\u5348 09:30\u3002

\uFF08\u6839\u64DA\u63D0\u554F\uFF1A${message.slice(0, 40)}\uFF09`,
    trace: [{ node_id: "in", type: "input", summary: "\u6536\u5230\u4F7F\u7528\u8005\u8F38\u5165", ms: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 }, { node_id: "kb", type: "knowledge", summary: "\u6AA2\u7D22 2 \u6BB5\u843D\uFF08top_k=5\uFF09", ms: 310, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 }, { node_id: "llm", type: "llm", group: "reasoning", model: "gemini-3.1-pro-preview", summary: "412 \u5B57", ms: 860, prompt_tokens: 2140, completion_tokens: 410, cost_usd: 92e-4 }, { node_id: "out", type: "output", summary: "\u56DE\u8986\u7D44\u88DD\u5B8C\u6210", ms: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 }],
    citations: [{ source: "TCVGH-CV-Guide-v14.pdf", uri: "", score: 0.81, text: "\u2026" }, { source: "AHA/ACC 2023 ACS Guideline.pdf", uri: "", score: 0.74, text: "\u2026" }]
  }, 900),
  approve: (_id, session_id, approve) => delay(approve ? {
    session_id,
    latency_ms: 420,
    reply: "\u2705 \u5DF2\u6838\u51C6\u4E26\u5B8C\u6210\u5F8C\u7E8C\u52D5\u4F5C\uFF1A\u901A\u77E5\u5DF2\u9001\u51FA\u81F3 #er-alerts\u3002",
    citations: [],
    trace: [{ node_id: "ap", type: "approval", summary: "\u5DF2\u7531 Agent \u8CA0\u8CAC\u4EBA\u6838\u51C6\uFF0C\u7E7C\u7E8C\u57F7\u884C", ms: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 }, { node_id: "tool", type: "tool", summary: "Slack \u8DE8\u79D1\u6025\u8A3A\u8B66\u5831 Bot \xB7 post_message \xB7 \u6210\u529F", ms: 380, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 }, { node_id: "out", type: "output", summary: "\u56DE\u8986\u7D44\u88DD\u5B8C\u6210", ms: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 }]
  } : { session_id, latency_ms: 0, reply: "\u5DF2\u62D2\u7D55\u6B64\u6B65\u9A5F\uFF0C\u6D41\u7A0B\u505C\u6B62\u3002", citations: [], trace: [{ node_id: "ap", type: "approval", summary: "\u8CA0\u8CAC\u4EBA\u62D2\u7D55\uFF0C\u6D41\u7A0B\u505C\u6B62", ms: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 }] }, 600),
  listDocs: () => delay(docs.map(withAgents)),
  uploadDoc: (file, category, department) => {
    const d = D(`d-${Date.now()}`, file.name, category, department, file.size / 1e6, mockUser.email, 0);
    docs = [d, ...docs];
    return delay(withAgents(d), 1200);
  },
  replaceDoc: (id, file) => setDoc(id, (d) => ({ ...d, name: file.name, size_bytes: file.size, version: d.version + 1, status: "indexed", error: "", updated_at: now() })),
  updateDoc: (id, category, department) => setDoc(id, (d) => ({ ...d, category, department, updated_at: now() })),
  reindexDoc: (id) => setDoc(id, (d) => ({ ...d, updated_at: now() })),
  deleteDoc: (id) => {
    docs = docs.filter((d) => d.id !== id);
    agents = agents.map((a) => ({ ...a, knowledge_doc_ids: a.knowledge_doc_ids.filter((x) => x !== id), knowledge_count: a.knowledge_doc_ids.filter((x) => x !== id).length }));
    return delay(void 0);
  },
  previewDoc: (id) => delay(`${findDoc(id).name}

\u75C5\u60A3\u59D3\u540D\uFF1A[PERSON_NAME]\uFF0C[GENDER]\uFF0C[AGE]\u6B72\uFF0C\u8EAB\u5206\u8B49 [TAIWAN_ID_NUMBER]\u3002
\u75C5\u6B77\u865F MRN [MEDICAL_RECORD_NUMBER]\uFF0C\u751F\u65E5 [DATE_OF_BIRTH]\uFF0C\u96FB\u8A71 [PHONE_NUMBER]\u3002

\u4E00\u3001\u8A3A\u65B7\u6A19\u6E96
\u2026\u2026\uFF08\u793A\u7BC4\u6587\u5B57\uFF1A\u6B64\u8655\u70BA\u9001\u5165 RAG Engine \u7684\u53BB\u8B58\u5225\u5316\u5167\u5BB9\uFF09`),
  audit: (q, cursor, limit = 25) => delay(auditPage(q, cursor, limit), 250),
  auditSummary: () => delay(auditSummary(), 250),
  auditCsv: (q) => delay(new Blob([`\uFEFFat,event_id,actor_email,action,category,severity,target_label,department
${auditFilter(q).map((e) => [e.at, e.id, e.actor_email, e.action, e.category, e.severity, `"${e.target_label}"`, e.department].join(",")).join("\n")}`], { type: "text/csv" })),
  connectorTypes: () => delay(TYPES),
  connectorStats: () => delay({ connected: connectors.filter((c) => c.status === "active").length, available_types: TYPES.types.filter((t) => t.available).length, invocations_today: 14820, mcp_nodes: 1 }),
  listConnectors: () => delay(connectors),
  getConnector: (id) => {
    const c = connectors.find((x) => x.id === id);
    if (!c) throw new Error("404 connector not found");
    return delay(c);
  },
  createConnector: (b) => {
    const c = conn(`cn-${Math.random().toString(36).slice(2, 7)}`, { ...b, secret_fields: Object.keys(b.secrets).filter((k) => b.secrets[k]), status: "unverified", last_test: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    connectors = [c, ...connectors];
    return delay(c);
  },
  updateConnector: (id, b) => {
    const cur = connectors.find((x) => x.id === id);
    const c = { ...cur, ...b, secret_fields: [.../* @__PURE__ */ new Set([...cur.secret_fields, ...Object.keys(b.secrets).filter((k) => b.secrets[k])])], updated_at: (/* @__PURE__ */ new Date()).toISOString() };
    connectors = connectors.map((x) => x.id === id ? c : x);
    return delay(c);
  },
  testConnector: (id) => {
    const cur = connectors.find((x) => x.id === id);
    const t = TYPES.types.find((x) => x.id === cur.type);
    const r = t.available ? { ok: true, message: cur.type === "mcp" ? "MCP \u63E1\u624B\u6210\u529F\uFF1Ademo \xB7 2 \u500B\u5DE5\u5177" : "\u9023\u7DDA\u6210\u529F", ms: 42, at: (/* @__PURE__ */ new Date()).toISOString(), tools: cur.type === "mcp" ? [{ id: "search_guideline", label: "search_guideline", description: "" }, { id: "drug_dose", label: "drug_dose", description: "" }] : void 0 } : { ok: false, message: t.coming ?? "", ms: 0, at: (/* @__PURE__ */ new Date()).toISOString() };
    connectors = connectors.map((x) => x.id === id ? { ...x, status: r.ok ? "active" : "error", last_test: r } : x);
    return delay(r, 900);
  },
  connectorActions: (id) => {
    const cur = connectors.find((x) => x.id === id);
    const t = TYPES.types.find((x) => x.id === cur.type);
    return delay(t.actions === "dynamic" ? (cur.last_test?.tools ?? []).map((x) => ({ id: x.id, label: x.label, description: x.description, args: [{ key: "query", label: "query", kind: "text" }], write: true })) : t.actions);
  },
  deleteConnector: (id) => {
    connectors = connectors.filter((x) => x.id !== id);
    return delay(void 0);
  },
  monitoringSummary: (q) => delay(monitoringSummary(q), 400),
  monitoringAgents: (q, sort) => delay(monitoringAgents(q, sort), 300),
  monitoringCsv: (q) => delay(new Blob([`\uFEFFagent_id,name,requests,cost_usd
${monitoringAgents(q, "cost_usd").map((r) => `${r.agent_id},${r.name},${r.requests},${r.cost_usd.toFixed(4)}`).join("\n")}`], { type: "text/csv" })),
  listUsers: () => delay({ users, domains: [{ domain: "vghtc.gov.tw", users: users.length }] }),
  getUser: (email) => delay(detail(findUser(email))),
  preregisterUser: (email, role, department) => {
    if (users.some((u2) => u2.email === email.toLowerCase())) throw new Error("409 this e-mail already has an account");
    const u = U(email.toLowerCase(), "", role, department, null, { created_by: mockUser.email, created_at: now() });
    users = [u, ...users];
    return delay(detail(u));
  },
  updateUser: (email, p) => {
    const cur = findUser(email);
    const u = {
      ...cur,
      ...p.department !== void 0 ? { department: p.department } : {},
      ...p.role && p.role !== cur.role ? { role: p.role, role_changed_at: now(), role_changed_by: mockUser.email } : {},
      ...p.status && p.status !== cur.status ? { status: p.status, status_reason: p.reason ?? "", status_changed_at: now(), status_changed_by: mockUser.email } : {}
    };
    users = users.map((x) => x.email === email ? u : x);
    return delay(detail(u));
  },
  cancelPreregistration: (email) => {
    users = users.filter((x) => x.email !== email);
    return delay(void 0);
  },
  usersCsv: () => delay(new Blob([`\uFEFFemail,name,role,status,department
${users.map((u) => [u.email, u.name, u.role, u.status, u.department].join(",")).join("\n")}`], { type: "text/csv" }))
};
Object.assign(mockApi, mockApiExtras);
export {
  MOCK,
  currentName,
  currentUid,
  mockApi,
  mockUser
};
