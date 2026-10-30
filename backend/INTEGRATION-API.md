# Integration API (Medisense frontend <-> backend) — NEW endpoints

All routes need `Authorization: Bearer <Firebase ID token>` unless noted. Roles: `admin` > `builder` > `user` (run-only). The role list (`/api/roles`) shows the system roles `admin`, `builder`, `user` plus custom roles.
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

## Roles (admin-only, read-only so far; reads Firestore `roles`)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/roles?search=&type=all\|system\|custom` | admin | role list + stats; see `specifications/BE-ROLE-SPEC.md` |

Response: `{ "roles": [{ "id", "name", "en", "desc", "custom", "suspended", "member_count", "permission_count", "can": ["label", ...] }], "stats": { "total_roles", "system_roles", "custom_roles", "assigned_users" } }`. System roles `admin` / `builder` / `user` are always listed (overridable via `roles/{id}`); `stats` ignores the filters. `can` holds the capability labels the frontend shows (e.g. `"發布核可"`); `permission_count` = len(can). Custom roles have no `en` and empty `can`. Create, update and delete, and the per-resource matrix, are not implemented yet.

## Sharing

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/directory?q=` | any signed-in | search box for the share dialog |
| GET/POST | `/api/groups` | admin | list / create |
| GET/PUT/DELETE | `/api/groups/{id}` | admin | PUT = full replace (includes `member_emails`), DELETE -> 204 |
| PATCH | `/api/groups/{id}` | admin | partial update of `name` / `description` / `role_ids` (`{name?, description?, role_ids?}`); members unchanged; duplicate names allowed; `role_ids` must reference existing roles (422 `unknown role` otherwise; `admin` and `user` are allowed); it is a link only and grants no permissions yet; see `specifications/BE-GROUP-SPEC.md` §4.3 |
| GET / POST | `/api/groups/{id}/members` | admin | member list (`GroupMemberOut[]`) / batch add `{emails[≤100]}` -> `{added, skipped, rejected[{email, reason: invalid_email \| domain_not_allowed \| not_a_registered_account}]}`; only existing accounts; 422 if the group would exceed 1000; §4.5 |
| DELETE | `/api/groups/{id}/members/{email}` | admin | remove one member -> 204; 404 if not a member; §4.5 |
| PUT | `/api/agents/{id}/share` | builder; owner or admin only | audit `agent.share`; returns `AgentOut` |

`GET /api/directory?q=nin` -> `{ "users": [{"email","name","department"}], "groups": [{"id","name","description","member_count"}] }` (max 20 each; suspended users hidden; empty q lists everyone up to the cap).

Group body/response: `{ "name": str(1-80), "description": str, "member_emails": [str] }` (+ `id, created_by, created_at, updated_at` on output). Duplicate names are allowed. E-mails are lower-cased and de-duplicated.

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

## Open Connector gateway: per-user connectors and the service catalog

The backend talks to an internal Open Connector gateway (`OPEN_CONNECTOR_URL`, `OPEN_CONNECTOR_TOKEN`, optional `OPEN_CONNECTOR_IAM_AUDIENCE`).
Tokens and credentials live in the gateway only. A user's own grants are gateway connections named `u-<uid>`; a shared credential is `s-<connectorId>`.

### Using a connector (any signed-in role)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/my-connectors` | Connectors shared with me: `{id, type, service, mode: user_oauth\|shared\|none, label, description, allowed_actions, state: connected\|not_connected\|reauth_required\|shared\|unavailable, account_label, scopes, problem}` |
| POST | `/api/my-connectors/{id}/connect` | `{authorization_url, state}` for my own grant (409 for shared/no-auth connectors, 503 if the OAuth client is not set up) |
| GET | `/api/my-connectors/{id}/status` | one item, same shape |
| DELETE | `/api/my-connectors/{id}/connection` | disconnect and revoke my grant |
| GET | `/api/oc/oauth/callback` | public OAuth redirect target, relayed to the gateway; nothing else of the gateway is exposed |
| GET | `/api/calendar/status`, `/events?from&to&max`, `/freebusy?from&to` | my own Google Calendar (read-only); 409 when not connected |

### Browsing everything the gateway supports (builder / admin)
- `GET /api/gateway-catalog?q&category&auth&enabled_only&offset&limit` -> `{total, gateway_total, items:[{service, name, homepage, icon_url, categories, auth_types, enabled_type}], facets:{categories, auth}, enabled}`
- `GET /api/gateway-catalog/{service}` -> `{name, homepage, categories, auth_types, action_count, executable_count, trigger_count, actions:[{id, name, description, operation: read\|write\|destructive}], enabled_type}`

### Enabling a service (admin only; one connector per service)
- `GET /api/gateway-connectors/setup/{service}` -> `{auth_options:[{type, fields:[{key,label,inputType,required,secret,placeholder}], scopes}], oauth_client:{configured, expected_redirect_uri, missing_fields}, actions:[{id,name,description,operation,scopes}], existing_connector_id}`
- `POST /api/gateway-connectors/preview-scopes` `{service, allowed_actions}` -> `{scopes, identity_scopes, data_scopes, operations, grants_write}`; nothing is saved
- `POST /api/gateway-connectors` `{service, label, description, auth_mode: oauth2\|api_key\|custom_credential\|no_auth, allowed_actions:[ids], client:{...oauth client fields}, credentials:{...}, share}` -> ConnectorOut (`type: "gateway"`, `config:{service, auth_mode, allowed_actions, scopes}`); oauth2 asks users only for the scopes the allowed actions need; a rejected shared credential returns 422 and creates nothing
- `PUT /api/gateway-connectors/{id}` `{label?, description?, allowed_actions?, client?, credentials?}`
- Everything else (list, share, test, actions, delete) uses `/api/connectors/{id}...`; `GET /api/connectors/{id}/actions` returns the allowed actions with args derived from each action's input schema.
- Agent tool nodes call a gateway connector as the running user (oauth2) or through the shared credential; results are de-identified when the connector's `redact_pii` is on.
