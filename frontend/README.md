# Medisense employee portal prototype

React / Vite desktop prototype using the selected Amazon Quick visual direction.

Seven navigation pages: Chat, Workbench, Spaces, Research, Agent Hub, Connectors, Audit.

Use “11/5 示範導覽” in the header to step through the demo. The login screen simulates Paggie's employee identity. Administrator view is a demonstration toggle, not authentication or authorization.

All datasets, replies, routing, RAG citations, approvals and connector statuses are synthetic simulations in browser memory. CSV export downloads synthetic audit rows locally. No email or message is sent, no external integration is connected, no hospital system is accessed, and no on-premise log is written. Reload resets state.

Build and the four existing runtime tests passed. Browser and visual QA are deferred at the user's request; see design-qa.md.

Development: npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
