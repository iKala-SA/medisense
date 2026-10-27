# Integration API (Medisense frontend <-> backend) — NEW endpoints

All routes need `Authorization: Bearer <Firebase ID token>` unless noted. Roles: `admin` > `builder` > `user` (run-only).
Errors: `{"detail": "..."}` with 401/403/404/409/422/413/415/502. Timestamps are ISO-8601 strings. Existing endpoints are
unchanged; everything below is additive. Backend cannot be exercised against real Firestore from this repo's tests, see "Notes".

## Shared types

```jsonc
// Share  (field `share` on agents, skills, schedules, spaces)
{ "access": "restricted" | "account",      // account = every signed-in user gets `role`
  "role": "use" | "edit",                  // role granted to everyone when access == "account"
  "members": [ { "type": "user" | "group", "id": "<email lower-case | groupId>", "name": "display", "role": "use" | "edit" } ] }
```
Rules: owner and admin always view+edit. `use` = view/run, `edit` = view/run/edit. Only owner/admin delete or change `share`.
`my_role` on skills/schedules/spaces = caller's effective access: `owner | admin | edit | use`.
`PUT .../share` takes a bare `Share` body and returns the full updated object. Group members must exist (422 otherwise).

## Sharing

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/directory?q=` | any signed-in | search box for the share dialog |
| GET/POST | `/api/groups` | admin | list / create |
| GET/PUT/DELETE | `/api/groups/{id}` | admin | PUT = full replace, DELETE -> 204 |
| PUT | `/api/agents/{id}/share` | builder; owner or admin only | audit `agent.share`; returns `AgentOut` |

`GET /api/directory?q=nin` -> `{ "users": [{"email","name","department"}], "groups": [{"id","name","description","member_count"}] }` (max 20 each; suspended users hidden; empty q lists everyone up to the cap).

Group body/response: `{ "name": str(1-80), "description": str, "member_emails": [str] }` (+ `id, created_by, created_at, updated_at` on output). Duplicate name -> 409. E-mails are lower-cased and de-duplicated.

Agents: `AgentIn`/`AgentOut` gained `share: Share` (default restricted/empty), `skill_ids: [str]` (default `[]`), and `model_group` may now be `"auto"`. `PUT /api/agents/{id}` ignores `share` (use the share endpoint) and keeps the stored `skill_ids` if the body omits it. `GET /api/agents` now also returns agents shared with the caller (drafts included). Published agents are still hospital-wide.

## Skills  (`/api/skills`)

| Method | Path | Role |
|---|---|---|
| GET | `/api/skills` | any: own + shared with me (admin: all) |
| POST | `/api/skills` | builder -> 201 |
| GET | `/api/skills/{id}` | viewers |
| PUT | `/api/skills/{id}` | builder with edit rights |
| PATCH | `/api/skills/{id}/enabled` body `{"enabled": bool}` | builder with edit rights |
| PUT | `/api/skills/{id}/share` | owner/admin |
| DELETE | `/api/skills/{id}` | owner/admin -> 204 |

Body (`SkillIn`): `{ "name": str(1-64), "description": str(<=1024), "instructions": str(<=500000), "enabled": true }`.
Output adds `id, owner_uid, owner_email, share, my_role, created_at, updated_at`.
Attach to an agent with `AgentIn.skill_ids`; at run time enabled, viewable skills are prepended (in that order, capped at 100k chars total) to the system prompt of `llm` / `structured_output` steps. Missing / disabled / unshared skills are skipped silently.

## Schedules  (`/api/schedules`)  — any signed-in user

| Method | Path | Notes |
|---|---|---|
| GET | `/api/schedules` | own + shared |
| POST | `/api/schedules` | 201; agent must be visible to caller (404/403) |
| GET / PUT / DELETE | `/api/schedules/{id}` | PUT needs edit; DELETE owner/admin -> 204 |
| PATCH | `/api/schedules/{id}/enabled` | `{"enabled": bool}` |
| POST | `/api/schedules/{id}/run-now` | needs edit; runs as the OWNER; returns `ScheduleRunResult` |
| PUT | `/api/schedules/{id}/share` | owner/admin |
| POST | `/api/schedules/tick` | NO Firebase auth; header `X-Scheduler-Token`; Cloud Scheduler only (not for the frontend) |

Body (`ScheduleIn`): `{ "name": str(1-80), "agent_id": str, "frequency": "daily"|"weekdays"|"weekly_mon"|"monthly_1", "time": "HH:MM" (Asia/Taipei), "prompt": str(1-20000), "enabled": true }`.
Output adds `id, owner_uid, owner_email, share, my_role, last_run: {at, status: "ok"|"error", session_id, error} | null, created_at, updated_at`.
`ScheduleRunResult`: `{ "schedule_id", "status": "ok"|"error", "session_id", "error" }` (run failures return 200 with status `error`; the conversation appears under `/api/sessions` of the schedule owner, titled `[排程] <name>`).
`tick` -> `{ "slot": "YYYY-MM-DDTHH:MM", "checked", "due", "results": [ScheduleRunResult] }`; 401 bad token, 503 when `SCHEDULER_TOKEN` is unset.

## Spaces  (`/api/spaces`)  — any signed-in user

| Method | Path | Notes |
|---|---|---|
| GET | `/api/spaces` | own + shared + every `org` space |
| POST | `/api/spaces` | 201; `type: "org"` is admin-only |
| GET / PUT / DELETE | `/api/spaces/{id}` | PUT needs edit; DELETE owner/admin |
| POST | `/api/spaces/{id}/documents` body `{"document_ids": [str]}` | adds (idempotent); 422 if a doc does not exist / is not visible |
| DELETE | `/api/spaces/{id}/documents/{docId}` | 404 if not in space |
| PUT | `/api/spaces/{id}/share` | owner/admin |

Body (`SpaceIn`): `{ "name": str(1-80), "type": "personal"|"team"|"org", "description": str, "document_ids": [str] }`.
Output adds `id, owner_uid, owner_email, share, documents_count, my_role, created_at, updated_at`. Documents are the existing knowledge-library `documents` (ids from `/api/knowledge`, builder-only list). Per-user favorites are not implemented.

## Routing rules  (`/api/routing`)  — admin

- `GET /api/routing` -> `{ "version", "default_group", "fallback_group", "rules": [{ "id", "name", "condition": "complex"|"simple"|"all", "group": "fast"|"reasoning"|"budget"|"sovereign", "enabled" }], "updated_by", "updated_at" }` (built-in defaults, version 0, when nothing is saved).
- `PUT /api/routing` body = same without `version/updated_*`; bumps `version`, audit `routing.update`. 422 on invalid group (`auto` is not allowed here) or duplicate rule ids.
- `POST /api/routing/test` body `{ "text": str }` -> `{ "group", "reason", "matched_rule": ruleId | null }` against the saved config (dry run).
Semantics: first enabled matching rule wins; "complex" = message contains a reasoning keyword (default list: 分析, 比較, plan, why, summarize); no match -> `default_group`; a rule pointing at an invalid group -> `fallback_group`. Sensitive data is NOT a condition (de-identification is always on). Only `sovereign` is on-prem-only.
`model_group: "auto"` (agent default or node override) is resolved per LLM call with these rules; cost cap and `sovereign_only` still apply afterwards.

## Model registry  (`/api/model-registry`)  — admin  (existing `GET /api/models` is untouched)

| Method | Path |
|---|---|
| GET / POST | `/api/model-registry` (POST -> 201) |
| GET / PUT / DELETE | `/api/model-registry/{id}` (DELETE -> 204) |
| POST | `/api/model-registry/apply` |
| GET | `/api/model-registry/rendered` (null if never applied) |

Body (`ModelEntryIn`): `{ "name", "provider", "litellm_model", "group": "fast"|"reasoning"|"budget"|"sovereign", "deploy": "cloud"|"onprem", "enabled": true, "secret_name": "<Secret Manager NAME only; [A-Za-z0-9_-]>", "api_base": "", "input_price_per_m": 0, "output_price_per_m": 0, "notes": "" }`. Output adds `id, created_by, created_at, updated_at`.
Validation (422): `onprem` only with `sovereign`; `cloud` never `sovereign`.
`apply` renders a LiteLLM `config.yaml` and stores it in Firestore `config/litellm_render`; it deploys NOTHING (an operator runs `infra/09-apply-litellm-config.sh`). Response: `{ "yaml", "version", "status": "rendered", "requested_by", "requested_at", "secrets": [{"secret","env"}] }`.
Prices in the registry are used for cost when a served model is not in the built-in price table.

## Sessions  (`/api/sessions`)  — own sessions only (404 for others', admins included)

- `GET /api/sessions?limit=30&cursor=` -> `{ "items": [{ "id", "title", "agent_id", "updated_at", "message_count" }], "next_cursor": str|null }`, newest first (limit 1-100).
- `GET /api/sessions/{id}` -> summary + `{ "messages": [{role, content}], "attachments": [{id, name, chars}] }` (content is de-identified).
- `PATCH /api/sessions/{id}` body `{"title": str(1-80)}` -> summary. `DELETE /api/sessions/{id}` -> 204.
`title` is set automatically on the first run (`/api/agents/{id}/run`, `/api/chat`): first 30 chars of the DE-IDENTIFIED message.

## Chat  (`/api/chat`)  — any signed-in user

- `POST /api/chat` body `{ "message": str(1-20000), "session_id"?: str, "agent_id"?: str, "model_group"?: "auto"(default)|fast|reasoning|budget|sovereign, "knowledge_doc_ids"?: [str] }` -> same `RunResponse` as `/api/agents/{id}/run`: `{ session_id, reply, trace[], citations[], structured, pending_approval, latency_ms }`.
  Agent: `agent_id` (published snapshot / shared) else the first published agent named exactly `Medisense` else a built-in single-LLM assistant. `model_group` overrides the agent's group (default `auto`). `knowledge_doc_ids` are searched only when the agent's canvas is empty or has a knowledge node. Audit `chat.run`.
- `POST /api/chat/attachments` multipart: `file` (same types as the knowledge library: pdf, txt, md, docx, pptx, html, csv, json; max `MAX_UPLOAD_MB`, default 25 -> 413) and optional form field `session_id` (a new session is created if omitted) -> `{ "session_id", "attachment_id", "name", "chars", "snippet" }` (snippet = first 500 chars of the de-identified text). Max 5 per session (409). Attachment text is added to the model's system prompt for later messages in that session.
- Streaming (`/api/chat/stream`) is NOT available.

## Calendar

`GET /api/calendar/status` -> `{ "connected": false, "reason": "Google Calendar OAuth consent screen not approved yet" }`.

## New audit actions (admin audit page)
access: `agent.share, group.create|update|delete, skill.share, schedule.share, space.share`; build: `skill.create|update|delete|enable|disable, schedule.create|update|delete|enable|disable, space.create|update|delete|documents, routing.update, model.create|update|delete|apply`; inference: `schedule.run, chat.run, chat.attach, session.update|delete`.

## Notes
- New env var `SCHEDULER_TOKEN` (empty disables `/tick`). New Firestore composite index: `sessions(uid asc, updated_at desc)`.
- `SkillOut/ScheduleOut/SpaceOut` list endpoints return everything visible (no paging).
