#!/usr/bin/env python3
"""Generate the TCVGH Agent Platform on GCP architecture diagram (.drawio)."""
import html
import sys

cells = []
_id = [100]


def nid(prefix="c"):
    _id[0] += 1
    return f"{prefix}{_id[0]}"


def esc(s):
    return html.escape(s, quote=True).replace("\n", "&#xa;")


def vertex(id_, value, style, x, y, w, h, parent="1"):
    cells.append(
        f'<mxCell id="{id_}" value="{esc(value)}" style="{style}" vertex="1" parent="{parent}">'
        f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
    )
    return id_


def edge(src, dst, label="", style="", points=None, exit=None, entry=None, id_=None):
    id_ = id_ or nid("e")
    base = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;jettySize=auto;orthogonalLoop=1;fontSize=10;labelBackgroundColor=#FFFFFF;"
    if exit:
        base += f"exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;"
    if entry:
        base += f"entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;"
    geo = '<mxGeometry relative="1" as="geometry">'
    if points:
        geo += '<Array as="points">' + "".join(f'<mxPoint x="{px}" y="{py}"/>' for px, py in points) + "</Array>"
    geo += "</mxGeometry>"
    cells.append(
        f'<mxCell id="{id_}" value="{esc(label)}" style="{base}{style}" edge="1" parent="1" source="{src}" target="{dst}">{geo}</mxCell>'
    )
    return id_


# ---------- styles ----------
def gcp_icon(name):
    return (
        "html=1;fillColor=#5184F3;strokeColor=none;verticalAlign=top;labelPosition=center;"
        f"verticalLabelPosition=bottom;align=center;fontSize=10;fontColor=#202124;shape=mxgraph.gcp2.{name};"
    )


def card(fill, stroke):
    return (
        f"rounded=1;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontSize=10;fontColor=#202124;"
        "align=left;spacingLeft=6;verticalAlign=top;spacingTop=2;"
    )


CARD_GCP = card("#E8F0FE", "#4285F4")
CARD_FIREBASE = card("#FFF3D6", "#F9AB00")
CARD_SAAS = card("#d5e8d4", "#82b366")
CARD_EXT_MODEL = card("#FCE8E6", "#EA4335")
CARD_ONPREM = card("#F1F3F4", "#5F6368")
CARD_SEC = card("#F3E8FD", "#A142F4")
ACTOR = ("shape=actor;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=10;"
         "verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;")
NOTE = "text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fontSize=10;fontColor=#5F6368;"


def group(color, dashed=0, fill="none", font_color=None):
    fc = font_color or color
    return (
        f"rounded=0;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={color};dashed={dashed};"
        f"verticalAlign=top;align=left;fontStyle=1;fontSize=12;fontColor={fc};spacingLeft=8;spacingTop=2;"
    )


# ---------- layout constants ----------
# columns: (x, width)
A = (270, 210)
B = (500, 270)
C = (790, 235)
D = (1045, 225)
E = (1290, 200)
COL_Y, COL_H = 110, 750
OPS_Y = 940

# ---------- title ----------
vertex("title", "TCVGH Agent Platform on Google Cloud  -  no-code agent builder  (MVP target architecture, v0.3.1 2026-10-23; grey cards = phase 2)",
       "text;html=1;align=left;fontStyle=1;fontSize=16;fontColor=#202124;", 30, 0, 1100, 30)

# ---------- containers ----------
vertex("gcp", "Google Cloud  |  project: tcvgh-agent-platform", group("#4285F4", fill="#FFFFFF"), 230, 45, 1290, 1025)
vertex("region", "Region asia-east1 (Taiwan)  -  data at rest in-region; every cloud model receives de-identified text only", group("#1A73E8", dashed=1), 250, 85, 1250, 795)
vertex("ops", "Cross-cutting: security, governance & operations", group("#A142F4", fill="#FAF5FF"), 250, 900, 1250, 150)

vertex("colA", "A. Frontend & identity (Firebase)", group("#F9AB00", fill="#FFFBF0"), A[0], COL_Y, A[1], COL_H)
vertex("colB", "B. Platform services (Cloud Run)", group("#34A853", fill="#F4FBF6"), B[0], COL_Y, B[1], COL_H)
vertex("colC", "C. Data & knowledge", group("#4285F4", fill="#F5F8FF"), C[0], COL_Y, C[1], COL_H)
vertex("colD", "D. Model routing & gateway (LiteLLM)", group("#EA4335", fill="#FFF7F6"), D[0], COL_Y, D[1], COL_H)
vertex("colE", "E. Vertex AI models & hybrid link", group("#1A73E8", fill="#F5F8FF"), E[0], COL_Y, E[1], COL_H)

vertex("ext_models", "Cloud models outside Taiwan (de-identified traffic only, via LiteLLM)", group("#EA4335", dashed=1, fill="#FFF7F6"), 1560, 85, 260, 215)
vertex("saas", "Connected applications (MVP = Google Workspace only)", group("#188038", fill="#F4FBF6"), 1560, 320, 260, 300)
vertex("onprem", "TCVGH on-premises datacenter", group("#5F6368", fill="#F8F9FA"), 1560, 680, 260, 370)

# ---------- actors ----------
vertex("builder", "TCVGH employee\n(agent builder)", ACTOR, 60, 150, 50, 70)
vertex("enduser", "End users (staff)\nweb chat / Google Chat", ACTOR, 60, 560, 50, 70)
vertex("admin", "Platform admin /\nIT security & compliance", ACTOR, 60, 700, 50, 70)

# ---------- A. Frontend ----------
ax = A[0] + 15
vertex("hosting", "Firebase Hosting\nAgent Builder web app (React)\n- left panel: name, description, instructions,\n  model, routing policy, connectors\n- center: drag & drop canvas (React Flow)\n- right: test chat / run preview", CARD_FIREBASE, ax, 145, 180, 120)
vertex("fbauth", "Firebase Authentication (Identity Platform)\nGoogle sign-in only, restricted to the TCVGH\nWorkspace domain (hd claim + blocking function);\nroles via custom claims", CARD_FIREBASE, ax, 290, 180, 90)
vertex("appcheck", "Firebase App Check\n(reCAPTCHA Enterprise) blocks\nnon-app API traffic", CARD_FIREBASE, ax, 395, 180, 55)
vertex("lb", "Cloud Load Balancing\n+ Cloud Armor (WAF, rate limit)", gcp_icon("cloud_load_balancing"), 350, 480, 50, 50)
vertex("noteA", "Hosting rewrites /api/* to Cloud Run; Platform API verifies the Firebase ID token and domain. No MFA today: recommend enforcing 2-Step Verification in Workspace Admin, at least for platform admins.", NOTE, ax, 600, 185, 90)

# ---------- B. Platform services ----------
bx = 620  # icon x (center 645)
vertex("api", "Platform API\nagent CRUD, versioning, publish,\nRBAC, approval workflow", gcp_icon("cloud_run"), bx, 150, 50, 50)
vertex("channels", "Channel Adapters\nweb chat (SSE), Google Chat app;\nphase 2: LINE, Slack, Teams", gcp_icon("cloud_run"), bx, 290, 50, 50)
vertex("runtime", "Agent Runtime (Google ADK)\ninterprets flow JSON, tools,\nsession memory, HITL pauses", gcp_icon("cloud_run"), bx, 430, 50, 50)
vertex("connector", "Connector Service\nMCP tool servers, OAuth broker,\nhuman-in-the-loop approvals", gcp_icon("cloud_run"), bx, 570, 50, 50)
vertex("scheduler", "Cloud Scheduler\nscheduled agents", gcp_icon("cloud_scheduler"), 560, 700, 50, 50)
vertex("tasks", "Cloud Tasks / Pub/Sub\nasync runs, doc ingestion\n-> RAG index", gcp_icon("cloud_tasks"), 680, 700, 50, 50)

# ---------- C. Data ----------
cx = C[0] + 15
vertex("firestore", "Firestore (Native mode)\nagents, versions, flows,\nsessions, RBAC, audit", gcp_icon("cloud_firestore"), 830, 150, 50, 50)
vertex("gcs", "Cloud Storage\nuploads (de-identified),\nknowledge docs, exports", gcp_icon("cloud_storage"), 955, 150, 50, 50)
vertex("vector", "Vertex AI RAG Engine / Vector Search\nper-agent knowledge base (optional);\nqueried by Agent Runtime", CARD_GCP, cx, 290, 205, 60)
vertex("secrets", "Secret Manager\nconnector OAuth refresh tokens,\nmodel provider API keys (never in Firestore)", CARD_GCP, cx, 500, 205, 65)
vertex("cloudsql", "Cloud SQL (Postgres)\nLiteLLM keys, spend logs", gcp_icon("cloud_sql"), 830, 640, 50, 50)
vertex("redis", "Memorystore (Redis)\nrouter state, cache", gcp_icon("cloud_memorystore"), 955, 640, 50, 50)
vertex("bq", "BigQuery\nusage, spend per agent,\nquality evals, audit analytics", gcp_icon("bigquery"), 830, 765, 50, 50)

# ---------- D. Model routing & gateway ----------
dx = D[0] + 15
vertex("litellm", "LiteLLM Proxy (Cloud Run, min 1 instance)\n- one OpenAI-compatible endpoint for all models\n- virtual key + budget per agent / department\n- router: fallbacks, load-balance, latency, cooldown\n- providers: Vertex AI, Azure OpenAI, Bedrock, on-prem vLLM\n- model groups: fast / reasoning / budget / sovereign\n- sovereign => on-prem only, fail closed", CARD_GCP, dx, 145, 195, 120)
vertex("guard", "Sensitive Data Protection (de-identify) + Model Armor\nevery upload and prompt is pseudonymized (deterministic\nencryption, KMS-held key) before storage or any model call;\nre-identify only via authorized role. Prompt-injection screening.", CARD_SEC, dx, 290, 195, 80)
vertex("taskrouter", "Model routing policy (set per agent in builder)\nrules + light classifier: task type, sensitivity, cost tier\n-> model group + failover chain, e.g. fast / reasoning /\nbudget / sovereign", CARD_GCP, dx, 420, 195, 75)
vertex("noteD", "Model groups (TCVGH list): fast = Gemini 3 Flash | gpt-oss-20b; reasoning = Gemini 3.1 Pro | Claude Sonnet 4.6 | gpt-oss-120b; budget = Claude Haiku 4.5 | Nova 2 Lite | Gemma 4 26B; sovereign = on-prem only. GPT-5 kept as TMMLU+ benchmark reference.", NOTE, dx, 650, 200, 120)

# ---------- E. In-region models & hybrid ----------
ex = E[0] + 10
vertex("vertex", "Vertex AI (global endpoint*)\nGemini 3 Flash / 3.1 Pro (preview IDs), Gemini 2.5\n*no Gemini served from asia-east1 (verified 2026-10-23)\noption: Claude on Vertex; Private Service Connect", CARD_GCP, ex, 145, 180, 90)
vertex("garden", "Phase 3 option: Vertex AI self-deployed\nopen-model endpoints (GPU) if on-prem\ncapacity runs out", CARD_ONPREM, ex, 260, 180, 70)
vertex("vpn", "Cloud VPN (HA) or\nDedicated Interconnect\n+ Cloud Router (BGP)", gcp_icon("cloud_vpn"), 1365, 700, 50, 50)
vertex("noteE", "Hybrid link carries only LiteLLM -> on-prem model calls (private IPs, mTLS). If on-prem is down, sovereign agents fail closed.", NOTE, ex, 800, 180, 55)

# ---------- ops strip ----------
vertex("iam", "Cloud IAM +\nleast-privilege SAs", gcp_icon("cloud_iam"), 290, OPS_Y, 50, 50)
vertex("kms", "Cloud KMS (CMEK)\nFirestore, GCS, SQL", gcp_icon("key_management_service"), 395, OPS_Y, 50, 50)
vertex("vpcsc", "VPC Service Controls\nperimeter: Firestore, GCS,\nVertex AI, Secret Manager", CARD_SEC, 490, OPS_Y - 5, 160, 60)
vertex("orgpol", "Org Policy\nresource location = asia-east1,\nno public IPs, domain-restricted sharing", CARD_SEC, 665, OPS_Y - 5, 165, 60)
vertex("audit", "Cloud Audit Logs\n+ Data Access logs, long-term\nretention bucket (locked)", CARD_SEC, 845, OPS_Y - 5, 165, 60)
vertex("logging", "Cloud Logging", gcp_icon("logging"), 1050, OPS_Y, 50, 50)
vertex("monitoring", "Cloud Monitoring\n+ alerting", gcp_icon("monitoring"), 1140, OPS_Y, 50, 50)
vertex("trace", "Cloud Trace\n(OpenTelemetry)", gcp_icon("trace"), 1230, OPS_Y, 50, 50)
vertex("build", "Cloud Build\nCI/CD", gcp_icon("cloud_build"), 1320, OPS_Y, 50, 50)
vertex("registry", "Artifact Registry\n+ Terraform IaC", gcp_icon("container_registry"), 1410, OPS_Y, 50, 50)

# ---------- external model APIs ----------
vertex("openai", "Azure OpenAI: GPT-5.4 (Data Zone deployment)\nEntra app / API key in Secret Manager; budget caps", CARD_EXT_MODEL, 1575, 120, 230, 50)
vertex("anthropic", "Amazon Bedrock (cross-region inference)\nClaude Sonnet 4.6, Claude Haiku 4.5, Amazon Nova 2 Lite\nIAM user or WIF credentials in Secret Manager", CARD_EXT_MODEL, 1575, 185, 230, 65)
vertex("noteExt", "GPT-5 = TMMLU+ benchmark reference only, not deployed.", NOTE, 1575, 255, 230, 40)

# ---------- SaaS ----------
vertex("gws", "Google Workspace (TCVGH tenant)\nidentity provider for sign-in; Gmail, Calendar,\nDrive, Docs APIs via internal OAuth app\n(no external app verification needed)", CARD_SAAS, 1575, 355, 230, 75)
vertex("gchat", "Google Chat app\nend-user chat channel + interactive approval\ncards (webhook -> Channel Adapters)", CARD_SAAS, 1575, 445, 230, 60)
vertex("line", "Phase 2 (not in MVP): Slack, LINE Messaging API,\nMicrosoft 365 / Teams connectors and channels", CARD_ONPREM, 1575, 525, 230, 50)

# ---------- on-prem ----------
vertex("onprem_llm", "On-prem inference (existing, 1x H200, operator TBD)\nOpenAI-compatible server (vLLM)\nnow: gpt-oss-20b, Gemma 4 26B-A4B\nupgrade: gpt-oss-120b, Gemma 4 31B dense\nLlama 3.3 70B needs 1-2x H200; capacity-limited\n=> LiteLLM rpm/tpm caps, cloud overflow", CARD_ONPREM, 1575, 715, 230, 105)
vertex("his", "HIS / EMR / PACS (PHI systems)\nstay on-prem; NOT connected to the platform.\nPHI reaches an agent only if a user uploads it,\nand it is de-identified at ingress (option B)", CARD_ONPREM, 1575, 835, 230, 75)
vertex("noteOn", "PHI boundary: identified patient data is never persisted in GCP (pseudonymized at ingress); hybrid link carries only model calls.", NOTE, 1575, 920, 230, 60)

# ---------- legend ----------
vertex("legend", "Legend", group("#5F6368", fill="#FFFFFF"), 30, 880, 180, 170)
LG = "text;html=1;fontSize=10;align=left;spacingLeft=4;fillColor=none;rounded=1;"
vertex("lg1", "Builder / control-plane flow", LG + "strokeColor=#1A73E8;strokeWidth=2;", 45, 905, 150, 24)
vertex("lg2", "Runtime / data-plane flow", LG + "strokeColor=#188038;strokeWidth=2;", 45, 935, 150, 24)
vertex("lg3", "Leaves Taiwan (de-identified only)", LG + "strokeColor=#EA4335;strokeWidth=2;dashed=1;", 45, 965, 150, 24)
vertex("lg4", "Governance / guardrails", LG + "strokeColor=#A142F4;dashed=1;", 45, 995, 150, 24)
vertex("lg5", "Supporting / optional", LG + "strokeColor=#5F6368;dashed=1;", 45, 1025, 150, 24)

# ---------- edges ----------
BLUE = "strokeColor=#1A73E8;strokeWidth=2;"
GREEN = "strokeColor=#188038;strokeWidth=2;"
RED_DASH = "strokeColor=#EA4335;strokeWidth=2;dashed=1;"
GREY_DASH = "strokeColor=#5F6368;dashed=1;"
PURPLE = "strokeColor=#A142F4;dashed=1;"

# --- builder / control plane ---
edge("builder", "hosting", "1. SSO sign-in, build agent\nin drag & drop canvas", BLUE)
edge("hosting", "fbauth", "ID token", GREY_DASH)
edge("fbauth", "gws", "Google sign-in (OIDC),\nWorkspace domain only", GREY_DASH,
     points=[(262, 335), (262, 38), (1840, 38), (1840, 380)], exit=(0, 0.5), entry=(1, 0.33))
edge("hosting", "lb", "2. /api/* calls with\nFirebase ID token", BLUE, points=[(275, 230), (275, 505)], exit=(0, 0.7), entry=(0, 0.5))
edge("lb", "api", "verify token, RBAC", BLUE, points=[(490, 505), (490, 175)], exit=(1, 0.5), entry=(0, 0.5))
edge("api", "firestore", "3. save agent definition,\nflow graph, versions", BLUE, exit=(1, 0.5), entry=(0, 0.5))
edge("api", "gcs", "uploads / knowledge docs", GREY_DASH, points=[(645, 130), (980, 130)], exit=(0.5, 0), entry=(0.5, 0))

# --- end-user / runtime ---
edge("enduser", "channels", "4. chat via web / Google Chat", GREEN, points=[(540, 595), (540, 300)], exit=(1, 0.5), entry=(0, 0.2))
edge("channels", "runtime", "invoke published agent", GREEN)
edge("gchat", "channels", "Google Chat webhooks\n(messages, approval card clicks)", GREY_DASH,
     points=[(1545, 475), (1545, 400), (522, 400), (522, 330)], exit=(0, 0.5), entry=(0, 0.8))
edge("runtime", "firestore", "load flow, session memory,\nwrite audit trail", GREEN, points=[(775, 440), (775, 190)], exit=(1, 0.2), entry=(0, 0.8))
edge("scheduler", "runtime", "scheduled runs", GREY_DASH, points=[(585, 690), (505, 690), (505, 470)], exit=(0.5, 0), entry=(0, 0.8))

# --- model routing chain ---
edge("runtime", "taskrouter", "5. completion request\n+ tags (phi-safe, dept)", GREEN, exit=(1, 0.5), entry=(0, 0.5))
edge("taskrouter", "guard", "model alias + fallback chain", GREEN)
edge("guard", "litellm", "screened / de-identified prompt", GREEN)
edge("litellm", "vertex", "6a. default: in-region\nGemini 3 Flash / 3.1 Pro", GREEN, exit=(1, 0.4), entry=(0, 0.5))
edge("vertex", "garden", "Model Garden deploy", GREY_DASH)
edge("litellm", "openai", "6b. multi-cloud models,\nde-identified text only", RED_DASH, points=[(1226, 135), (1540, 135)], exit=(0.85, 0), entry=(0, 0.5))
edge("litellm", "anthropic", "", RED_DASH, points=[(1226, 135), (1540, 135), (1540, 217)], exit=(0.85, 0), entry=(0, 0.5))
edge("litellm", "vpn", "6c. sovereign / overflow route\nto on-prem models", GREEN, points=[(1280, 241), (1280, 740)], exit=(1, 0.8), entry=(0, 0.8))
edge("litellm", "redis", "", GREY_DASH, points=[(1035, 250), (1035, 665)], exit=(0, 0.88), entry=(1, 0.5))
edge("litellm", "cloudsql", "keys, spend logs,\ncache", GREY_DASH, points=[(1035, 250), (1035, 630), (855, 630)], exit=(0, 0.88), entry=(0.5, 0))
edge("cloudsql", "bq", "spend / usage export", GREY_DASH)

# --- tools / actions ---
edge("runtime", "connector", "7. tool call (MCP)", GREEN)
edge("connector", "secrets", "fetch user OAuth token", GREY_DASH, points=[(780, 580), (780, 532)], exit=(1, 0.2), entry=(0, 0.5))
edge("connector", "gws", "8. take action: send mail, create event,\nread Drive doc (user-consented scopes)", GREEN,
     points=[(1530, 600), (1530, 410)], exit=(1, 0.6), entry=(0, 0.73))
edge("vpn", "onprem_llm", "private IP, mTLS", GREEN, points=[(1520, 740), (1520, 762)], exit=(1, 0.8), entry=(0, 0.5))

# --- admin ---
edge("admin", "bq", "9. governance: spend, audit, agent quality\ndashboards; alerts via Cloud Monitoring", PURPLE,
     points=[(85, 890), (815, 890), (815, 805)], exit=(0.5, 1), entry=(0, 0.8))

xml = f"""<mxfile host="app.diagrams.net" modified="2026-10-23T00:00:00.000Z" agent="Claude Code" version="24.7.17" type="device">
  <diagram name="TCVGH Agent Platform - GCP" id="tcvgh-agent-platform">
    <mxGraphModel dx="1600" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        {chr(10).join('        ' + c for c in cells)}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
"""

out = sys.argv[1]
with open(out, "w", encoding="utf-8") as f:
    f.write(xml)
print(f"wrote {out}: {len(cells)} cells")
