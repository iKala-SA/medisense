const MODEL_GROUPS = [
  { id: "fast", label: "fast \xB7 \u5FEB\u901F" },
  { id: "reasoning", label: "reasoning \xB7 \u6DF1\u5EA6\u63A8\u7406" },
  { id: "budget", label: "budget \xB7 \u4F4E\u6210\u672C" },
  { id: "sovereign", label: "sovereign \xB7 \u9662\u5167\u6A21\u578B\uFF08\u4E0D\u56DE\u9000\u96F2\u7AEF\uFF09" }
];
const COST_TIER = { budget: 0, fast: 1, reasoning: 2 };
const clampToCap = (group, cap) => group in COST_TIER && COST_TIER[group] > COST_TIER[cap] ? cap : group;
const DEPARTMENTS = [
  "\u5167\u79D1\u90E8",
  "\u5916\u79D1\u90E8",
  "\u6025\u8A3A\u91AB\u5B78\u90E8",
  "\u5FC3\u81DF\u8840\u7BA1\u4E2D\u5FC3",
  "\u795E\u7D93\u91AB\u5B78\u4E2D\u5FC3",
  "\u65B0\u9673\u4EE3\u8B1D\u79D1",
  "\u653E\u5C04\u7DDA\u90E8",
  "\u8B77\u7406\u90E8",
  "\u85E5\u5291\u90E8",
  "\u611F\u67D3\u7BA1\u5236\u4E2D\u5FC3",
  "\u81E8\u5E8A\u8A66\u9A57\u8207\u8F49\u8B6F\u7814\u7A76\u4E2D\u5FC3",
  "\u667A\u6167\u91AB\u7642\u7D44 (IT)"
];
const CATEGORIES = [
  { id: "clinical", label: "\u81E8\u5E8A\u8A3A\u7642 (Clinical)" },
  { id: "admin", label: "\u884C\u653F\u8207\u885B\u6559 (Admin & Education)" },
  { id: "consultation", label: "\u8DE8\u79D1\u6703\u8A3A (Consultation)" }
];
const NODE_KINDS = [
  { type: "his_emr", label: "HIS/EMR \u8F38\u5165", icon: "input", hint: "\u9662\u5167 FHIR \u9598\u9053\uFF08\u5C1A\u672A\u4E32\u63A5\uFF0Cstub\uFF09" },
  { type: "knowledge", label: "\u77E5\u8B58\u6AA2\u7D22 (RAG)", icon: "manage_search", hint: "\u5F9E\u6B64 Agent \u7684\u77E5\u8B58\u5EAB\u6AA2\u7D22\u6BB5\u843D" },
  { type: "llm", label: "\u91AB\u7642\u5927\u6A21\u578B", icon: "psychology", hint: "\u4E00\u6B21\u6A21\u578B\u63A8\u8AD6" },
  { type: "condition", label: "\u689D\u4EF6\u5224\u65B7", icon: "alt_route", hint: "LLM \u56DE\u7B54 YES/NO \u6C7A\u5B9A\u5206\u652F" },
  { type: "structured_output", label: "\u7D50\u69CB\u5316\u8F38\u51FA", icon: "data_object", hint: "\u4F9D JSON Schema \u8F38\u51FA" },
  { type: "tool", label: "\u9023\u63A5\u5668\u52D5\u4F5C", icon: "extension", hint: "Google Workspace\uFF08stub\uFF09" },
  // Retired 2026-10-26: publish now needs admin approval. Existing nodes still pause each run for the owner.
  { type: "approval", label: "\u4EBA\u5DE5\u6838\u51C6", icon: "how_to_reg", hint: "\u66AB\u505C\u7B49\u5F85\u4E3B\u6CBB\u91AB\u5E2B\u5BE9\u6838", retired: true },
  // Retired 2026-10-26: the platform de-identifies everything itself; existing nodes are a no-op.
  { type: "pii_mask", label: "\u654F\u611F\u8CC7\u5B89\u906E\u853D\uFF08\u5DF2\u505C\u7528\uFF09", icon: "shield", hint: "\u5E73\u53F0\u5DF2\u81EA\u52D5\u53BB\u8B58\u5225\u5316", retired: true },
  { type: "output", label: "\u56DE\u8986", icon: "output", hint: "\u6700\u7D42\u56DE\u8986\u6A21\u677F" }
];
const DOC_CATEGORIES = [
  { id: "guideline", label: "\u81E8\u5E8A\u8A3A\u7642\u5E38\u898F\u6307\u5F15" },
  { id: "pharmacy", label: "\u85E5\u4E8B\u8207\u6297\u751F\u7D20\u5C08\u518A" },
  { id: "nursing_sop", label: "\u8B77\u7406\u6A19\u6E96\u4F5C\u696D SOP" },
  { id: "regulation", label: "TFDA / \u885B\u798F\u90E8\u6CD5\u898F" },
  { id: "other", label: "\u5176\u4ED6" }
];
const ROLES = [
  { id: "admin", label: "\u7CFB\u7D71\u7BA1\u7406\u54E1", en: "Admin", icon: "admin_panel_settings", desc: "\u53EF\u7DE8\u8F2F\u8207\u767C\u5E03\u5168\u9662\u4EFB\u4F55 Agent\u3001\u6838\u53EF\u767C\u5E03\u7533\u8ACB\uFF0C\u4E26\u6AA2\u8996\u76E3\u63A7\u6210\u672C\u3001\u8CC7\u5B89\u7A3D\u6838\u8ECC\u8DE1\uFF0C\u7BA1\u7406\u540C\u4EC1\u5E33\u865F\u8207\u6B0A\u9650\u3002", can: ["\u767C\u5E03\u6838\u53EF", "\u76E3\u63A7\u8207\u6210\u672C", "\u8CC7\u5B89\u7A3D\u6838", "\u5E33\u865F\u7BA1\u7406"] },
  { id: "builder", label: "Agent \u5EFA\u7F6E\u8005", en: "Builder", icon: "construction", desc: "\u53EF\u5728 Agent Studio \u5EFA\u7ACB\u81EA\u5DF1\u7684 Agent\u3001\u65BC\u6C99\u76D2\u6E2C\u8A66\u4E26\u7533\u8ACB\u5168\u9662\u767C\u5E03\uFF0C\u65B0\u589E\u9023\u63A5\u5668\u8207\u4E0A\u50B3\u9662\u5167\u77E5\u8B58\u6587\u4EF6\u3002", can: ["Agent Studio", "\u7533\u8ACB\u767C\u5E03", "\u9023\u63A5\u5668", "\u77E5\u8B58\u5EAB\u4E0A\u50B3"] },
  { id: "user", label: "\u4E00\u822C\u4F7F\u7528\u8005", en: "User", icon: "person", desc: "\u53EA\u80FD\u5728 Agent Hub \u8207\u5168\u9662\u5DF2\u767C\u5E03\u7684 Agent \u5C0D\u8A71\uFF0C\u770B\u4E0D\u5230\u5EFA\u7F6E\u3001\u9023\u63A5\u5668\u8207\u77E5\u8B58\u5EAB\u529F\u80FD\u3002\u65B0\u767B\u5165\u7684\u540C\u4EC1\u9810\u8A2D\u70BA\u6B64\u89D2\u8272\u3002", can: ["\u5DF2\u767C\u5E03 Agent \u5C0D\u8A71"] }
];
const ROLE_LABEL = { admin: "\u7CFB\u7D71\u7BA1\u7406\u54E1", builder: "Agent \u5EFA\u7F6E\u8005", user: "\u4E00\u822C\u4F7F\u7528\u8005" };
const toAgentIn = (a) => ({
  ...(a.skill_ids ? { skill_ids: a.skill_ids } : {}),
  ...(a.share ? { share: a.share } : {}),
  name: a.name,
  description: a.description,
  instructions: a.instructions,
  category: a.category,
  department: a.department,
  code: a.code,
  model_group: "auto",  // the gateway smart-router picks the model; agents no longer choose one
  temperature: a.temperature,
  routing: a.routing,
  connectors: a.connectors,
  flow: a.flow,
  test_cases: a.test_cases,
  knowledge_doc_ids: a.knowledge_doc_ids ?? []
});
const emptyAgent = () => ({
  name: "\u65B0\u7684 Agent",
  description: "",
  instructions: "# \u89D2\u8272\u8A2D\u5B9A\uFF1A\u81FA\u4E2D\u69AE\u6C11\u7E3D\u91AB\u9662 \u9662\u5167\u52A9\u7406\n\n\u4F60\u662F\u53F0\u4E2D\u69AE\u7E3D\u7684\u5167\u90E8\u52A9\u7406\u3002\u56DE\u7B54\u7CBE\u7C21\u3001\u4F7F\u7528\u7E41\u9AD4\u4E2D\u6587\uFF0C\u5F15\u7528\u77E5\u8B58\u5EAB\u6642\u6A19\u8A3B\u4F86\u6E90\u7DE8\u865F\u3002",
  category: "clinical",
  department: "",
  code: "",
  model_group: "auto",
  temperature: 0.15,
  routing: { reasoning_keywords: ["\u5206\u6790", "\u6BD4\u8F03", "\u898F\u5283", "\u70BA\u4EC0\u9EBC"], sovereign_only: false, max_cost_tier: "reasoning" },
  connectors: [],
  flow: {
    nodes: [
      { id: "in", type: "input", position: { x: 40, y: 200 }, data: { label: "\u4F7F\u7528\u8005\u8F38\u5165" } },
      { id: "kb", type: "knowledge", position: { x: 340, y: 200 }, data: { label: "\u77E5\u8B58\u6AA2\u7D22", query: "{{input}}" } },
      { id: "llm", type: "llm", position: { x: 640, y: 200 }, data: { label: "\u81E8\u5E8A\u6458\u8981\u751F\u6210", prompt: "{{input}}" } },
      { id: "out", type: "output", position: { x: 940, y: 200 }, data: { label: "\u56DE\u8986", template: "{{last}}" } }
    ],
    edges: [
      { id: "e-in-kb", source: "in", target: "kb" },
      { id: "e-kb-llm", source: "kb", target: "llm" },
      { id: "e-llm-out", source: "llm", target: "out" }
    ]
  },
  test_cases: [],
  knowledge_doc_ids: []
});
export {
  CATEGORIES,
  DEPARTMENTS,
  DOC_CATEGORIES,
  MODEL_GROUPS,
  NODE_KINDS,
  ROLES,
  ROLE_LABEL,
  clampToCap,
  emptyAgent,
  toAgentIn
};
