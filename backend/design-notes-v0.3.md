# TCVGH Agent Platform on GCP — design notes v0.3 (2026-10-23)

Companion to `TCVGH-agent-platform-gcp-architecture.drawio`. Regenerate with
`python3 generate_architecture_drawio.py TCVGH-agent-platform-gcp-architecture.drawio`.
Supersedes v0.2 after TCVGH decisions: PHI option B (de-identify), confirmed model list, MVP limited to the Google Workspace ecosystem, no second H200 and no on-prem operator identified yet.

## 1. Confirmed inputs (2026-10-23)

| Topic | Answer | Design consequence |
|---|---|---|
| Identity provider | Google Workspace | Firebase Auth with Google sign-in only, restricted to the TCVGH Workspace domain. No SAML federation, no on-prem AD dependency. |
| MFA | Not enforced | Recommend enforcing 2-Step Verification in Workspace Admin for all users, mandatory for platform admins. Platform cannot add MFA on its own without this. |
| Connectors | MVP = Google Workspace ecosystem only | Gmail / Calendar / Drive / Docs via an *internal* OAuth app in the TCVGH tenant (no Google external verification). Google Chat as the second channel. Slack, LINE, Microsoft 365 move to phase 2. |
| PHI | Stays on-prem; reaches an agent only through a user upload. **Option B chosen: de-identify.** | HIS / EMR are not connected. Sensitive Data Protection pseudonymizes every upload and prompt (deterministic encryption with a KMS-held key) before storage or any model call. Re-identification only through an authorized role. |
| On-prem GPUs | 1x H200 today running gpt-oss-20b and Gemma 4 26B-A4B; upgrade options gpt-oss-120b, Gemma 4 31B dense; Llama 3.3 70B needs 1–2x H200. No operator identified, second H200 not planned. | LiteLLM talks to the existing OpenAI-compatible server over HA VPN. Treat as capacity-limited: rpm/tpm caps in LiteLLM, cloud overflow for non-sovereign agents. `sovereign` group = on-prem only. |
| Funding SOW | Not needed now | Skip PSF/DAF paperwork. |
| Cloud models (TCVGH list) | Gemini 3 Flash, Gemini 3.1 Pro (Vertex); GPT-5.4 (Azure OpenAI Data Zone); Claude Sonnet 4.6, Claude Haiku 4.5, Amazon Nova 2 Lite (Bedrock cross-region); GPT-5 as TMMLU+ reference | All through LiteLLM. Azure and Bedrock are outside Taiwan, so they only ever see de-identified text, which option B guarantees. Claude on Vertex AI is the in-region alternative to Bedrock cross-region. |

## 2. What changed in the diagram (v0.2 → v0.3)

- Guardrail card is now a de-identification step (option B) in front of storage and every model call.
- Cloud-model box lists the real TCVGH list: Azure OpenAI GPT-5.4 (Data Zone) and Bedrock cross-region Claude Sonnet 4.6 / Haiku 4.5 / Nova 2 Lite. Vertex card shows Gemini 3 Flash and 3.1 Pro.
- Connected-apps box is Google Workspace only (identity, Gmail, Calendar, Drive, Docs) plus a Google Chat app channel. Slack, LINE and Microsoft 365 are a grey phase-2 card.
- Model groups renamed: fast / reasoning / budget / sovereign. `sovereign` = on-prem only, fail closed.
- On-prem card notes operator TBD and capacity limits.
## 3. PHI handling: decision = option B (de-identify)

Flow: upload or prompt → Sensitive Data Protection `deidentifyContent` with built-in infoTypes (PERSON_NAME, TAIWAN_NATIONAL_ID_NUMBER, PHONE_NUMBER, EMAIL_ADDRESS, DATE_OF_BIRTH, MEDICAL_RECORD_NUMBER, custom hospital ID regex) using `CryptoDeterministicConfig` with a Cloud KMS-wrapped key → pseudonymized text is what gets stored in Firestore / GCS and sent to any model. Re-identification (`reidentifyContent`) is a separate API call allowed only to a `phi-reidentify` IAM role, logged in Data Access audit logs. Because tokens are deterministic, the same patient maps to the same token within a session, so the model can still reason about "the same person".

Consequences: identified PHI never persists in GCP; Azure and Bedrock receive only pseudonymized text; answers come back with tokens that the UI can re-identify client-side for authorized users via the Platform API.

## 4. Model routing design

LiteLLM model groups (aliases agents pick in the builder):

| Group | Primary | Fallbacks | Notes |
|---|---|---|---|
| fast | Gemini 3 Flash (Vertex, asia-east1) | gpt-oss-20b (on-prem), Claude Haiku 4.5 (Bedrock) | default for chat / extraction |
| reasoning | Gemini 3.1 Pro (Vertex) | Claude Sonnet 4.6 (Bedrock), GPT-5.4 (Azure Data Zone), gpt-oss-120b (on-prem) | planning, long documents |
| budget | Gemma 4 26B-A4B (on-prem) | Amazon Nova 2 Lite (Bedrock), Claude Haiku 4.5 | bulk / low-cost steps |
| sovereign | gpt-oss-120b (on-prem) | Gemma 4 26B-A4B / 31B (on-prem) | **on-prem only, fail closed**; for departments that refuse any cloud model even for pseudonymized text |
| benchmark | GPT-5 | none | TMMLU+ reference only, not routed to agents |

Per-agent routing policy = rules (task type, PHI flag, cost tier) plus an optional small classifier
running in the Agent Runtime. LiteLLM then handles failover, cooldowns and budgets inside the group.

On-prem capacity on one H200 (141 GB): gpt-oss-20b (~16 GB, MXFP4) and Gemma 4 26B-A4B fit together.
gpt-oss-120b (~63 GB, MXFP4) also fits alone or with gpt-oss-20b. Llama 3.3 70B needs two H200 in
bf16 or one in FP8. Each model is one vLLM process; LiteLLM rpm/tpm limits protect the server.
Overflow for fast / budget groups spills to cloud; sovereign traffic queues or fails closed. Operator for the server is still unassigned, so the MVP treats on-prem as best-effort.

## 4b. Verified in the sandbox (2026-10-23)

- **Gemini is not served from asia-east1.** Probing Vertex AI `generateContent` from project `cloud-sa-sandbox-1`: every Gemini ID returns 404 on the asia-east1 regional endpoint. `gemini-3-flash-preview` and `gemini-3.1-pro-preview` answer only on the `global` endpoint; `gemini-2.5-flash` / `gemini-2.5-pro` answer on `global` and `us-central1`. LiteLLM therefore uses `VERTEX_LOCATION=global`. Because option B pseudonymizes everything first, this is acceptable, but the diagram no longer claims in-region Gemini inference and TCVGH must be told. Re-check regional availability before go-live; Claude on Vertex and on-prem remain the Taiwan-resident options.
- The sandbox's `(default)` Firestore database is in `nam5` (US) and shared; the platform uses a dedicated named database `tcvgh-agent-platform` in asia-east1.
- LiteLLM `model_info.tier` is reserved (free/paid); custom metadata must use another key.
- Cloud Run's frontend answers `/healthz` itself, so the app health route is `/api/health`.
- Google sign-in was already enabled on the sandbox Identity Platform; Hosting site `tcvgh-agent-builder` created and added to authorized domains.

## 5. Feasibility review (updated)

Green: Firebase + Cloud Run + Firestore + GCS, Google sign-in restricted to the Workspace domain,
internal Workspace OAuth app, LiteLLM with vLLM targets, ADK on Cloud Run.

Amber:
1. De-identification config (infoTypes, custom hospital-ID regex, KMS key ownership) must be reviewed by TCVGH information security; test recall on real-looking Traditional Chinese records.
2. 2-Step Verification is a Workspace admin decision outside the platform.
3. Google Chat app needs a Workspace admin to publish it internally; Gmail/Calendar scopes need the internal OAuth consent screen approved by the Workspace admin.
4. Canvas interpreter is the main custom build; MVP with six node types.
5. VPN to on-prem: HA VPN is enough for chat traffic; confirm the on-prem firewall team can expose the vLLM endpoint on a private IP with mTLS.
6. LiteLLM is OSS; pin versions, keep config in GCS with CI validation, plan upgrades.
7. Multi-cloud credentials: Azure OpenAI and Bedrock keys live in Secret Manager and are mounted only into the LiteLLM service; budgets per key.

Red: tokens or API keys in Firestore; agent write actions without approval policy; any HIS integration in phase 1.

## 6. Phasing

- Phase 1 (MVP, sandbox project `cloud-sa-sandbox-1`): Google sign-in, builder with six node types, Vertex Gemini via LiteLLM, de-identification on uploads and prompts, web chat, Gmail + Calendar + Drive connectors with approvals, spend dashboards, audit logs. On-prem and Azure / Bedrock entries pre-configured in LiteLLM but disabled until credentials and VPN exist.
- Phase 2: Google Chat channel, on-prem `sovereign` group over VPN, Azure + Bedrock providers, RAG knowledge bases, scheduled agents, Model Armor, VPC Service Controls, Slack / LINE / Microsoft 365.
- Phase 3: agent evaluation in BigQuery, templates and department budgets, Vertex self-deployed open models if on-prem capacity runs out.

## 7. Remaining questions
1. Who owns the Cloud KMS key for de-identification, and which roles may re-identify?
2. Which Workspace admin can approve the internal OAuth consent screen and publish the Google Chat app?
3. Is Azure OpenAI Data Zone already contracted, and does TCVGH have an AWS account for Bedrock, or should Claude come through Vertex AI in-region instead?
4. Who will operate the on-prem vLLM server for the VPN phase?
5. Expected builder and end-user counts for sizing.
