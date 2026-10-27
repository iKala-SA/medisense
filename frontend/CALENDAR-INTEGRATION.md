# Calendar integration boundary

The calendar view is a frontend demonstration. It does not embed a third-party calendar page, call APIs, obtain OAuth tokens or synchronize data.

`CalendarPanel` receives connector state and shows a normalized daily calendar plus suggestions. Google Calendar and Outlook Calendar are the two supported source choices. The existing connector simulation drives the connected/empty state; revoking demo authorization hides that source's calendar. Pending approval does not display events.

Future implementation should replace `getDemoCalendarEvents` with authorized provider adapters returning normalized IDs, titles, start/end timestamps, timezone and source metadata. Connector setup must provide actual OAuth scopes, connected identity and health status. Display must follow the verified connection state, handle expired/revoked access and avoid public calendar links for private hospital data. The embedded workspace can render either authorized event feeds or a supported provider embed after provider-specific validation; no iframe support is assumed.

Focus-time creation is session-local and is explicitly not sent to either provider. A future write path should check delegated write scopes, confirm the selected calendar and surface the actual API result. The current suggestions are fixed synthetic copy, not analysis of private schedules.
