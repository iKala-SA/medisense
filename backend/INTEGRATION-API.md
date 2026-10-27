
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
