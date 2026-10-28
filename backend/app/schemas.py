"""Pydantic models shared by the API and the flow interpreter.

The canvas (React Flow) saves `nodes` and `edges`. Each node has a `type` from NODE_TYPES and a
`data` dict with the fields the left/right panels edit. The interpreter only trusts these schemas.
"""
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

ModelGroup = Literal["fast", "reasoning", "budget", "sovereign", "auto"]  # "auto" = resolved per call by config/routing
RealGroup = Literal["fast", "reasoning", "budget", "sovereign"]  # groups that exist as LiteLLM model_name aliases
# Node palette (matches the Agent Studio design):
#   input             user message / trigger
#   his_emr           HIS / EMR fetch (stub until the FHIR gateway exists)
#   pii_mask          DEPRECATED (no-op); de-identification is done by the platform, not a node
#   knowledge         retrieval from the agent's RAG corpus (Vertex AI RAG Engine)
#   llm               one model call
#   condition         yes/no branch
#   tool              connector action (stub)
#   approval          human-in-the-loop pause
#   structured_output model call constrained to a JSON schema
#   output            final reply template
NodeType = Literal[
    "input", "his_emr", "pii_mask", "knowledge", "llm", "condition", "tool", "approval", "structured_output", "output"
]
NODE_TYPES: tuple[str, ...] = (
    "input", "his_emr", "pii_mask", "knowledge", "llm", "condition", "tool", "approval", "structured_output", "output"
)
AgentCategory = Literal["clinical", "admin", "consultation"]
# Fixed department list (monitoring filters group by it). Keep in sync with frontend/src/types.ts.
DEPARTMENTS: tuple[str, ...] = (
    "內科部", "外科部", "急診醫學部", "心臟血管中心", "神經醫學中心", "新陳代謝科", "放射線部", "護理部", "藥劑部",
    "感染管制中心", "臨床試驗與轉譯研究中心", "智慧醫療組 (IT)",
)
# Hospital knowledge library categories (tabs on 院內指引與醫學知識庫). Keep in sync with frontend/src/types.ts.
DocCategory = Literal["guideline", "pharmacy", "nursing_sop", "regulation", "other"]


class ShareMember(BaseModel):
    type: Literal["user", "group"]
    id: str = Field(min_length=1, max_length=254)  # user: e-mail (lower-cased); group: groups/{id}
    name: str = Field(default="", max_length=200)  # display only
    role: Literal["use", "edit"] = "use"

    @field_validator("id", mode="after")
    @classmethod
    def _norm_id(cls, v: str, info) -> str:
        return v.strip().lower() if info.data.get("type") == "user" else v.strip()


class Share(BaseModel):
    """Reusable ACL block stored under `share` on agents, skills, schedules and spaces.
    access: restricted = owner + members only; account = every signed-in user gets `role`."""
    access: Literal["restricted", "account"] = "restricted"
    role: Literal["use", "edit"] = "use"  # role granted to everyone when access == account
    members: list[ShareMember] = Field(default_factory=list, max_length=500)


class RoutingPolicy(BaseModel):
    """Per-agent routing policy (diagram column D, 'Model routing policy')."""

    reasoning_keywords: list[str] = Field(default_factory=lambda: ["分析", "比較", "plan", "why", "summarize"])
    sovereign_only: bool = False  # true => every step forced to on-prem group, no cloud fallback
    max_cost_tier: Literal["budget", "fast", "reasoning"] = "reasoning"


class Connector(BaseModel):
    provider: Literal["gmail", "calendar", "drive", "docs"]
    scopes: list[str] = Field(default_factory=list)
    requires_approval: bool = True  # human-in-the-loop for write actions (MVP default)


class FlowNode(BaseModel):
    id: str
    type: NodeType
    position: dict[str, float] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)


class FlowEdge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: str | None = None  # "true"/"false" on condition nodes
    label: str | None = None


class Flow(BaseModel):
    nodes: list[FlowNode] = Field(default_factory=list)
    edges: list[FlowEdge] = Field(default_factory=list)


class TestCase(BaseModel):
    """Preset prompt shown in the sandbox's '預載個案' picker."""

    title: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=4000)


class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    instructions: str = ""
    category: AgentCategory = "clinical"
    department: str = ""  # one of DEPARTMENTS or "" (legacy free-text values read back as "")
    code: str = ""  # short specialty code shown on hub cards, e.g. CARD-801
    model_group: ModelGroup = "fast"
    temperature: float = Field(default=0.3, ge=0, le=2)
    top_p: float = Field(default=0.95, ge=0, le=1)
    routing: RoutingPolicy = Field(default_factory=RoutingPolicy)
    connectors: list[Connector] = Field(default_factory=list)
    flow: Flow = Field(default_factory=Flow)
    test_cases: list[TestCase] = Field(default_factory=list)
    # Hospital library documents this agent's knowledge nodes search (documents/{id}); part of the
    # published snapshot, so a published agent follows document replacements automatically.
    knowledge_doc_ids: list[str] = Field(default_factory=list, max_length=200)
    # Skills (skills/{id}) whose instructions are prepended to this agent's LLM system prompts.
    skill_ids: list[str] = Field(default_factory=list, max_length=50)
    # Who besides the owner may view / edit this agent (published agents stay hospital-wide regardless).
    share: Share = Field(default_factory=Share)

    @field_validator("department", mode="before")
    @classmethod
    def _known_department(cls, v: object) -> str:
        return v if isinstance(v, str) and v in DEPARTMENTS else ""


class ReviewState(BaseModel):
    """Publish request waiting on (or rejected by) an admin. Kept apart from `status` so a live
    version stays live while the next one is in review."""
    state: Literal["pending", "rejected"]
    version: int  # snapshot under agents/{id}/versions/{version}, frozen at request time
    requested_by_email: str = ""
    requested_at: Any = None
    reason: str = ""  # reject reason, shown to the owner
    decided_by_email: str = ""
    decided_at: Any = None


class ReviewDecision(BaseModel):
    approve: bool
    reason: str = Field(default="", max_length=1000)


class AgentOut(AgentIn):
    id: str
    owner_uid: str
    owner_email: str
    status: Literal["draft", "published"] = "draft"
    version: int = 0
    knowledge_count: int = 0  # derived from knowledge_doc_ids, never stored
    created_at: Any = None
    updated_at: Any = None
    published_at: Any = None
    review: ReviewState | None = None
    approved_by_email: str = ""  # empty on agents published before review existed (treated as approved)
    approved_at: Any = None

    @model_validator(mode="after")
    def _knowledge_count(self) -> "AgentOut":
        self.knowledge_count = len(self.knowledge_doc_ids)
        return self


class AgentRef(BaseModel):
    id: str
    name: str


class DocumentOut(BaseModel):
    """One document in the hospital knowledge library (documents/{id}). The original stays in the CMEK
    bucket; only its de-identified text is indexed in the shared RAG corpus."""
    id: str
    name: str
    category: DocCategory = "other"
    department: str = ""
    content_type: str = ""
    size_bytes: int = 0
    chars: int = 0  # length of the de-identified text that was indexed
    version: int = 1  # bumped by "upload new version" (replace)
    status: Literal["indexing", "indexed", "error"] = "indexing"
    error: str = ""
    # DLP verdict on the ORIGINAL text at upload: found = personal data was masked, none = nothing detected.
    # unknown (older documents, or an admin could not decide) is treated like found.
    pii: Literal["none", "found", "unknown"] = "unknown"
    pii_types: list[str] = Field(default_factory=list)  # infoType names DLP replaced, e.g. PERSON_NAME
    uploaded_by: str = ""
    uploaded_uid: str = ""
    created_at: Any = None
    updated_at: Any = None
    agents: list[AgentRef] = Field(default_factory=list)  # agents whose knowledge_doc_ids include this doc

    @field_validator("department", mode="before")
    @classmethod
    def _known_department(cls, v: object) -> str:
        return v if isinstance(v, str) and v in DEPARTMENTS else ""


class DocumentPatch(BaseModel):
    category: DocCategory
    department: str = ""
    pii: Literal["none", "found"] | None = None  # admin override of the DLP verdict


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    session_id: str | None = None
    use_published: bool = False
    version: int | None = Field(default=None, ge=1)  # owner/admin: run a specific snapshot (e.g. the one in review)


class ApproveRequest(BaseModel):
    session_id: str
    approve: bool = True


class StepTrace(BaseModel):
    node_id: str
    type: str
    model: str | None = None
    group: str | None = None
    summary: str
    ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    thinking: str | None = None  # the model's thought summary for this step, when the model returns one
    reason: str | None = None  # the MODEL's own one-line "why this step" (tool calls); `summary` is the platform's factual record


class Citation(BaseModel):
    source: str  # display name of the knowledge file
    uri: str = ""
    score: float | None = None
    text: str = ""  # chunk excerpt
    doc_id: str = ""  # library document this chunk came from (opens the viewer); empty when it cannot be resolved
    page: int | None = None  # first page of the chunk for paged files (PDF), when the retriever reports it


class RunResponse(BaseModel):
    session_id: str
    reply: str
    trace: list[StepTrace]
    citations: list[Citation] = Field(default_factory=list)
    structured: dict[str, Any] | None = None  # parsed JSON from a structured_output node, if any
    pending_approval: dict[str, Any] | None = None
    latency_ms: int = 0


class AuditEntry(BaseModel):
    id: str
    actor: str
    actor_email: str = ""
    action: str
    at: Any = None
    # Derived at read time from action + details (nothing extra is stored on the audit doc).
    category: str = "other"  # inference | connector | build | access | other
    severity: str = "info"  # info | success | warning
    target_kind: str = ""  # agent | connector | document | user | system | ""
    target_id: str = ""
    target_label: str = ""
    agent_label: str = ""  # name of the agent involved (also set for connector calls made by an agent)
    department: str = ""  # that agent's department, "" when unknown
    details: dict[str, Any] = Field(default_factory=dict)


class AuditPage(BaseModel):
    items: list[AuditEntry]
    next_cursor: str | None = None  # pass back as ?cursor= for the next page
    scanned: int = 0  # audit docs read to fill this page (filters run in the backend)
    truncated: bool = False  # scan cap hit before the page filled; more matches may follow the cursor


class AuditCount(BaseModel):
    key: str
    label: str = ""
    count: int


class AuditSummary(BaseModel):
    day: str  # YYYY-MM-DD, Asia/Taipei
    total: int
    total_yesterday: int
    delta_pct: float | None = None
    by_category: dict[str, int] = Field(default_factory=dict)
    connector_calls: int = 0
    connector_failed: int = 0
    top_connectors: list[AuditCount] = Field(default_factory=list)
    warnings: int = 0
    warning_breakdown: list[AuditCount] = Field(default_factory=list)
    active_users: int = 0
    run_users: int = 0  # distinct people who ran an agent today
    build_users: int = 0  # distinct people who changed an agent, knowledge, or connector today
    agents_invoked: int = 0
    capped: bool = False  # today's scan hit the cap; counts are lower bounds


class AgentActivity(BaseModel):
    runs: int = 0
    avg_latency_ms: int = 0


class SandboxActivity(BaseModel):
    """Today's runs from the audit log (one per conversation turn, not per LLM call)."""
    runs_today: int = 0
    avg_latency_ms: int = 0
    pending_reviews: int = 0  # admins: hospital-wide queue; builders: their own requests
    by_agent: dict[str, AgentActivity] = Field(default_factory=dict)
    capped: bool = False


class HubStats(BaseModel):
    my_agents: int = 0
    my_published: int = 0
    hospital_published: int = 0
    runs_today: int = 0
    knowledge_files: int = 0


# ------------------------------------------------------------------ connectors (shared, hospital-wide)
class ConnectorIn(BaseModel):
    type: str = Field(min_length=1, max_length=32)  # key of engine.connectors.TYPES
    label: str = Field(min_length=1, max_length=120)
    scope: str = ""  # 適用情境與臨床呼叫範圍
    config: dict[str, Any] = Field(default_factory=dict)  # non-secret fields
    secrets: dict[str, str] = Field(default_factory=dict)  # field -> plaintext; only on create / when changing
    redact_pii: bool = True
    audit_payloads: bool = True


class ConnectorOut(BaseModel):
    id: str
    type: str
    label: str
    scope: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    secret_fields: list[str] = Field(default_factory=list)  # which secret fields are set (values never returned)
    redact_pii: bool = True
    audit_payloads: bool = True
    owner_uid: str
    owner_email: str
    status: Literal["unverified", "active", "error"] = "unverified"
    last_test: dict[str, Any] | None = None  # {ok, message, ms, at, tools?}
    agents_count: int = 0
    share: Share = Field(default_factory=Share)  # who may connect their own account (per-user OAuth types)
    created_at: Any = None
    updated_at: Any = None


class ConnectorStats(BaseModel):
    connected: int = 0
    available_types: int = 0
    invocations_today: int = 0
    mcp_nodes: int = 0



# ------------------------------------------------------------------ monitoring (admin-only)
class ModelSlice(BaseModel):
    model: str
    requests: int = 0
    tokens: int = 0
    cost_usd: float = 0.0


class DailyPoint(BaseModel):
    date: str  # YYYY-MM-DD, Asia/Taipei
    requests: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    by_model: list[ModelSlice] = Field(default_factory=list)


class MonitoringSummary(BaseModel):
    range_from: str
    range_to: str
    department: str = ""
    requests: int = 0
    failed: int = 0
    fallbacks: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    avg_latency_ms: int = 0
    # deltas vs the previous period of the same length (None when the previous period is empty)
    requests_delta_pct: float | None = None
    tokens_delta_pct: float | None = None
    cost_delta_pct: float | None = None
    active_agents: int = 0  # agents with >=1 call in range
    total_agents: int = 0
    published_agents: int = 0
    month_cost_usd: float = 0.0  # calendar month to date, all departments
    monthly_budget_usd: float = 0.0
    usd_twd_rate: float = 0.0
    daily: list[DailyPoint] = Field(default_factory=list)
    models: list[str] = Field(default_factory=list)  # every model seen in range, for chart legend


class AgentUsageRow(BaseModel):
    agent_id: str
    name: str = ""
    department: str = ""
    owner_email: str = ""
    status: str = ""
    main_model: str = ""
    main_group: str = ""
    requests: int = 0
    failed: int = 0
    fallbacks: int = 0
    tokens: int = 0
    cost_usd: float = 0.0
    avg_latency_ms: int = 0


# ---- accounts & access (admin-only page 帳號與存取權限)
Role = Literal["admin", "builder", "user"]
AccountStatus = Literal["active", "suspended"]


class UserOut(BaseModel):
    email: str
    uid: str = ""  # "" until a pre-registered person signs in for the first time
    name: str = ""
    role: Role = "user"  # effective role (ADMIN_EMAILS are always admin)
    status: AccountStatus = "active"
    department: str = ""
    bootstrap_admin: bool = False  # listed in ADMIN_EMAILS: role/status are not editable here
    original_view: bool = False  # may open original library files that contain personal data (with a stated purpose)
    created_at: Any = None
    created_by: str = ""  # admin who pre-registered the account; "" when created by signing in
    first_login_at: Any = None
    last_seen_at: Any = None  # last API call, written at most every 10 minutes
    status_reason: str = ""
    status_changed_at: Any = None
    status_changed_by: str = ""
    role_changed_at: Any = None
    role_changed_by: str = ""

    @field_validator("department", mode="before")
    @classmethod
    def _known_department(cls, v: object) -> str:
        return v if isinstance(v, str) and v in DEPARTMENTS else ""


class OwnedCounts(BaseModel):
    agents: int = 0
    published_agents: int = 0
    connectors: int = 0
    documents: int = 0


class UserDetail(UserOut):
    owned: OwnedCounts = Field(default_factory=OwnedCounts)


class DomainCount(BaseModel):
    domain: str
    users: int


class UserDirectory(BaseModel):
    users: list[UserOut]
    domains: list[DomainCount]  # ALLOWED_DOMAINS (read-only here) with account counts


class UserCreate(BaseModel):
    """Pre-register someone who has not signed in yet."""
    email: str = Field(min_length=3, max_length=254)
    role: Role = "user"
    department: str = ""


class UserPatch(BaseModel):
    role: Role | None = None
    status: AccountStatus | None = None
    department: str | None = None
    original_view: bool | None = None
    reason: str = Field(default="", max_length=200)  # required when role, status or original_view changes


# ------------------------------------------------------------------ sharing: groups + directory
class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    member_emails: list[str] = Field(default_factory=list, max_length=1000)

    @field_validator("member_emails", mode="after")
    @classmethod
    def _emails(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for e in v:
            e = e.strip().lower()
            if "@" not in e or " " in e:
                raise ValueError(f"invalid e-mail: {e}")
            if e not in out:
                out.append(e)
        return out


class GroupOut(GroupIn):
    id: str
    created_by: str = ""
    created_at: Any = None
    updated_at: Any = None


class DirectoryUser(BaseModel):
    email: str
    name: str = ""
    department: str = ""


class DirectoryGroup(BaseModel):
    id: str
    name: str
    description: str = ""
    member_count: int = 0


class DirectoryOut(BaseModel):
    users: list[DirectoryUser] = Field(default_factory=list)
    groups: list[DirectoryGroup] = Field(default_factory=list)


# ------------------------------------------------------------------ skills
class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=1024)
    instructions: str = Field(default="", max_length=500000)
    enabled: bool = True


class SkillOut(SkillIn):
    id: str
    owner_uid: str
    owner_email: str
    share: Share = Field(default_factory=Share)
    my_role: Literal["owner", "admin", "edit", "use"] = "use"  # the caller's effective access
    created_at: Any = None
    updated_at: Any = None


class EnabledPatch(BaseModel):
    enabled: bool


# ------------------------------------------------------------------ schedules
ScheduleFrequency = Literal["daily", "weekdays", "weekly_mon", "monthly_1"]


class ScheduleIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    agent_id: str = Field(min_length=1, max_length=128)
    frequency: ScheduleFrequency = "daily"
    time: str = Field(default="08:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")  # HH:MM, Asia/Taipei
    prompt: str = Field(min_length=1, max_length=20000)
    enabled: bool = True


class ScheduleLastRun(BaseModel):
    at: Any = None
    status: Literal["ok", "error"] = "ok"
    session_id: str = ""
    error: str = ""


class ScheduleOut(ScheduleIn):
    id: str
    owner_uid: str
    owner_email: str
    share: Share = Field(default_factory=Share)
    last_run: ScheduleLastRun | None = None
    my_role: Literal["owner", "admin", "edit", "use"] = "use"
    created_at: Any = None
    updated_at: Any = None


class ScheduleRunResult(BaseModel):
    schedule_id: str
    status: Literal["ok", "error"]
    session_id: str = ""
    error: str = ""


class TickResult(BaseModel):
    slot: str  # YYYY-MM-DDTHH:MM in Asia/Taipei
    checked: int = 0
    due: int = 0
    results: list[ScheduleRunResult] = Field(default_factory=list)


# ------------------------------------------------------------------ spaces
SpaceType = Literal["personal", "team", "org"]


class SpaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: SpaceType = "personal"
    description: str = Field(default="", max_length=1000)
    document_ids: list[str] = Field(default_factory=list, max_length=500)


class SpaceOut(SpaceIn):
    id: str
    owner_uid: str
    owner_email: str
    share: Share = Field(default_factory=Share)
    documents_count: int = 0
    my_role: Literal["owner", "admin", "edit", "use"] = "use"
    created_at: Any = None
    updated_at: Any = None


class SpaceDocuments(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=100)


# ------------------------------------------------------------------ routing rules (config/routing)
class RoutingRule(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(default="", max_length=120)
    condition: Literal["complex", "simple", "all"] = "all"
    group: RealGroup = "fast"
    enabled: bool = True


class RoutingConfigIn(BaseModel):
    # 僅院內模型: hospital-wide switch. Every LLM call uses `sovereign` (on-prem) regardless of rules, agent or node
    # groups, and nothing falls back to a cloud model.
    sovereign_only: bool = False
    default_group: RealGroup = "fast"
    fallback_group: RealGroup = "fast"
    rules: list[RoutingRule] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _unique_ids(self) -> "RoutingConfigIn":
        ids = [r.id for r in self.rules]
        if len(ids) != len(set(ids)):
            raise ValueError("rule ids must be unique")
        return self


class RoutingConfigOut(RoutingConfigIn):
    version: int = 0
    updated_by: str = ""
    updated_at: Any = None


class RoutingTestIn(BaseModel):
    text: str = Field(default="", max_length=20000)


class RoutingTestOut(BaseModel):
    group: str
    reason: str
    matched_rule: str | None = None  # rule id, None when the default applied


# ------------------------------------------------------------------ model registry
class ModelEntryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    provider: str = Field(default="", max_length=64)
    litellm_model: str = Field(min_length=1, max_length=200)  # e.g. vertex_ai/gemini-3-flash-preview
    group: RealGroup = "fast"
    deploy: Literal["cloud", "onprem"] = "cloud"
    enabled: bool = True
    secret_name: str = Field(default="", max_length=255, pattern=r"^[A-Za-z0-9_-]*$")  # Secret Manager NAME, never a value
    api_base: str = Field(default="", max_length=300)  # needed for onprem / openai-compatible endpoints
    input_price_per_m: float = Field(default=0.0, ge=0)
    output_price_per_m: float = Field(default=0.0, ge=0)
    notes: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def _residency(self) -> "ModelEntryIn":
        if self.deploy == "onprem" and self.group != "sovereign":
            raise ValueError("deploy 'onprem' is only allowed in group 'sovereign'")
        if self.deploy == "cloud" and self.group == "sovereign":
            raise ValueError("group 'sovereign' is on-prem only; a cloud model cannot be in it")
        return self


class ModelEntryOut(ModelEntryIn):
    id: str
    created_by: str = ""
    created_at: Any = None
    updated_at: Any = None


class LitellmRenderOut(BaseModel):
    yaml: str
    version: int = 0
    status: str = "rendered"
    requested_by: str = ""
    requested_at: Any = None
    secrets: list[dict[str, str]] = Field(default_factory=list)  # [{secret, env}] to mount on the LiteLLM service
    run_url: str = ""  # GitHub Actions run of the deploy (config/litellm_deploy only)


# ------------------------------------------------------------------ sessions + chat
class SessionSummary(BaseModel):
    id: str
    title: str = ""
    agent_id: str = ""
    updated_at: Any = None
    message_count: int = 0


class SessionPage(BaseModel):
    items: list[SessionSummary]
    next_cursor: str | None = None


class SessionMessage(BaseModel):
    role: str
    content: str
    meta: dict[str, Any] | None = None  # assistant turns: {trace, citations, model} so a reopened chat shows its steps and sources


class SessionDetail(SessionSummary):
    messages: list[SessionMessage] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)  # {id, name, chars}


class SessionPatch(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    session_id: str | None = None
    agent_id: str | None = None
    model_group: ModelGroup = "auto"
    model: str | None = Field(default=None, max_length=120)  # pin one exact model from GET /api/models `models`
    knowledge_doc_ids: list[str] = Field(default_factory=list, max_length=50)
    # general = model only; selected = knowledge_doc_ids; all = every indexed document the caller may see
    knowledge_scope: Literal["general", "selected", "all"] = "selected"


class AttachmentOut(BaseModel):
    session_id: str
    attachment_id: str
    name: str
    chars: int
    snippet: str  # first 500 chars of the DE-IDENTIFIED text


class CalendarStatus(BaseModel):
    connected: bool = False
    reason: str = ""


class OpenOriginalIn(BaseModel):
    purpose: str = Field(default="", max_length=200)  # required when the original contains personal data


class OpenOriginalOut(BaseModel):
    url: str  # short-lived; fetch it with the normal bearer token
    expires_at: int  # unix seconds
    ttl_seconds: int
    filename: str
    kind: Literal["pdf", "text", "download"]  # how the viewer can show it
    watermark: str  # text the viewer repeats over the page
