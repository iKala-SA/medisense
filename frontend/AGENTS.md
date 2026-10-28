# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Selected product direction
- User selected the Amazon Quick visual style: pale lavender page, white modular panels, fine borders, rounded corners, purple selection and actions. Use the Quick-style generated workbench (exec-952ee15d-5b2f-4a98-9b03-17a8a8205b45.png) and supplied Quick references.
- Keep workbench simple and single-column. All seven requested pages and 11/5 demo path use synthetic data and explicit simulated status. Never represent integrations or security as verified.

## Updated card direction (2026-10-26)
- User supplied a QwenWork integrations screenshot and requested card layouts for every feature except New Conversation.
- Six non-chat pages use white backgrounds, delicate gray borders, 12px card radii, restrained lavender accents and card grids. Workbench activity items, calendar events, to-dos, research reports and connectors are individual cards. Spaces and Agent Hub retain card grids. Audit adds clickable summary cards while retaining the detailed table for scanning.
- Keep chat page layout and interactions unchanged. Browser verification remains deferred at the user's request unless they re-enable it.

## Administration navigation (2026-10-26)
- Use a fixed Quick-style top account banner with account name, user identifier, admin-only Manage Account entry, add account, Traditional Chinese language, preferences and logout. No region selector.
- Audit is removed from the main sidebar for all roles; it lives within Manage Account and only renders for the demo administrator role. The visible role switch remains explicitly a prototype control, not real authorization.
- Model Routing lives within Manage Account. Sensitive-data local routing is immutable and highest priority; editable general rules support order, toggle, group selection and default/fallback. Test drafts before publishing to the in-memory chat routing configuration.

## QwenWork visual system (2026-10-26)
- User requests QwenWork styling across the portal, including chat. Use their earlier QwenWork integrations screenshot as the app UI reference and https://qwenwork.ai/ as supplementary product context.
- White content canvas, very pale cool sidebar, soft violet highlights, light borders, restrained small typography, 12px cards, generous spacing. Preserve the fixed account banner and administrator-only management/audit workflows.
- Live source screenshot and local browser QA remain unavailable under the existing browser-control setting; no fidelity verification is claimed.

## Full-system style correction
- User clarified QwenWork means the entire visual system, not recoloring. Use a 216px cool neutral sidebar, 68px fixed white header, 35px content inset, Inter + Noto Sans TC, 25px semibold page titles, readable 13–14px body text, neutral black/gray text, and purple limited to actions/selection.
- Connector page follows the supplied reference composition with introduction banner, underline tabs/search, and a three-column card grid. HealthAI brand and hospital/admin workflows remain.

## Compact enterprise integrations update
- User requested the latest QwenWork screenshot: real service icons, illustrated integrations banner, tighter enterprise spacing, neutral light-gray sidebar, visible sidebar collapse control.
- Top bar must show only Logo and Account. Removed environment labels, disconnected label, demo guide and role switch from header. Prototype status remains in operational details; role switching is under Preferences > 原型角色設定.
- Icons use Iconify bundled brand data; banner asset is public/assets/integrations-banner.png. Sidebar remains #f8f9fb, purple only for active navigation.

## Medisense identity and conversation (2026-10-26)
- Product and default Agent are named Medisense. Page title, login, brand, footer and CSV filename use Medisense.
- Chat follows user's four screenshots: welcome headline, Agent strip above input, data scope dropdown and plus tools menu left, model selector and send right, compact shortcut pills below.
- Agent picker supports search, tabs and favorites; data scopes support general/all/specific plus mock recent sources. Tools support file-name attachment, Web toggle (simulation), connector and creation actions.
- Models use provider family examples (Gemini Pro/Flash, Claude Sonnet/Opus, OpenAI GPT/Reasoning, on-premise), explicitly not verified versioned endpoints. Mandatory sensitive-data override remains highest priority.

## Targeted cleanup (2026-10-26)
- Chat background must be seamless white. Remove Flow from the composer plus menu.
- Connector illustration now uses Medisense's atom emblem and document/message/calendar/hospital medallions, stored as public/assets/medisense-integrations-banner.png.
- Rename sidebar recents to 最近項目; initialize empty and only populate from actual prototype chats. Clicking a recent chat restores its messages, selected Agent and model. No spaces or research shortcuts in this section. Session memory only.
- Research list must be a borderless grid container; only report cards have borders.

## Calendar demo direction
- User selected daily timeline + right-hand suggestions from supplied Quick screenshot.
- CalendarPanel supports Google Calendar / Outlook Calendar source selection, day navigation, synthetic event detail, focus-time insertion and connector-driven empty states. Default demo date 2026-10-26 Monday.
- Authorization is simulated only; real embeds/feed adapters remain future work documented in CALENDAR-INTEGRATION.md. Never access the user's connected personal calendar to populate this product demo.

## Sidebar and list pages (2026-10-27)
- Sidebar (14px, tight rows, no title row): 對話, 我的工作台, 連接器, 空間; Agent Hub → Agent, 技能, 排程; 模型 → 模型, 路由; 治理 → 安全控管, 稽核記錄 (+ 使用者管理, 用量與成本 for admins). This supersedes the earlier "Audit is removed from the sidebar" and "Model Routing lives in Manage Account" notes. Research is not in the sidebar.
- Header: sidebar toggle (no border) left of the logo, then a divider and "Medisense" (18px). Logo + name is a button that opens a new chat. Do not use Google Sans or the Gemini pill style (tried and reverted).
- 技能 / 排程 / 模型 / 路由 are list pages with a primary 新增 button, search + status tabs, enable toggles. New Agent and new Skill use the full-width editor (AgentCreate.jsx), not a modal.
- "適用範圍" is replaced by 分享 (ShareKit.jsx): specific users, groups, or the whole account, with 可使用 / 可編輯. Agents have no 部門 field in the UI (the backend still requires one; it is set from the signed-in user).

## Backend integration (2026-10-27)
- Backend = `tcvgh-agent-platform` (FastAPI on Cloud Run, Firestore, LiteLLM, Firebase Auth) in project `cloud-sa-sandbox-1`. Do not build a parallel backend; extend that repo on branch `medisense-integration` and deploy only after user review.
- Roles follow the backend: admin | builder | user, from `/api/me`. The prototype role toggle exists only in mock mode.
- Sensitive data follows the backend: always de-identify, then any model; only the `sovereign` group is on-prem only. The prototype's "force on-prem" rule is dropped in live mode.
- Hosting: a new Firebase Hosting site `medisense-portal` (firebase.json) with `/api/**` rewritten to Cloud Run `tcvgh-platform-api`. Do not touch `tcvgh-agent-builder`.
- `VITE_MOCK_API` defaults to mock (self-contained prototype). Set `VITE_MOCK_API=0` plus `VITE_FIREBASE_*` for the real platform. Live pages live in `src/live/`; `src/api.js` is the API client.

## Role management page (2026-10-28)
- Admin sidebar order is 使用者管理 → 角色管理 → 群組管理 → 用量與成本. `RolesPage` (`src/live/RolesPage.jsx`) is read-only: it lists the three fixed roles from `constants.js` with live member counts from `listUsers`. The backend has no roles endpoint, so role definitions are not editable here; role changes stay in 使用者管理.
