# TCVGH Agent Platform — MVP build (sandbox: `cloud-sa-sandbox-1`)

This folder is the runnable MVP that matches diagram v0.3 plus the Stitch design
(`../stitch_tcvgh_agent_studio`, "Clinical Jade"). It is deliberately small:
three deployables and a handful of `gcloud` scripts, no Terraform.

```
mvp/
├── infra/        numbered gcloud scripts; run in order, each is idempotent
├── litellm/      LiteLLM proxy config + Dockerfile (model gateway, column D)
├── backend/      FastAPI "Platform API + Agent Runtime" (column B), Python 3.12
└── frontend/     React + React Flow builder UI on Firebase Hosting (column A)
```

## 0. One-time local prerequisites

| Tool | Why | Install |
|---|---|---|
| gcloud (present) | all provisioning | `gcloud auth login` and `gcloud auth application-default login` |
| node 26 / npm (present) | frontend build, Firebase CLI via `npx` | — |
| uv (present) | backend local run | — |
| Docker | **not required** — images build in Cloud Build | — |

## 1. Provision (run from `mvp/`)

```bash
source infra/env.sh                 # project, region, names; edit ALLOWED_DOMAINS first
bash infra/01-enable-apis.sh        # enable ~15 APIs
bash infra/02-foundation.sh         # Firestore, GCS bucket, Artifact Registry, 2 service accounts, secrets
bash infra/03-deploy-litellm.sh     # build LiteLLM image with config, deploy to Cloud Run (internal ingress)
bash infra/04-deploy-backend.sh     # deploy FastAPI from source, wire it to LiteLLM + Firestore + GCS
bash infra/05-firebase.sh           # add Firebase to the project, create web app, print config for frontend/.env
```

Console steps:
1. Firebase console → Authentication → Sign-in method → enable **Google** (already on in the sandbox; the Hosting site
   `tcvgh-agent-builder.web.app` was added to authorized domains via the Identity Toolkit API).
2. (Later, Gmail/Calendar connectors) Google Cloud console → APIs & Services → OAuth consent
   screen → **Internal**, add scopes `gmail.send`, `calendar.events`, `drive.readonly`.

Finally build and deploy the frontend:

```bash
cd frontend && cp .env.example .env   # paste values printed by 05-firebase.sh
npm install && npm run build
npx firebase-tools deploy --only hosting --project "$PROJECT_ID"
```

## 1b. Deployed state (sandbox, 2026-10-23)

| Piece | Where |
|---|---|
| Builder UI | https://tcvgh-agent-builder.web.app (Firebase Hosting site `tcvgh-agent-builder`, rewrites `/api/**` to Cloud Run) |
| Platform API | Cloud Run `tcvgh-platform-api`, asia-east1, public at IAM layer, Firebase token required on `/api/*`; health at `/api/health` |
| LiteLLM | Cloud Run `tcvgh-litellm`, asia-east1, **internal ingress**, backend reaches it via Direct VPC egress + ID token |
| Firestore | named database `tcvgh-agent-platform` in asia-east1 (the project's `(default)` DB is nam5/US and shared) |
| Vertex AI | `global` endpoint: `gemini-3-flash-preview`, `gemini-3.1-pro-preview`, fallback `gemini-2.5-flash` (no Gemini in asia-east1) |
| Uploads | `gs://cloud-sa-sandbox-1-tcvgh-agent-uploads` (asia-east1, versioned, no public access) |

Verified end-to-end with a temporary test user: create agent → condition node → `fast` or `reasoning` group → Gemini → publish → run published → delete.
Idle cost is close to zero (Cloud Run min-instances 0, no Cloud SQL / Redis yet).

## 1c. CI/CD (GitHub Actions → Firebase Hosting)

`.github/workflows/firebase-hosting.yml` builds `mvp/frontend` and deploys it to the `tcvgh-agent-builder` site on
every push to `main` that touches the frontend; pull requests get a temporary preview URL. One-time setup:

```bash
source infra/env.sh && bash infra/07-github-cicd.sh   # deploy SA + roles, key → GitHub secret, VITE_* → GitHub secrets
```

Firebase **App Hosting** is not used: it expects a server-rendered Node app (Next.js/Angular) and cannot express the
`/api/**` → Cloud Run rewrite. The Vite SPA belongs on classic Hosting.

## 2. What each component does

**LiteLLM** (`litellm/config.yaml`) exposes one OpenAI-compatible endpoint with model *groups*
(`fast`, `reasoning`, `budget`, `sovereign`) exactly as in the design notes. Vertex AI Gemini
entries are live; on-prem vLLM, Azure OpenAI and Bedrock entries are present but commented
out until credentials / VPN exist. Fallback chains are declared under `router_settings`.

**Backend** (`backend/app`)
- `auth.py` verifies the Firebase ID token and enforces the Workspace domain allow-list.
- `routers/agents.py` CRUD + publish (immutable `versions` sub-collection) in Firestore.
- `routers/runs.py` runs a draft or published agent for the test chat.
- `engine/flow.py` is the no-code **flow interpreter**: walks the canvas graph
  (`input → llm → condition → tool → approval → output`) and calls LiteLLM per step.
- `engine/deid.py` is the **option-B de-identification** step (Sensitive Data Protection
  `deidentify_content`, deterministic crypto with a KMS-wrapped key). Off by default in the
  sandbox (`DEID_ENABLED=false`) so you can smoke-test before creating the KMS key.
- `engine/llm.py` is the thin OpenAI-SDK client to LiteLLM, tagging each request with
  `agent_id`, `model_group` and `user` for spend attribution. It returns the served model, token
  counts and an estimated cost from its own `PRICES` table (USD per 1M tokens; verify against the
  Vertex pricing page before billing anyone). `PRIMARY` mirrors `litellm/config.yaml`; a served model
  outside the group's primary is counted as a fallback.
- `engine/usage.py` is the **usage ledger** behind the admin dashboard: one `usage` row per LLM call
  (no prompt text) plus a `usage_daily/{day}_{agentId}` rollup bumped with `Increment`, Asia/Taipei days.
  Ledger failures are logged, never raised. LiteLLM's own spend DB (Cloud SQL) stays a phase-2 item.

**Monitoring & cost** (`routers/monitoring.py`, `frontend/src/pages/Monitoring.tsx`, admin-only) —
`/monitoring` shows KPI cards (tokens, calls, cost vs `MONTHLY_BUDGET_USD`, active agents), a daily
stacked chart by served model (Recharts) and a per-agent leaderboard with CSV export. Range and
department filters; departments are a fixed list (`DEPARTMENTS` in `schemas.py` and `types.ts`).
Admins = `ADMIN_EMAILS` (comma-separated, checked at sign-in) or a Firebase `role=admin` claim.
Needs the `usage_daily` composite index from `02-foundation.sh`.

**Knowledge** (`backend/app/engine/rag.py`, `routers/knowledge.py`) — Vertex AI **RAG Engine**, one corpus
per agent, created lazily on the first upload. Files go to the upload bucket (audit copy) and are pushed with
`upload_file` (direct upload, so the RAG service agent needs no bucket IAM); RAG Engine chunks and embeds them
with `text-multilingual-embedding-002`. The `knowledge` canvas node calls `retrieve_contexts` and the next LLM step
is grounded with the chunks; replies carry `citations`. Uses the `google-cloud-agentplatform` client
(`vertexai.rag` is deprecated). asia-east1 is a *Preview* region for RAG Engine (checked 2026-10-24).
Verified 2026-10-24: create corpus → upload → retrieve → delete all work in asia-east1. The first corpus in a
project takes ~2 min (managed DB provisioning); afterwards corpus ≈ 22 s, small upload ≈ 23 s. An upload issued
immediately after corpus creation can return empty; the backend retries up to 3×.

**Sharing** — publish == hospital-wide. `/api/agents` returns your agents plus everyone's published agents;
non-owners can run the published snapshot but not edit. Publish refuses an invalid flow (`validate_flow`).

**Frontend** (`frontend/src`) — React Router + Tailwind (tokens in `tailwind.config.js` from the design system):
- `/hub` Agent Hub: stat tiles, search, category filters, specialty cards.
- `/studio/:id` Agent Studio: core attributes, temperature / top-p, instructions, **knowledge panel** (upload to
  RAG), React Flow canvas with the design's node palette (HIS/EMR, knowledge, LLM, PII mask, condition,
  structured output, connector, approval, output), flow validation banner, cost / latency estimate.
- `/sandbox/:id` Playground with preset test cases, citations, trace, and the **publish to Hub** action.
- `/knowledge` library of every file on agents you can see.
- `/audit` (admin-only, `routers/audit.py`): the Firestore audit collection with today's KPI tiles, category /
  severity / department / search filters, cursor pagination and CSV export (the export is itself audited).
- `VITE_MOCK_API=1` runs the whole UI on in-memory data with no sign-in (design review / demos).
  Add `?login` to preview the login page in that mode.

**Connectors** (`backend/app/engine/connectors.py`, `routers/connectors.py`, UI `/connectors`) — shared hospital-wide
objects; anyone can list and attach, only the owner or an admin edits / tests / deletes. Each type has a field spec
(which fields, which are secrets, which actions) so the setup page is generated, not hand-built. Credentials go to
**Secret Manager** (`tcvgh-conn-<id>-<field>`), Firestore keeps only the name, values never return to the browser.
Real today: `mcp` (Streamable HTTP JSON-RPC, tools discovered by the test button), `webhook`, `slack`, `teams`,
`notion`. Catalog-only: Gmail / Calendar / Drive (OAuth flow next), HIS FHIR, PACS. The canvas `tool` node picks a
connector + action; writes should sit behind an approval node. Every invocation is audited (`connector.invoke`).
Legacy SSE-only MCP servers are not supported. Decided 2026-10-24: explicit tool nodes only, no LLM tool-calling yet.

Node status: `knowledge`, `structured_output` (JSON mode), `pii_mask` (same DLP engine as ingress), `condition` and
`tool` (via connectors) are real; `his_emr` is a stub until the FHIR gateway exists.
A per-agent "deploy to Cloud Run" button was considered and dropped (2026-10-24): agents already run on
the shared platform API, so another container per agent adds cost and no value.

## 3. Local development

```bash
# backend
cd backend && uv sync && cp .env.example .env
uv run uvicorn app.main:app --reload --port 8080
# frontend (proxies /api to :8080)
cd frontend && npm run dev
# frontend only, no backend / sign-in (mock data)
cd frontend && VITE_MOCK_API=1 npm run dev
```

## 3b. Upgrading the deployed sandbox to this version

```bash
source infra/env.sh
bash infra/02-foundation.sh      # adds roles/aiplatform.user + roles/secretmanager.admin to the backend SA + 4 Firestore indexes
bash infra/04-deploy-backend.sh  # new env vars RAG_ENABLED / RAG_LOCATION / RAG_EMBEDDING_MODEL, 2 GiB memory
# frontend deploys from GitHub Actions on push to main (or: cd frontend && npm run build && npx firebase-tools deploy --only hosting)
```
Firestore indexes build asynchronously; the hub's "published" query and the audit page return errors with an
index-creation link until they finish (a few minutes).

## 4. Hardening checklist before TCVGH data touches this
- [ ] `DEID_ENABLED=true` with a KMS key owned by TCVGH; test infoTypes on Chinese records.
- [ ] Add Cloud SQL + Redis to LiteLLM for virtual keys and per-agent budgets.
- [ ] Cloud Armor policy on an HTTPS load balancer in front of the backend.
- [ ] Org Policy `constraints/gcp.resourceLocations` = asia-east1 on the real project.
- [ ] VPC Service Controls perimeter; CMEK on Firestore / GCS.
- [ ] Enforce 2-Step Verification in Workspace Admin (platform admins at minimum).
