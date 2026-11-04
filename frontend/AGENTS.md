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

## User management per FE-USER-SPEC (2026-10-29)
- Source of truth: `specifications/FE-USER-SPEC.md`. `UsersPage.jsx` tabs are 全部 / 啟用 / 停用 (role tabs and 待註冊 tab removed, so there is no role filter; 待註冊 is still shown in the status column).
- Toolbar has Group and Role dropdowns (defaults 全部群組 / 全部角色) between search and tabs, all combined with AND.
- UI label for the `department` field is now 群組 everywhere on the page (list, filter placeholder, pre-register dialog, edit page, savebar summary). The API field name stays `department`, and the options are still the 12 departments from `constants.js`. Note the Group filter is a sharing group (`/api/groups`), a different thing from this field.
- List table: 姓名 (email shown small below the name), 群組 (shows `department`), 角色, 狀態 (停用 / 啟用 only), 最近登入, arrow. The 固定管理員 label and 待註冊 status are not shown in the list; `StatusBadge` also shows only 停用 / 啟用 on the edit page. Group = sharing group from `/api/groups` (`member_emails`, matched case-insensitively on the client); the users list has no group field.
- Search matches `name` and `email` only (placeholder 搜尋姓名或電子郵件), per §3.3. 群組 is the `department` concept with no hierarchy; resource-sharing is deferred (§9 #14).
- Stat cards (§3.2) sit under the subtitle: 使用者人數 / 啟用人數 / 停用人數, computed from all loaded users (not the filtered list), with a 收合統計 / 展開統計 toggle (expanded by default). Styled by `.lv-stats` in `admin.css`.
- Refresh (§3.1) calls the list API only on click. Users and groups load once on mount, not via an effect that depends on `notify`: App recreates `notify` each render, so such an effect would re-call the API after every failure.
- Original-file-view options use the spec labels: 不可檢視含個資的原始檔（預設） / 可檢視含個資的原始檔（需填用途）.
- Open items in spec §9 (e.g. audit deep link, unsaved-change confirm, Firebase sync warning) are not implemented until the owner confirms them.

## Role management wired to /api/roles (2026-10-29)
- `RolesPage` loads `api.listRoles()` (`GET /api/roles`) once on mount. Rows, stats, search, the 全部 / 系統預設 / 自訂 tabs and the 權限設定 header use the response: `name`, `en`, `desc`, `custom`, `suspended`, `member_count`, `permission_count`, `can`. Filtering is client-side on the loaded list.
- Icons are chosen in the frontend by role id (`ICON` in `RolesPage.jsx`); unknown ids fall back to a generic icon. The backend does not return icons.
- The page renders only in live mode, so there is no mock data for it in `src/bk/mock.js`.
- The backend endpoint `GET /api/roles` is admin-only (`require_admin`) and reads the `roles` collection (system roles fall back to built-in values when no document exists).
- This supersedes the 2026-10-28 note above: role definitions are no longer hard-coded in the page.

## Role list trimmed (2026-10-29)
- `RolesPage` lists the system roles `admin`, `builder`, `user` (plus any `roles/{id}` custom documents). `ai-reviewer` and `trainer` are not in the list.
- Role type (系統預設 / 自訂) follows the API `custom` field, which comes from the stored `roles/{id}` document (fallback: id is not admin/builder/user).
- 角色管理 and 群組管理 have a 重新整理 button (admin only), matching 使用者管理. Refresh keeps the current list on failure.

## Group and role scope reduced (2026-10-30)
- Scope is admin interface plus the `admin` and `user` roles only. Custom roles, the permission matrix and RBAC enforcement are deferred. `builder` stays as it is today and is outside RBAC.
- Group grants of roles (`role_ids`) are dropped. Groups have no effect on access; they are member lists (shared with sharing for now). Primary group and 科別 merge are deferred.
- User management keeps the `department` field and its 12 fixed values; the UI label is 群組. The `Group` filter that clashed with the groups-management 群組 has been removed from 使用者管理 (decided 2026-10-30; `FE-USER-SPEC.md` §3.3, `FE-GROUP-SPEC.md` Q2). `UsersPage.jsx` no longer loads `/api/groups` or renders the filter.
- `RolesPage` stays read-only. Permission settings and custom-role UI are marked 暫緩 in `FE-ROLE-SPEC.md`.
- Specs: `specifications/FE-GROUP-SPEC.md`, `specifications/BE-GROUP-SPEC.md`, `specifications/FE-ROLE-SPEC.md`, `specifications/BE-ROLE-SPEC.md`.

## Group management implements member CRUD (2026-10-30)
- `GroupsPage` is a list plus a single edit page: 基本資料 section on top, 成員 section below (the tabs were merged 2026-10-30). Each section header has a `Toggle` to collapse or expand it; collapsed content stays mounted so edits are kept. No role grant section.
- Basic info has a 角色 field: group ↔ `roles/{id}` links (compact tags on the same row as a search box over `GET /api/roles`; the candidate list is a focus-only overlay of at most 10 items; admin and user are selectable). Saved with PATCH as `role_ids`. The link has no access effect yet; the UI says so.
- Members can be selected with checkboxes (per page, selection kept across pages, cleared on search change) and removed in batch. The batch calls the single-member DELETE endpoint for each e-mail; failed items stay selected and the dialog stays open. Members are added and removed one by one through `/api/groups/{id}/members`; the add dialog only accepts existing accounts and reports skipped / rejected e-mails.
- Basic info saves with `PATCH` so editing a name cannot overwrite the member list. `api.updateGroup` (PUT) is no longer called from the UI; the backend keeps PUT until `BE-GROUP-SPEC.md` Q4 is decided.
- Member e-mail check matches the backend (contains `@`, no whitespace). Suspended accounts are not suggested but can be typed in.
- Not yet implemented: Esc to close and unsaved-change prompt in the add dialog. Browser verification was not run.

## Deferred role features removed (2026-10-30)
- Removed from `RolesPage` per the 暫緩 list in `FE-ROLE-SPEC.md`: the 權限設定 page (`RolePermissionsPage.jsx` deleted), the row action menu (編輯 / 權限設定 / 停用 / 刪除), the 權限數 and 操作 columns, and the 自訂 tab and 自訂角色 stat card.
- 2026-10-30 follow-up: a 自訂角色 stat card (`stats.custom_roles`) was added back at the user's request, so the stats row has three cards again.
- Kept: the 類型 column (系統預設 / 自訂), 全部 / 系統預設 tabs, the 角色總數 and 系統預設角色 stat cards, search, 重新整理, the disabled 新增角色 button, and the footer notice.
- `GET /api/roles` still returns `can`, `permission_count` and `custom` stats; the page no longer reads them. Backend is unchanged.

## Role detail editing (2026-11-02)
- `RolesPage` gained a `>` column; clicking a row opens `RoleDetail` (same pattern as 使用者 / 群組), with 返回角色列表 and an unsaved-change confirm.
- Editable: 角色名稱 and 說明 only, saved via `api.updateRole` (`PATCH /api/roles/{id}`, which writes `roles/{id}` and an audit entry). 英文名稱, 類型, 狀態, 成員數 and the 權限標籤 are read-only.
- 系統管理員 is fixed: the page is read-only and the backend returns 403.
- Permission matrix and custom-role creation are still not implemented; the 權限標籤 are display-only.
- 新增角色 is enabled. `CreateRoleModal` (in `RolesPage.jsx`) mirrors the 新增群組 dialog: name (required, ≤40) and description; it calls `POST /api/roles`, then opens the new role's detail page. Custom roles are created with `custom: true` and no permission labels.
- The role detail page is one 基本資料 card: 角色名稱, 英文名稱 (optional, editable through `PATCH /api/roles/{id}` `en`), 說明, then read-only 類型 and 狀態 (類型 was removed from the detail page on 2026-11-02; the list keeps its 類型 column). The separate 角色資訊 card and the 成員數 line are removed from the detail page; the list keeps its 成員數 column.
- Role detail: 狀態 is a switch (true = 啟用, disabled for 管理員). 權限標籤 can be added and removed (display-only). 類型 is no longer shown on the detail page (2026-11-02). Everything saves through one 儲存 button via `PATCH /api/roles/{id}`.
- Custom role ids are generated by the system; users cannot choose a code (decided 2026-11-02). The create dialog only asks for name and description.
- Roles list drops the 成員數 column. The role detail page has a 刪除角色 button (same pattern as 刪除群組: red button in the page heading, confirm dialog, dialog stays open on failure). It is enabled only for custom roles; built-in roles and 管理員 show it disabled with a reason. `DELETE /api/roles/{id}` also removes the id from groups' `role_ids`.
- Role detail page can assign the role to users and groups (2026-11-02). Users get a new `users.roles` array (role ids), written by `PATCH /api/users/{email}` with `roles` (replaces the list; ids must exist, 422 otherwise; audit `user.roles`; no reason required). It is record only: access still follows the user's `role` field, which is unchanged. Groups link through `role_ids` as before. Deleting a custom role also removes it from users' `roles`.
- Role detail assignment lists are tables with search and per-row 移除 (users: 姓名 / 電子郵件 / 群組 / 狀態; groups: 名稱 / 說明 / 成員數). 加入 opens a multi-select dialog (`AddLinksModal`); each selected item is saved with its own PATCH, and failures are reported by count. Both lists are record only (2026-11-02).
- The assignment lists (指派使用者 / 關聯群組) stay editable for the 管理員 role, unlike the role's own fields. Backend accepts `admin` for both `users.roles` and group `role_ids`.
- Role detail 權限 section (2026-11-02): the 權限標籤 free-text chips are replaced by a 權限 list backed by `roles/{id}.permissions` (resource ids from `GET /api/permissions`). 新增權限 opens the same multi-select dialog as the assignment lists (`AddLinksModal`); each change PATCHes the whole list. The `can` labels stay in the API for display but are no longer edited in the UI. Missing `permissions` on existing documents counts as an empty list; no backfill. 管理員 remains read-only.
- The 權限, 指派使用者 and 關聯群組 lists on the role detail page show about 5 rows (`.rl-scroll`, max-height 296px) and scroll beyond that (2026-11-02).

## Groups menu gated by the `groups` permission (2026-11-02)

- 群組管理 (`Groups`) in the 治理 menu and its AdminHome tile appear only when `me.permissions` contains `groups` (from `GET /api/me`; ids from `app/permissions.py`). Users without it do not see the entry, and the page does not render even if the page key is set.
- This is a UI convenience only. `GET/PUT/POST/PATCH/DELETE /api/groups` still require `admin` (`require_admin`); a non-admin user with the `groups` permission will see the page but get 403 from the API until the permission matrix is enforced on the backend.
- Preview mode (`VITE_BK_PREVIEW_ROLE`) builds `me` without `permissions`, so 群組管理 is hidden there.

## Users and Roles menus gated by permissions (2026-11-02)

- 使用者管理 (`Users`, permission `users`) and 角色管理 (`Roles`, permission `roles`) follow the same rule as 群組管理: the menu item and AdminHome tile appear, and the page renders, only when `me.permissions` contains the id. `adminNavPerm` in `App.jsx` maps each page key to its permission; items without an entry (e.g. `Monitoring`) are not gated.
- Still UI only: the backend guards (`require_admin`) are unchanged. `UsersPage` keeps its own 系統管理員-only notice for non-admin users.

## Non-chat pages follow the 新對話 page (2026-11-03)

- Every page other than 新對話 is restyled to `docs/UI-DESIGN-2026-10-28.md` §2. Shared rules live in `src/page-style.css`, scoped to `main.card-page` and loaded after `radius.css`: 22px page titles, 12px grey subtitle, 32px pill buttons, 34px search and selects with 10px corners, underline tabs in brand green, 14px cards with a neutral hairline (hover darkens the edge, never a green wash), 46px table rows with grey 12px headers, grey role and status labels, neutral notices, 20px dialogs.
- The lavender greys and green-tinted neutrals left in `src/live/*.css` were mapped to the neutral palette (text #5d6068 / #7b828d / #9a9ca3, lines #e6e8eb / #f0f1f3); stray greens are now #239660. The bk Tailwind palette in `tailwind.config.js` uses the same values.
- 用量與成本 (bk Monitoring) has a plain page heading instead of a header card, compact KPI cards without mono or uppercase labels, and segmented filters with a white thumb.
- Agent and 流程 row menus and the 建立 menu go through `fitMenu`.

## Connector writes confirmed in chat (2026-11-03)
- A connector write that an agent capability marks 需核准 now pauses the chat turn with `pending_approval.approver === 'user'`. `ChatAnswer` renders `ApprovalCard` (message, argument preview, 確認執行 / 取消) inside the same answer bubble; `App.decideLive` calls `api.chatApprove(session_id, approve)` and replaces that bubble with the outcome, appending the approval and tool steps to its trace. Reopened sessions get `pending_approval` from `GET /api/sessions/{id}` and show the card on the last entry.
- `approver === 'owner'` (a canvas approval node) keeps the old text: the agent owner or an admin decides in the Agent page; no buttons in chat.
- Connectors page: the Google Calendar 寫入動作 checkboxes are live (`write_actions`); 我的連線 shows a 重新授權 hint when the grant lacks a newly required scope (`missing_scopes`).
- The + menu's connector rows (general chat) run the OAuth popup in place (`connectAccount`): 連接 when not connected, 重新授權 when the grant lacks a newly required scope, and a quiet 重新授權 beside the check of a connected account so the user can refresh their token without leaving the chat (2026-11-04).

## Read-only permission for groups (2026-11-03)

- The `-viewer` ids in `app/permissions.py` now have an effect, starting with 群組管理 only. `groups-viewer` opens the page read-only: the list, group detail, base info and member list are visible; create, edit, delete, member add/remove and the role picker are hidden or disabled. `groups` allows editing.
- The menu item shows for either id (`canGroups` in `App.jsx`). `GroupsPage` derives `canEdit` (`groups`) and `canView` (`groups` or `groups-viewer`) from `me.permissions`. Non-viewers see a 沒有群組管理權限 notice.
- Still UI only: the API enforces the same rule (`require_permission("groups")` for writes, `groups` or `groups-viewer` for reads). Other pages keep their existing checks until they are migrated.

## Read-only permission for roles (2026-11-03)

- 角色管理 follows the same rule as 群組管理: `roles-viewer` opens the page read-only (list, role detail, base info, permissions and linked users/groups are visible; create, edit, status, delete, permission and link changes are hidden or disabled). `roles` allows editing. The menu shows for either id (`canRoles` in `App.jsx`); `RolesPage` derives `canEdit` and `canView` from `me.permissions`.
- Backend: `/api/roles` reads need `roles` or `roles-viewer`, writes need `roles`; `/api/permissions` (read-only catalog) needs `roles` or `roles-viewer`.
- Known gap: the linked users and groups in 角色細節 still come from `/api/users` (admin-only) and `/api/groups`, and assigning users goes through `PATCH /api/users/{email}`. A non-admin with `roles` can edit the role itself, but user-link loading and assignment fail until those routes are migrated.

## Read-only permission for users (2026-11-03)

- 使用者管理 follows the same rule as 群組管理 and 角色管理: `users-viewer` opens the page read-only (directory, account detail, and the status, role, department and original-view controls are disabled). `users` allows editing, pre-registration, cancelling a pre-registration and CSV export (export carries personal data, so it stays write-level). The menu shows for either id (`canUsers` in `App.jsx`); `UsersPage` derives `canEdit` and `canView` from `me.permissions`.
- Backend: `/api/users` reads need `users` or `users-viewer`; writes and export need `users`. The admin account role always passes.
- Still open: 角色細節 assigns users through `PATCH /api/users/{email}` (now `users`), so a user with `roles` but without `users` can edit the role itself but not its user links.
- BigQuery authorization (2026-11-04): the 授權 BigQuery chip also shows in general chat when a picked data source is a BigQuery connector (`PickData` rows carry `kind`), and pressing send / Enter opens the Google popup first when the token is missing (`submit` in `ChatComposer`). The token is kept in `sessionStorage` for the tab (55 min), so a reload no longer asks again; signing out clears it.
- BigQuery long-lived authorization (2026-11-04): when an admin has enabled the `google_bigquery` gateway service and the user connected it in 我的連線, the backend runs BigQuery through that grant (refreshed by the gateway) and the composer shows no token chip at all. If the service exists but the user has not linked it, the chip reads 連線 BigQuery 帳號 and send / Enter runs that one-time OAuth popup (`connectAccount`); only without such a service does the hourly 授權 BigQuery（1 小時） token remain.
- 最近項目 ⋯ menu has 刪除所有對話歷史 (2026-11-04): confirm dialog, then `DELETE /api/sessions` removes every conversation of the signed-in user (recent, archived, in projects) with their images and share links; locked conversations are kept and the count is shown. Projects are not deleted. The open chat is reset to 新對話.
- Space page documents (2026-11-04): the heading's primary 加入文件 button now uploads from this computer (DocUploader `bare` mode: one button opening the file picker, no selects — category defaults to 其他 (`other`) and department to the uploader's own, no dashed drop zone); the explanation line (supported formats → DLP → embedding → CMEK) stays as plain text under the heading. Adding existing library documents from the space page was removed (2026-11-04); documents reach a space by upload only.
- Document upload progress (2026-11-04): `api.uploadDocProgress` uploads with XHR so the bytes going up are reported; `DocUploader` (library and space page) shows a progress bar — 上傳中 N% with a filling bar, then 去識別化並建立索引中 with a sweeping indeterminate bar (`.bk .bar-indeterminate`, still under reduced motion) — plus an i / n counter for multi-file uploads.
- 參考文件 lists everything the answer drew on (2026-11-04): cited documents first (renumbered), then database queries (`kind: "database"`, tagged 資料庫), then retrieved-but-uncited documents (`cited: false`, tagged 未引用). Earlier the tab hid uncited sources, so an answer that found passages but cited none showed 0.
- Conversations remember their setup (2026-11-04): each chat turn stores `context` on the session (knowledge scope, picked spaces / databases with names and kind, web search, pinned model / group) next to `agent_id` / `agent_name`; `/api/sessions` and `/api/sessions/{id}` return them. Reopening a conversation, even after a reload, restores the agent, the 已選資料 chips, the data scope, web search and model (`restoreContext` in `App.jsx`). `openRecent` sets the agent directly: `setActiveAgent` starts a new thread when the agent changes, which used to drop the reopened session id.
- Skills with / (2026-11-04): picking a skill writes "/名稱 " into the input text at the cursor (no chip row above the textarea, so the input keeps its width); deleting that text drops the skill. On send the "/名稱" tokens are stripped from the question the model gets (the skill travels as `skill_ids`), the input and the user bubble show them in blue (#1a6de0, ChatGPT style): in the input via a mirror layer over the textarea (`.ta-mirror`, the textarea glyphs go transparent while a skill is present), in the bubble via `SlashText` (`.um-skill`), and the backend stores the names on the user message (`messages[].skills`) so a reopened chat shows them again.

## Real groups instead of the fixed 科別 list (2026-11-04)
- The fixed department dropdown (內科部 … 智慧醫療組) is replaced by the real groups of 群組管理 wherever it is reachable: 稽核記錄 filter (`group` → events by that group's members, matched on actor e-mail or uid), 用量與成本 filter (`group` → usage of the members, computed from the raw `usage` ledger since the daily rollups are per agent), and 使用者管理 (the 群組 column lists the person's groups; 編輯使用者 has one toggle per group and saves through `/api/groups/{id}/members`; 預先註冊 can add the new account to a group). Shared loader: `src/live/orgGroups.js` (`useOrgGroups`).
- Not changed: the legacy bk Studio and its knowledge panel (no entry point in live mode), and stored `department` values on agents / documents / users (still shown as read-only text where they appear, e.g. 稽核 detail "所屬科別").
- This supersedes the 2026-10-30 note that user management keeps the fixed `department` values labelled 群組.
- Agent editor 自訂 section (2026-11-04): 圖示, 部門, 模型偏好 and 思考深度 are removed. A 模型 dropdown lists the exact models of `GET /api/models` (same list as the chat model picker) plus 自動（智慧路由）; it is stored as `agent.model`. At run time the person's own pick in the chat box wins, then the agent's model, then routing; 僅院內模型 and a model the gateway no longer serves fall back to routing. Existing `icon` / `department` / `capabilities.model_pref` / `thinking` values stay stored (flows still read model_pref and thinking).

## Admin menu and 編輯使用者 redesign (2026-11-04)
- 安全控管 is removed from the admin menu (its live page only showed health and a read-only policy; the web-search / voice switches live on 路由). Admin order: 使用者管理 → 群組管理 → 角色管理 → 用量與成本.
- 編輯使用者 is one centred column (max 980px) with a tinted header (avatar, badges, 帳號建立 / 最後活動 / owned counts; 首次登入 no longer shown) and a 2×2 grid of compact panels: 角色 (scrollable single choice over the real roles of `GET /api/roles`, system and custom), 群組 (scrollable multi-select of the real groups, with search when there are more than 6), 帳號狀態 and 原始檔檢視 (segmented). Picking a custom role sets `users.roles=[id]` and the base account role to `user` (its permissions come from the role); picking a system role sets both. Styles: `.ue-*` in `admin.css`. The backend now refuses changing one's own assigned roles.
- 用量與成本 layout (2026-11-04, second pass): no title / badge / description; underline tabs 成本監控 | 用量管理 at the top (refresh + CSV on the right of 成本監控). 成本監控: one filter row (period, 正式 / 沙盒, 篩選對象 全院 / 使用者 / 群組 / Agent + value) that applies to everything below, KPI cards, the daily trend, then 使用者用量排行榜, 群組使用量排行榜 and Agent 用量排行榜. 用量管理: the usage-limit panel. Larger type via `src/bk/pages/monitoring.css` (kept out of `bk.css`: Tailwind refuses rules on its own utility classes in a file that uses @apply). Backend filters: `group`, `person` (uid), `agent` on summary / agents / users / groups / export.
- (earlier first pass) 用量與成本 adds two panels under the agent leaderboard: 用量分布 (tabs 依使用者 / 依群組, with a share bar) and 用量上限 (list with used / limit progress, add / edit inline form: 對象 群組 or 模型, target, 每日 / 每月, 費用 / Tokens / 呼叫次數, 上限, 備註; enable / disable; delete). A used-up limit makes chat answer 429 with the limit's message.
- 用量與成本 leaderboards (2026-11-04): 使用者用量排行榜 and 群組使用量排行榜 show a horizontal bar chart of the top 10 by cost (USD) on the left (`RankingChart`, recharts) and the full table on the right (2 : 3; stacked below `lg`). The table's 占比 bar column was dropped since the chart shows the comparison. Icons: `groups` and `hourglass_top` (用量上限); `group` and `speed` are not in the Material Symbols subset font and render as text. The bk mock (`VITE_BK_PREVIEW=1`) now serves `monitoringUsers` / `monitoringGroups`.

## Live 我的工作台 (2026-11-04)
- Sidebar: 流程 and 排程 carry a small grey "preview" tag (`BETA_NAV` in `App.jsx`, `.nav-beta` in `page-style.css`); hidden when the sidebar is collapsed.
- Live mode renders `src/live/Workbench.jsx` (mock mode keeps the old demo). Header: date line, a 32px greeting by local hour (早安 / 午安 / 下午好 / 晚上好 / 夜深了 + the user's name) and a nudge line (休息一下 etc.), with 重新同步 at the top right. Tabs 動態 / 行事曆 / 待辦 / 待審核 (待審核 only for admins).
- 動態 = AI brief: `POST /api/workbench/brief {now}` (browser local time with offset) reads the user's own Gmail (`gmail.fetch_emails`, inbox, last 3 days, 25 mails) and Google Calendar (today + tomorrow) through the gateway, de-identifies the numbered lines (`deid.deidentify_many`), asks the `fast` group for JSON {headline, urgent[mail#], today[event#], tomorrow[event#, prep], tips}, and returns it with the raw mails / events so the page shows real subjects next to the AI notes. Usage is recorded as agent `workbench-brief` and usage limits apply (429). Nothing read is stored server-side; the browser caches the brief in sessionStorage per uid, so only 重新同步 reads again. Each source reports connected / not_connected / reauth_required / error; a chip offers 連線 / 重新連線.
- 待辦: per-user to-dos in Firestore `todos` (uid, text, due, done) via `/api/workbench/todos` (GET / POST / PATCH / DELETE, owner only). 新增 opens an inline form (text + due date, default today).
- 待審核: the real admin review queue (`GET /api/agents/reviews`), agents and flows, with 查看 / 退回 (reason required) / 核准並發布.
- 行事曆: a 409 from events (grant expired or revoked although the gateway still lists it active) now shows the full connector-style page (Google 日曆授權已過期 + 重新授權) instead of re-requesting in a loop. `connectAccount(id, notify, {untilClosed})` waits for the popup to close before trusting the status in that case.

## 登入與 SSO (2026-11-04)
- Login (`src/SignIn.jsx`, used by `App.jsx` and `SharePage.jsx`): asks `GET /api/auth/providers` (no token). Only Google on = the single 登入 button as before; Entra ID / LDAP on = one outlined button per method (使用 Google Workspace / Microsoft / 院內帳號登入). Entra and LDAP both use `signInWithSSO('oidc.medisense-sso', hint)` in `firebase.js`; `hint` is Keycloak's `kc_idp_hint` (`entra` jumps to Microsoft, empty shows Keycloak's username / password page).
- Same e-mail already on Google: Firebase answers account-exists-with-different-credential; the pending credential is kept and the login shows 用 Google 登入並連結 (a second click, popups need a gesture), which signs in with Google and `linkWithCredential`s, keeping the uid.
- Admin 管理帳戶 → 登入與 SSO (`src/live/SsoPage.jsx`, `sso.css`, admin only, after 角色管理): health chips (Keycloak, Identity Platform provider), then three cards with a colour icon, status chip and on/off switch: Google Workspace (allowed-domain chips; env domains locked as 部署設定; `hd` hint), Microsoft Entra ID (tenant / client id, secret field empty with 留空則不變, copyable redirect URI for Azure, setup steps), LDAP / AD (AD / OpenLDAP segmented, URL, bind DN / password, users DN, attributes, optional filter, 測試連線 / 測試 Bind 帳號). Entra / LDAP cards are disabled with a banner until Keycloak is deployed.
- 編輯使用者 shows 登入方式 from `users.login_provider`.
- 用量與成本 tables (2026-11-04): 使用者 / 群組 / Agent 用量排行榜 scroll inside a fixed 440px box (`.mon-scroll` in `monitoring.css`: visible thin scrollbar, sticky header, overscroll contained). The Agent table no longer paginates, and deleted agents (`status: "deleted"`) are hidden from it for now; their usage still counts in the KPI totals.
- 空間 documents (2026-11-05): the 部門 column is removed from the space document list, and the space 加入文件 upload no longer sends the uploader's department (documents get ""). The backend `documents.department` field stays (optional, still used by the upload / edit API and its tests).
- 管理帳戶 帳戶資訊 (2026-11-05): `AccountSummary.jsx` (live mode) renders `GET /api/me/summary` (backend `routers/account.py`): profile (role chips, groups, login method from `users.login_provider`, created / last activity), owned assets (Agent / 流程 / 技能 / 空間: counts, up to 6 names with status, deleted agents left out, each card opens its page) and the user's own usage (today / 7 days / this month from `usage_user_daily`, all environments, 14-day bars). The sidebar profile line shows real group names (2 max, then "等 N 個群組") and the role label (a custom role's name, else 管理員 / 建置者 / 員工), from new `/api/me` fields `group_names` and `role_label`.
- 帳號設定 dialog (2026-11-05): `AccountDialog` (in `AccountSummary.jsx`) shows the signed-in user's name / e-mail, real groups and roles, sign-in method and last activity (`/api/me` + `/api/me/summary`; mock mode keeps 院內 AD（模擬）). The actions are one aligned row of equal-height buttons (管理帳戶 / 偏好設定 left, 登出 right), and 登出 now signs out of Firebase in live mode instead of only hiding the app.
