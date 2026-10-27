# Design QA

- Source visual truth: /Users/ikalamac/.codex/generated_images/01a1773a-33f6-7750-a883-363412199020/exec-952ee15d-5b2f-4a98-9b03-17a8a8205b45.png and user-supplied Amazon Quick screenshots.
- Target viewport: 1440 × 1024 desktop. Source generated mock is 1488 × 1056; proportional normalization required before comparison.
- State: signed-in workbench, Activity tab, employee view.
- Implementation screenshot: unavailable.
- Full-view / focused comparison: blocked. Local browser control is disabled in Work settings; user explicitly selected “先保留預覽，稍後驗證”. No alternate browser control was used.
- Typography, layout rhythm, colors, icons and content: implemented against reference; visual fidelity remains unverified.
- Assets: Phosphor icon library, no raster hero assets required. HealthAI uses a library atom mark.
- Build: passed (Vite production build).
- Existing Sites runtime tests: 4 passed.
- Browser interactions / console errors: not checked, deferred by user.
- Comparison history: no browser comparison performed; no visual pass claimed.
- Remaining required checks: SSO simulation, all seven navigation items, workbench reply, model selection and both Auto routes, sensitive-data local override, RAG source modal, audit filters and CSV download, Agent sandbox/review/publish/rollback, connector approval/revocation, spaces and research collaboration, responsive layout and console errors.
- All integrations, routing, detection, security and audit storage are explicitly simulated; no production system is connected.

final result: blocked

## Card refinement (2026-10-26)
- New source: /var/folders/y5/kh4vx29j4s978d7_txpyhz3h0000gn/T/codex-clipboard-e870adc2-5a66-42fe-b6ba-d24858eae3a9.png (QwenWork integrations reference).
- Scoped six non-chat pages to a white, light-border card system. Added card grids for connectors and research, activity cards, event/task cards, and clickable audit summary cards. Chat JSX layout and chat CSS retained.
- Production build passed following this update. Browser screenshot, interaction and visual comparison are still deferred under the user's existing preference. No visual pass is claimed.
- final result: blocked

## Administrator account and Model Routing (2026-10-26)
- Reference: /var/folders/y5/kh4vx29j4s978d7_txpyhz3h0000gn/T/codex-clipboard-0b310cf3-e234-412c-bafd-30e05cfe3641.png.
- Added fixed top account banner and dropdown (no region selector); management area holds Routing and Audit. Audit removed from primary sidebar. Rendering and navigation guard management pages by the simulated administrator role; formal backend authorization remains unimplemented and explicitly marked.
- Added draft rules, mandatory sensitive on-premise policy, ordering, activation, default/fallback, simulation testing and publish into chat configuration.
- Production build passed. Seven routing logic assertions passed, including sensitive override over manual Cloud, task routing, disabled rules, published edits and defaults.
- Browser and screenshot comparison remain deferred under the user's existing preference. Fixed-banner layout and dropdown still require browser verification.
- final result: blocked

## QwenWork visual restyling (2026-10-26)
- User requested https://qwenwork.ai/. Public site content inspected through web retrieval; the previously supplied QwenWork integration screenshot remains the app UI source. No live-site screenshot was captured.
- Updated portal shell, fixed banner, sidebar, typography, tabs, cards, buttons, management area, routing forms, dialogs and conversation styling. Preserved feature flows and administrator-only audit navigation.
- Production build passed. Browser visual inspection and screenshot comparison remain deferred; compact text sizing and contrast require rendered review before fidelity acceptance.
- final result: blocked

## Full-system QwenWork correction
- Replaced the last theme layer rather than stacking another recolor: updated shell dimensions, logo/header composition, font hierarchy and weights, neutral text palette, spacing, card grid density, sidebar settings and connector page composition.
- Build passed. Browser verification remains deferred, and no precise live-site or screenshot fidelity claim is made.
- final result: blocked

## Compact enterprise integrations update
- Latest source: /var/folders/y5/kh4vx29j4s978d7_txpyhz3h0000gn/T/codex-clipboard-c1cc785f-fdaa-4c34-b2be-2d956d759372.png.
- Added bundled Iconify service icons and generated banner illustration. Copied the illustration into public/assets/integrations-banner.png.
- Header reduced to Logo and Account. Role demo setting moved to preferences. Added visible sidebar collapse/expand control. Neutral sidebar and denser page/card spacing implemented.
- Production build passed. Browser/visual QA remains deferred. Banner crop, compact layouts, dropdown and collapse need rendered verification; no browser pass is claimed.
- final result: blocked

## Medisense conversation update
- Source: four user screenshots (fd214bc3, c453e1aa, 1e08f366, a7204a99) supplied in the rename/input redesign request.
- Replaced conversation welcome and composer with Agent strip, source/tool/model popovers and shortcut pills. Renamed product. Agent selection is recorded with mock replies; provider-family manual selections appear in mock routing, with sensitive override retained.
- Production build passed. Browser interaction and source screenshot comparison remain deferred; menu positioning, keyboard behavior and small-screen overflow need rendered review.
- final result: blocked

## Targeted cleanup
- Source user screenshot fab121fe identifies the unwanted Research outer boundary. Removed panel/list-panel classes from the Research grid and explicitly removed its border; retained report card border.
- Chat and its surrounding surfaces are white. Removed Flow from plus menu. Recents initialize empty and store only conversation sessions, with restore handlers.
- New Medisense atom banner generated and installed as public/assets/medisense-integrations-banner.png; replaced previous third-party-symbol artwork.
- Production build passed. Browser visual and interaction verification remain deferred; final result: blocked.

## Embedded calendar demonstration
- Source: user screenshot aed38f24, daily time grid left and suggested focus time right.
- Replaced agenda list with a day view, all-day label, timed meeting, provider selector, previous/next/today controls, event detail, session-only focus-time action and connector empty state. Added Outlook Calendar to connector catalog.
- Calendar source/date behavior checks: 6 passed. Production build and 4 Sites runtime tests passed. No calendar API or external iframe is connected.
- Browser comparison remains deferred under the user's existing setting. Timeline, card proportions and responsive state need rendered QA; no visual pass is claimed.
- final result: blocked
