"""Connector catalog + drivers (design: Connectors 連接器中心 / MCP setup page).

A connector is a hospital-wide shared object: `type` picks a spec from TYPES (which fields to show,
which are secrets, which actions exist), `config` holds the non-secret fields, `secrets` maps secret
fields to Secret Manager names. The canvas `tool` node references a connector id + action.

Status of each type (decided 2026-10-24, calendar writes opened 2026-11-03):
  real now : mcp (Streamable HTTP), webhook, slack, teams, notion, calendar (per-user OAuth through Open Connector: reads, and the
             write actions an admin ticks: quick_add_event / create_event / patch_event / delete_event), gateway (any Open Connector
             service enabled from the catalog, e.g. Google Docs `googledocs.create_document`)
  catalog  : gmail / drive (same gateway, next), his_fhir, pacs (nothing to connect to)
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

import httpx

from . import deid
from . import gateway_actions as ga
from . import open_connector as oc

TIMEOUT = 30.0
MCP_PROTOCOL = "2025-06-18"


def _f(key: str, label: str, kind: str = "text", *, required: bool = False, hint: str = "", placeholder: str = "",
       options: list[dict] | None = None, default: Any = None, section: str = "server") -> dict:
    return {"key": key, "label": label, "kind": kind, "required": required, "hint": hint, "placeholder": placeholder,
            "options": options or [], "default": default, "section": section}


def _a(id_: str, label: str, args: list[dict], *, write: bool = True) -> dict:
    return {"id": id_, "label": label, "args": args, "write": write}


CALENDAR_ACTIONS = [
    _a("list_calendars", "列出日曆", [], write=False),
    _a("list_events", "列出事件", [{"key": "calendarId", "label": "日曆（預設 primary）", "kind": "text"},
                                   {"key": "timeMin", "label": "起（ISO 8601，預設現在）", "kind": "text"},
                                   {"key": "timeMax", "label": "迄（ISO 8601）", "kind": "text"},
                                   {"key": "maxResults", "label": "最多筆數（預設 10）", "kind": "text"},
                                   {"key": "q", "label": "關鍵字", "kind": "text"}], write=False),
    _a("get_event", "取得事件", [{"key": "calendarId", "label": "日曆（預設 primary）", "kind": "text"},
                                 {"key": "eventId", "label": "事件 ID", "kind": "text"}], write=False),
    _a("find_free_slots", "找空檔", [{"key": "timeMin", "label": "起（ISO 8601）", "kind": "text"},
                                     {"key": "timeMax", "label": "迄（ISO 8601）", "kind": "text"}], write=False),
    _a("free_busy_query", "查忙碌時段", [{"key": "timeMin", "label": "起（ISO 8601）", "kind": "text"},
                                         {"key": "timeMax", "label": "迄（ISO 8601）", "kind": "text"}], write=False),
    # Write actions (gateway input: {calendarId, event: {...}, sendUpdates}); the flat args below are folded into `event`.
    _a("quick_add_event", "快速建立事件（自然語言）", [{"key": "text", "label": "事件描述，例如「明天下午三點 與心臟科討論 30 分鐘」", "kind": "text", "required": True},
                                                      {"key": "calendarId", "label": "日曆（預設 primary）", "kind": "text"},
                                                      {"key": "sendUpdates", "label": "通知與會者：all / externalOnly / none", "kind": "text"}]),
    _a("create_event", "建立事件", [{"key": "summary", "label": "標題", "kind": "text", "required": True},
                                    {"key": "start", "label": "開始（ISO 8601，例如 2026-11-04T15:00:00+08:00；全天用 2026-11-04）", "kind": "text", "required": True},
                                    {"key": "end", "label": "結束（ISO 8601；全天事件為結束日的次日）", "kind": "text", "required": True},
                                    {"key": "description", "label": "說明", "kind": "textarea"},
                                    {"key": "location", "label": "地點", "kind": "text"},
                                    {"key": "attendees", "label": "與會者 email（逗號分隔）", "kind": "text"},
                                    {"key": "timeZone", "label": "時區（預設 Asia/Taipei）", "kind": "text"},
                                    {"key": "calendarId", "label": "日曆（預設 primary）", "kind": "text"},
                                    {"key": "sendUpdates", "label": "通知與會者：all / externalOnly / none", "kind": "text"}]),
    _a("patch_event", "修改事件", [{"key": "eventId", "label": "事件 ID", "kind": "text", "required": True},
                                   {"key": "summary", "label": "標題", "kind": "text"},
                                   {"key": "start", "label": "開始（ISO 8601）", "kind": "text"},
                                   {"key": "end", "label": "結束（ISO 8601）", "kind": "text"},
                                   {"key": "description", "label": "說明", "kind": "textarea"},
                                   {"key": "location", "label": "地點", "kind": "text"},
                                   {"key": "attendees", "label": "與會者 email（逗號分隔，取代原名單）", "kind": "text"},
                                   {"key": "timeZone", "label": "時區（預設 Asia/Taipei）", "kind": "text"},
                                   {"key": "calendarId", "label": "日曆（預設 primary）", "kind": "text"},
                                   {"key": "sendUpdates", "label": "通知與會者：all / externalOnly / none", "kind": "text"}]),
    _a("delete_event", "刪除事件", [{"key": "eventId", "label": "事件 ID", "kind": "text", "required": True},
                                    {"key": "calendarId", "label": "日曆（預設 primary）", "kind": "text"},
                                    {"key": "sendUpdates", "label": "通知與會者：all / externalOnly / none", "kind": "text"}]),
]
CALENDAR_READ = [a["id"] for a in CALENDAR_ACTIONS if not a["write"]]
CALENDAR_WRITE = [a["id"] for a in CALENDAR_ACTIONS if a["write"]]
# Google scopes the gateway's googlecalendar provider declares for these actions (src/providers/googlecalendar/scopes.ts).
CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events"
DEFAULT_TZ = "Asia/Taipei"
SEND_UPDATES = {"all", "externalOnly", "none"}


def calendar_allowed(config: dict) -> tuple[list[str], list[str]]:
    """(read actions, write actions) an admin allowed on a calendar connector. Reads default to all; writes default to none."""
    reads = [a for a in (config.get("allowed_actions") or CALENDAR_READ) if a in CALENDAR_READ]
    writes = [a for a in (config.get("write_actions") or []) if a in CALENDAR_WRITE]
    return reads, writes


def calendar_scopes(config: dict) -> list[str]:
    """Google data scopes every user's grant must carry for the actions this connector allows."""
    reads, writes = calendar_allowed(config)
    return [*([CALENDAR_READ_SCOPE] if reads else []), *([CALENDAR_WRITE_SCOPE] if writes else [])]


def oauth_scopes(type_: str, config: dict) -> list[str]:
    """What the gateway should request from users for a per-user OAuth type: data scopes + identity (to label the account)."""
    if type_ == "calendar":
        return [*calendar_scopes(config), "openid", "email"]
    return []


def required_scopes(doc: dict) -> list[str]:
    """Data scopes a user's grant needs to use this connector (empty = unknown / not applicable)."""
    cfg = doc.get("config") or {}
    if doc.get("type") == "calendar":
        return calendar_scopes(cfg)
    if doc.get("type") == "gateway":
        return [s for s in (cfg.get("scopes") or []) if s not in ga.IDENTITY_SCOPES]
    return []


def has_write_actions(type_: str, config: dict) -> bool:
    return type_ == "calendar" and bool(calendar_allowed(config)[1])


TYPES: dict[str, dict] = {
    "mcp": {
        "label": "Remote MCP Server", "category": "mcp", "protocol": "MCP Streamable HTTP · JSON-RPC 2.0",
        "icon": "hub", "badge": "MCP Protocol v1.0", "available": True,
        "description": "透過 Model Context Protocol 標準呼叫遠端工具 (Tools)。連線測試後自動列出伺服器註冊的工具。",
        "fields": [
            _f("url", "Remote MCP Server URL", "url", required=True, placeholder="https://mcp-cardio.vghtc.internal/mcp",
               hint="Streamable HTTP 端點（院內 VPC 或 Cloud Run）。"),
            _f("auth_kind", "驗證方式", "select", default="bearer", section="credentials",
               options=[{"value": "none", "label": "無"}, {"value": "bearer", "label": "Bearer Token"}, {"value": "header", "label": "自訂 Header"}]),
            _f("auth_header", "Header 名稱", "text", placeholder="X-API-Key", section="credentials", hint="驗證方式為自訂 Header 時使用。"),
            _f("token", "Token / API Key", "secret", section="credentials"),
        ],
        "actions": "dynamic",
    },
    "webhook": {
        "label": "Webhook / REST", "category": "mcp", "protocol": "HTTP JSON Payload",
        "icon": "webhook", "badge": "REST", "available": True,
        "description": "將 Agent 推論結果以 JSON 推送到任意 HTTP 端點，或呼叫院內 REST API。",
        "fields": [
            # Secret, not config: signed URLs (Power Automate `sig=`, Slack/Teams hooks) are credentials in themselves.
            _f("url", "Endpoint URL", "secret", required=True, placeholder="https://api.vghtc.internal/notify", section="credentials",
               hint="存於 Secret Manager，不會顯示於連接器清單。含簽章的網址（如 Power Automate 的 sig=）視同密碼。"),
            _f("method", "HTTP Method", "select", default="POST",
               options=[{"value": "POST", "label": "POST"}, {"value": "PUT", "label": "PUT"}, {"value": "GET", "label": "GET"}]),
            _f("headers", "額外 Headers（JSON）", "textarea", placeholder='{"X-Source": "tcvgh-agent"}'),
            _f("auth_header", "驗證 Header 名稱", "text", default="Authorization", section="credentials"),
            _f("token", "驗證 Header 值", "secret", section="credentials", hint="例如 Bearer xxxxx；留空則不送驗證。"),
        ],
        "actions": [_a("request", "送出請求", [{"key": "payload", "label": "Payload（JSON 或文字，可用模板變數）", "kind": "textarea"}])],
    },
    "slack": {
        "label": "Slack 跨科會診機器人", "category": "chat", "protocol": "Incoming Webhook / Bot Token",
        "icon": "forum", "badge": "第三方協同推薦", "available": True,
        "description": "將 Agent 診斷推論或危急值警訊即時推送至專科急診頻道；Bot Token 可指定頻道。",
        "fields": [
            _f("webhook_url", "Incoming Webhook URL", "secret", placeholder="https://hooks.slack.com/services/…",
               hint="最簡單的推播方式；只需這一項即可運作。", section="credentials"),
            _f("bot_token", "Bot User OAuth Token", "secret", placeholder="xoxb-…", section="credentials",
               hint="需要 chat:write 權限；設定後可指定任意頻道。"),
            _f("default_channel", "預設頻道", "text", placeholder="#cardio-alerts"),
            _f("scopes", "院區授權範圍 (OAuth Scopes)", "checkboxes", default=["chat:write"], section="credentials",
               options=[{"value": "chat:write", "label": "chat:write · 發送會診通報"}, {"value": "channels:read", "label": "channels:read · 讀取頻道"},
                        {"value": "files:write", "label": "files:write · 傳送去識別化摘要"}, {"value": "users:read.email", "label": "users:read.email · 院方禁止", "disabled": True}]),
        ],
        "actions": [_a("send_message", "傳送訊息", [{"key": "text", "label": "訊息內容", "kind": "textarea"}, {"key": "channel", "label": "頻道（留空用預設）", "kind": "text"}])],
    },
    "teams": {
        "label": "Microsoft Teams 護理站通知", "category": "chat", "protocol": "Incoming Webhook · Adaptive Cards",
        "icon": "groups", "badge": "第三方", "available": True,
        "description": "串接護理排班、病房呼叫按鈕紀錄與值班醫師即時呼叫頻道。",
        "fields": [_f("webhook_url", "Teams Incoming Webhook URL", "secret", required=True, section="credentials")],
        "actions": [_a("send_card", "傳送卡片", [{"key": "title", "label": "標題", "kind": "text"}, {"key": "text", "label": "內容", "kind": "textarea"}])],
    },
    "notion": {
        "label": "Notion 臨床衛教共編知識庫", "category": "data", "protocol": "Internal Integration Token",
        "icon": "note_alt", "badge": "第三方", "available": True,
        "description": "將 Agent 整理的結構化 FAQ 與衛教指南追加到院內 Notion 資料庫。",
        "fields": [
            _f("token", "Internal Integration Token", "secret", required=True, placeholder="ntn_…", section="credentials"),
            _f("database_id", "Database ID", "text", required=True, hint="資料庫 URL 中的 32 碼 ID；請先在 Notion 將 integration 加入該資料庫。"),
            _f("title_property", "標題欄位名稱", "text", default="Name"),
        ],
        "actions": [_a("append_page", "新增頁面", [{"key": "title", "label": "標題", "kind": "text"}, {"key": "content", "label": "內容", "kind": "textarea"}])],
    },
    "gmail": {
        "label": "Google Gmail 臨床通訊", "category": "gws", "protocol": "OAuth 2.0 · Gmail API", "icon": "mail", "badge": "GWS 官方認證",
        "available": False, "coming": "需要院方 GCP OAuth 用戶端與使用者授權流程（下一階段）。",
        "description": "授權 Agent 讀取病患轉診通知、草擬科別諮詢郵件。",
        "fields": [_f("client_id", "OAuth Client ID", "text", section="credentials"), _f("client_secret", "OAuth Client Secret", "secret", section="credentials"),
                   _f("scopes", "Scopes", "checkboxes", default=["gmail.send"], section="credentials",
                      options=[{"value": "gmail.send", "label": "gmail.send"}, {"value": "gmail.readonly", "label": "gmail.readonly"}])],
        "actions": [_a("send_email", "寄送郵件", [{"key": "to", "label": "收件人", "kind": "text"}, {"key": "subject", "label": "主旨", "kind": "text"}, {"key": "body", "label": "內容", "kind": "textarea"}])],
    },
    "gateway": {
        "label": "Open Connector 服務", "category": "gws", "protocol": "Open Connector（通用）", "icon": "extension", "badge": "通用",
        "available": True, "hidden": True, "auth": "gateway",
        "description": "由管理員在「全部服務」目錄中啟用的任何 Open Connector 服務；設定、許可與授權方式依服務而定。",
        "fields": [], "actions": "dynamic",
    },
    "calendar": {
        "label": "Google Calendar", "category": "gws", "protocol": "OAuth 2.0 · 每位使用者各自授權", "icon": "calendar_month", "badge": "每人各自授權",
        "available": True, "auth": "user_oauth", "oc_service": "googlecalendar",
        "description": "讓 Agent 與工作台讀取使用者自己的 Google 日曆，並可開放建立、修改、刪除事件。每位使用者各自授權，只動得到自己的日曆；"
                       "寫入動作在對話中執行前會先請使用者確認（Agent 能力的「需核准」），在草稿沙盒中只會模擬。",
        "fields": [
            _f("allowed_actions", "允許的讀取動作", "checkboxes", default=list(CALENDAR_READ), section="permissions",
               hint="管理讀取許可：只有勾選的動作能被 Agent 呼叫。",
               options=[{"value": a["id"], "label": f"{a['label']} · {a['id']}"} for a in CALENDAR_ACTIONS if not a["write"]]),
            _f("write_actions", "寫入動作（建立、修改、刪除事件）", "checkboxes", default=[], section="permissions",
               hint="管理寫入許可：勾選後使用者授權時會多要求 calendar.events 權限；已連線的使用者需重新授權一次。",
               options=[{"value": a["id"], "label": f"{a['label']} · {a['id']}"} for a in CALENDAR_ACTIONS if a["write"]]),
        ],
        "actions": list(CALENDAR_ACTIONS),
    },
    "drive": {
        "label": "Google Drive 文件病歷附檔庫", "category": "gws", "protocol": "Service Account · Drive API", "icon": "cloud", "badge": "GWS 官方認證",
        "available": False, "coming": "需要共用雲端硬碟與服務帳戶授權（下一階段）。",
        "description": "存取與匯出匿名化出院病摘 PDF、會議紀錄。",
        "fields": [_f("shared_drive_id", "共用雲端硬碟 ID", "text"), _f("service_account_json", "服務帳戶金鑰 JSON", "secret", section="credentials")],
        "actions": [_a("read_file", "讀取檔案", [{"key": "file_id", "label": "檔案 ID", "kind": "text"}], write=False)],
    },
    "his_fhir": {
        "label": "TCVGH HIS 核心系統雙向 Webhook", "category": "his", "protocol": "mTLS · HL7 FHIR v4.0", "icon": "local_hospital", "badge": "院內專屬 (VPC-B)",
        "available": False, "coming": "HIS / FHIR 閘道尚未串接（設計原則：PHI 不離院）。",
        "description": "雙向觸發門診報到、危急值開立與處方審核事件。",
        "fields": [_f("base_url", "FHIR Base URL", "url", placeholder="https://10.120.44.18:9092/fhir"), _f("client_cert", "mTLS 用戶端憑證 (PEM)", "secret", section="credentials"), _f("jwt", "閘道 JWT", "secret", section="credentials")],
        "actions": [_a("read_patient", "讀取病患資料", [{"key": "query", "label": "FHIR 查詢", "kind": "text"}], write=False)],
    },
    "pacs": {
        "label": "TCVGH PACS / DICOMweb 閘道器", "category": "his", "protocol": "DICOMweb (QIDO/WADO)", "icon": "radiology", "badge": "院內專屬 (VPC-B)",
        "available": False, "coming": "PACS 閘道尚未串接。",
        "description": "以 WADO-RS 安全讀取匿名化 X-Ray 與 CT 影像切片。",
        "fields": [_f("base_url", "DICOMweb Base URL", "url"), _f("token", "閘道 Token", "secret", section="credentials")],
        "actions": [_a("query_studies", "查詢影像", [{"key": "query", "label": "QIDO 查詢", "kind": "text"}], write=False)],
    },
}

CATEGORIES = [
    {"id": "gws", "label": "Google Workspace"}, {"id": "chat", "label": "協同通訊 (Slack / Teams)"},
    {"id": "his", "label": "醫療院內系統 (HIS/EMR)"}, {"id": "mcp", "label": "遠端 MCP / REST"}, {"id": "data", "label": "雲端與資料庫"},
]


def is_user_oauth(type_: str) -> bool:
    """Types whose credentials are each user's own OAuth grant, held by the Open Connector gateway."""
    return TYPES.get(type_, {}).get("auth") == "user_oauth"


def connector_mode(doc: dict) -> str | None:
    """How users authenticate to a connector: user_oauth (each their own grant), shared (one admin-held credential), none."""
    t = doc.get("type", "")
    if is_user_oauth(t):
        return "user_oauth"
    if t == "gateway":
        return ga.mode_of((doc.get("config") or {}).get("auth_mode", ""))
    return None


def connector_service(doc: dict) -> str | None:
    """The Open Connector service behind a connector, if any."""
    t = doc.get("type", "")
    if t in TYPES and TYPES[t].get("oc_service"):
        return TYPES[t]["oc_service"]
    return (doc.get("config") or {}).get("service") if t == "gateway" else None


def user_oauth_types() -> list[str]:
    return [k for k in TYPES if is_user_oauth(k)]


def secret_fields(type_: str) -> list[str]:
    return [f["key"] for f in TYPES[type_]["fields"] if f["kind"] == "secret"]


# ------------------------------------------------------------------ MCP (Streamable HTTP, JSON-RPC 2.0)
class McpClient:
    """Minimal Streamable HTTP client: initialize -> notifications/initialized -> tools/list | tools/call.
    Handles both application/json and text/event-stream responses. Legacy SSE-only servers are not supported."""

    def __init__(self, url: str, headers: dict[str, str]):
        self.url, self.headers, self.session_id, self._n = url, headers, None, 0
        self.http = httpx.Client(timeout=TIMEOUT)

    def _post(self, body: dict) -> dict | None:
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
             "MCP-Protocol-Version": MCP_PROTOCOL, **self.headers}
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        r = self.http.post(self.url, json=body, headers=h)
        r.raise_for_status()
        if sid := r.headers.get("Mcp-Session-Id"):
            self.session_id = sid
        if r.status_code == 202 or not r.content:
            return None
        ct = r.headers.get("content-type", "")
        if ct.startswith("text/event-stream"):
            for line in r.text.splitlines():
                if line.startswith("data:"):
                    msg = json.loads(line[5:].strip() or "{}")
                    if msg.get("id") == body.get("id"):
                        return msg
            raise RuntimeError("MCP server closed the stream without a response")
        return r.json()

    def call(self, method: str, params: dict | None = None) -> Any:
        self._n += 1
        msg = self._post({"jsonrpc": "2.0", "id": self._n, "method": method, "params": params or {}})
        if msg is None:
            raise RuntimeError(f"no response for {method}")
        if "error" in msg:
            raise RuntimeError(f"MCP error {msg['error'].get('code')}: {msg['error'].get('message')}")
        return msg.get("result")

    def initialize(self) -> dict:
        res = self.call("initialize", {"protocolVersion": MCP_PROTOCOL, "capabilities": {},
                                       "clientInfo": {"name": "tcvgh-agent-platform", "version": "0.4"}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return res or {}

    def list_tools(self) -> list[dict]:
        tools = (self.call("tools/list") or {}).get("tools", [])
        return [{"id": t["name"], "label": t.get("title") or t["name"], "description": t.get("description", ""),
                 "schema": t.get("inputSchema", {})} for t in tools]

    def call_tool(self, name: str, arguments: dict) -> str:
        res = self.call("tools/call", {"name": name, "arguments": arguments}) or {}
        if res.get("isError"):
            raise RuntimeError("tool returned error: " + " ".join(c.get("text", "") for c in res.get("content", [])))
        text = "\n".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        if text:
            return text
        if sc := res.get("structuredContent"):
            return json.dumps(sc, ensure_ascii=False)
        return json.dumps(res, ensure_ascii=False)


def _mcp(config: dict, secrets: dict) -> McpClient:
    headers: dict[str, str] = {}
    kind, tok = config.get("auth_kind", "bearer"), secrets.get("token", "")
    if tok and kind == "bearer":
        headers["Authorization"] = f"Bearer {tok}"
    elif tok and kind == "header":
        headers[config.get("auth_header") or "X-API-Key"] = tok
    return McpClient(config["url"], headers)


# ------------------------------------------------------------------ drivers
def _webhook_headers(config: dict, secrets: dict) -> dict:
    h = {"Content-Type": "application/json"}
    if config.get("headers"):
        h.update(json.loads(config["headers"]))
    if secrets.get("token"):
        h[config.get("auth_header") or "Authorization"] = secrets["token"]
    return h


def _webhook_url(config: dict, secrets: dict) -> str:
    """Secret Manager first; `config.url` only for connectors saved before the URL became a secret."""
    url = secrets.get("url") or config.get("url")
    if not url:
        raise RuntimeError("webhook: endpoint URL is not set")
    return url


def _slack_post(config: dict, secrets: dict, text: str, channel: str = "") -> str:
    if secrets.get("bot_token"):
        r = httpx.post("https://slack.com/api/chat.postMessage", timeout=TIMEOUT,
                       headers={"Authorization": f"Bearer {secrets['bot_token']}"},
                       json={"channel": channel or config.get("default_channel") or "#general", "text": text})
        d = r.json()
        if not d.get("ok"):
            raise RuntimeError(f"slack: {d.get('error')}")
        return f"posted to {d.get('channel')} ts={d.get('ts')}"
    if secrets.get("webhook_url"):
        r = httpx.post(secrets["webhook_url"], json={"text": text}, timeout=TIMEOUT)
        r.raise_for_status()
        return "posted via incoming webhook"
    raise RuntimeError("slack: set a webhook URL or a bot token")


def _teams_post(secrets: dict, title: str, text: str) -> str:
    card = {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.5",
        "body": [{"type": "TextBlock", "size": "Medium", "weight": "Bolder", "text": title or "TCVGH Agent"},
                 {"type": "TextBlock", "text": text, "wrap": True}]}}]}
    r = httpx.post(secrets["webhook_url"], json=card, timeout=TIMEOUT)
    r.raise_for_status()
    return "card posted"


def _notion_headers(secrets: dict) -> dict:
    return {"Authorization": f"Bearer {secrets['token']}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}


def _notion_append(config: dict, secrets: dict, title: str, content: str) -> str:
    body = {"parent": {"database_id": config["database_id"]},
            "properties": {config.get("title_property") or "Name": {"title": [{"text": {"content": title[:200]}}]}},
            "children": [{"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"text": {"content": chunk}}]}}
                         for chunk in [content[i:i + 1900] for i in range(0, max(len(content), 1), 1900)]]}
    r = httpx.post("https://api.notion.com/v1/pages", headers=_notion_headers(secrets), json=body, timeout=TIMEOUT)
    if r.status_code >= 400:
        raise RuntimeError(f"notion {r.status_code}: {r.json().get('message', r.text)[:200]}")
    return f"page created {r.json().get('url', '')}"


def test(type_: str, config: dict, secrets: dict) -> dict:
    """Live connectivity check. Returns {ok, message, ms, tools?}."""
    spec = TYPES[type_]
    if not spec["available"]:
        return {"ok": False, "message": spec["coming"], "ms": 0}
    t0 = time.perf_counter()
    try:
        tools: list[dict] | None = None
        if is_user_oauth(type_):
            if not oc.configured():
                raise RuntimeError("Open Connector 尚未設定（OPEN_CONNECTOR_URL / OPEN_CONNECTOR_TOKEN）")
            if not oc.health():
                raise RuntimeError("無法連到 Open Connector 閘道")
            if not oc.oauth_client_ready(spec["oc_service"]):
                raise RuntimeError("閘道尚未設定 Google OAuth 用戶端（client id / secret）")
            msg = f"閘道正常，OAuth 用戶端已設定；目前 {len(oc.connected_apps(spec['oc_service']))} 位使用者已連線"
        elif type_ == "mcp":
            c = _mcp(config, secrets)
            info = c.initialize()
            tools = c.list_tools()
            srv = (info.get("serverInfo") or {}).get("name", "?")
            msg = f"MCP 握手成功：{srv} · {len(tools)} 個工具"
        elif type_ == "webhook":
            method = config.get("method", "POST")
            r = httpx.request(method, _webhook_url(config, secrets), headers=_webhook_headers(config, secrets), timeout=TIMEOUT,
                              json={"ping": True, "source": "tcvgh-agent-platform"} if method != "GET" else None)
            msg = f"{method} {r.status_code}"
            if r.status_code >= 400:
                raise RuntimeError(msg)
        elif type_ == "slack":
            if secrets.get("bot_token"):
                d = httpx.post("https://slack.com/api/auth.test", headers={"Authorization": f"Bearer {secrets['bot_token']}"}, timeout=TIMEOUT).json()
                if not d.get("ok"):
                    raise RuntimeError(f"slack auth.test: {d.get('error')}")
                msg = f"Bot 驗證成功：{d.get('team')} / {d.get('user')}"
            elif secrets.get("webhook_url"):
                msg = _slack_post(config, secrets, "✅ TCVGH Agent Platform 連線測試")
            else:
                raise RuntimeError("請提供 Incoming Webhook URL 或 Bot Token")
        elif type_ == "teams":
            msg = _teams_post(secrets, "TCVGH Agent Platform", "✅ 連線測試成功")
        elif type_ == "notion":
            r = httpx.get(f"https://api.notion.com/v1/databases/{config['database_id']}", headers=_notion_headers(secrets), timeout=TIMEOUT)
            if r.status_code >= 400:
                raise RuntimeError(f"notion {r.status_code}: {r.json().get('message', '')[:200]}")
            title = "".join(t.get("plain_text", "") for t in r.json().get("title", []))
            msg = f"資料庫可存取：{title or config['database_id']}"
        else:
            raise RuntimeError("unsupported type")
        out = {"ok": True, "message": msg, "ms": int((time.perf_counter() - t0) * 1000)}
        if tools is not None:
            out["tools"] = tools
        return out
    except (httpx.HTTPError, RuntimeError, ValueError, KeyError) as exc:
        return {"ok": False, "message": f"{exc.__class__.__name__}: {exc}"[:400], "ms": int((time.perf_counter() - t0) * 1000)}


def test_gateway(config: dict, connector_id: str) -> dict:
    """Admin 'test' for a generic connector: gateway reachable, OAuth client / shared credential present."""
    t0 = time.perf_counter()
    try:
        service, mode = config["service"], ga.mode_of(config.get("auth_mode", ""))
        if not oc.configured():
            raise RuntimeError("Open Connector 尚未設定（OPEN_CONNECTOR_URL / OPEN_CONNECTOR_TOKEN）")
        if not oc.health():
            raise RuntimeError("無法連到 Open Connector 閘道")
        if mode == "user_oauth":
            if not oc.oauth_client_ready(service):
                raise RuntimeError("閘道尚未設定此服務的 OAuth 用戶端")
            msg = f"閘道正常，OAuth 用戶端已設定；目前 {len(oc.connected_apps(service))} 位使用者已連線"
        elif mode == "shared":
            mine = [a for a in oc.connected_apps(service) if a.get("alias") == oc.shared_name(connector_id)]
            if not mine or mine[0].get("status") != "active":
                raise RuntimeError("共用憑證連線不存在或已失效，請重新輸入憑證")
            msg = "閘道正常，共用憑證有效"
        else:
            msg = "閘道正常（此服務無需授權）"
        return {"ok": True, "message": msg, "ms": int((time.perf_counter() - t0) * 1000)}
    except (oc.OpenConnectorError, RuntimeError, KeyError) as exc:
        return {"ok": False, "message": f"{exc.__class__.__name__}: {exc}"[:400], "ms": int((time.perf_counter() - t0) * 1000)}


def sync_oauth_scopes(type_: str, config: dict) -> list[str]:
    """Per-user OAuth types: tell the gateway which scopes every user's grant must request for the actions this connector
    allows (least privilege, same as the catalog wizard). Returns the scopes pushed, [] when nothing was pushed.
    Raises OpenConnectorError when the gateway refused (the caller decides whether that blocks the save)."""
    if not is_user_oauth(type_) or not oc.configured():
        return []
    scopes = oauth_scopes(type_, config)
    service = TYPES[type_]["oc_service"]
    oc.save_oauth_client(service, ga.platform_client(service), scopes, set())
    return scopes


def _int(v: Any, default: int) -> int:
    try:
        return max(1, min(int(str(v).strip()), 250))
    except (TypeError, ValueError):
        return default


def _event_time(value: Any, tz: str) -> dict:
    """Google's EventDateTime: a bare date is an all-day boundary, anything else a timestamp (with the zone when it has no offset)."""
    v = str(value).strip()
    if len(v) == 10 and v[4] == "-" and v[7] == "-":
        return {"date": v}
    if v.endswith("Z") or (len(v) > 6 and v[-6] in "+-" and v[-3] == ":"):
        return {"dateTime": v}
    return {"dateTime": v, "timeZone": tz}


def _event_body(clean: dict) -> dict:
    """The gateway's `event` object from the flat tool arguments."""
    tz = str(clean.get("timeZone") or DEFAULT_TZ)
    event: dict[str, Any] = {k: str(clean[k]) for k in ("summary", "description", "location") if k in clean}
    for k in ("start", "end"):
        if k in clean:
            event[k] = _event_time(clean[k], tz)
    if "attendees" in clean:
        raw = clean["attendees"]
        emails = raw if isinstance(raw, list) else [e for e in re.split(r"[,\s;]+", str(raw)) if e]
        event["attendees"] = [{"email": str(e.get("email") if isinstance(e, dict) else e).strip()} for e in emails if e]
    return event


def _calendar_write_payload(action: str, clean: dict, cal: str) -> dict:
    payload: dict[str, Any] = {"calendarId": cal}
    if str(clean.get("sendUpdates") or "") in SEND_UPDATES:
        payload["sendUpdates"] = str(clean["sendUpdates"])
    if action == "quick_add_event":
        if not clean.get("text"):
            raise RuntimeError("quick_add_event 需要 text（事件描述）")
        return {**payload, "text": str(clean["text"])}
    if action == "delete_event":
        if not clean.get("eventId"):
            raise RuntimeError("delete_event 需要 eventId")
        return {**payload, "eventId": str(clean["eventId"])}
    event = _event_body(clean)
    if action == "create_event":
        missing = [k for k in ("summary", "start", "end") if k not in event]
        if missing:
            raise RuntimeError(f"create_event 需要 {'、'.join(missing)}")
        return {**payload, "event": event}
    if not clean.get("eventId"):  # patch_event
        raise RuntimeError("patch_event 需要 eventId")
    if not event:
        raise RuntimeError("patch_event 沒有任何要修改的欄位")
    return {**payload, "eventId": str(clean["eventId"]), "event": event}


def _calendar_call(config: dict, action: str, args: dict, user_id: str | None) -> str:
    """One Google Calendar action as the *running user*, through the Open Connector gateway. Reads are allowed by
    `allowed_actions`, writes only by `write_actions` (both set by the admin on the connector)."""
    if not user_id:
        raise RuntimeError("需要使用者身分才能呼叫個人日曆")
    reads, writes = calendar_allowed(config)
    if action in CALENDAR_WRITE and action not in writes:
        raise RuntimeError(f"此連接器未允許動作 {action}（管理員尚未開放此寫入動作）")
    if action not in CALENDAR_WRITE and (action not in CALENDAR_READ or action not in reads):
        raise RuntimeError(f"此連接器未允許動作 {action}")
    cal = str(args.get("calendarId") or "primary")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    clean = {k: v for k, v in args.items() if v not in ("", None)}
    if action in CALENDAR_WRITE:
        payload = _calendar_write_payload(action, clean, cal)
    elif action == "list_calendars":
        payload = {"maxResults": _int(clean.get("maxResults"), 50)}
    elif action == "list_events":
        payload = {"calendarId": cal, "timeMin": clean.get("timeMin") or now, "maxResults": _int(clean.get("maxResults"), 10),
                   "orderBy": "startTime", "singleEvents": True, **{k: clean[k] for k in ("timeMax", "q") if k in clean}}
    elif action == "get_event":
        if not clean.get("eventId"):
            raise RuntimeError("get_event 需要 eventId")
        payload = {"calendarId": cal, "eventId": clean["eventId"]}
    elif action == "free_busy_query":
        payload = {"items": [{"id": cal}], "timeMin": clean.get("timeMin") or now, "timeMax": clean.get("timeMax") or now}
    else:  # find_free_slots
        payload = {k: clean[k] for k in ("timeMin", "timeMax") if k in clean}
    try:
        out = oc.execute(f"googlecalendar.{action}", payload, user_id)
    except oc.OpenConnectorError as exc:
        if exc.not_connected:
            raise RuntimeError("您尚未連線 Google Calendar，請先到「連接器」頁按「連線我的帳號」") from exc
        raise RuntimeError(f"日曆閘道錯誤：{exc}") from exc
    return json.dumps(out, ensure_ascii=False)[:8000]


def is_write(type_: str, config: dict, action: str) -> bool:
    """Does this action change something outside the platform? Unknown (e.g. a free-form MCP tool) counts as yes."""
    spec = TYPES.get(type_, {})
    acts = spec.get("actions")
    if isinstance(acts, list):
        a = next((x for x in acts if x["id"] == action), None)
        return bool((a or {}).get("write", True))
    if type_ == "gateway":
        a = next((x for x in ga.describe(config) if x["id"] == action), None)
        return bool(a["write"]) if a else True
    return True


def invoke(type_: str, config: dict, secrets: dict, action: str, args: dict, *, redact_pii: bool, user_id: str | None = None,
           connector_id: str | None = None) -> str:
    """Run one action. Called by the flow interpreter's `tool` node. `user_id` is the signed-in user the flow runs as."""
    spec = TYPES[type_]
    if not spec["available"]:
        raise RuntimeError(spec["coming"])
    if type_ == "gateway":
        mode = ga.mode_of(config.get("auth_mode", ""))
        if mode == "user_oauth" and not user_id:
            raise RuntimeError("需要使用者身分才能呼叫個人授權的服務")
        conn = oc.shared_name(connector_id) if mode == "shared" and connector_id else None
        out = ga.call(config["service"], config, conn, user_id if mode == "user_oauth" else None, action, args)
        return deid.deidentify(out) if redact_pii else out
    if is_user_oauth(type_):
        # Results carry personal data (titles, attendees): pseudonymize before the model sees them when the connector says so.
        out = _calendar_call(config, action, args, user_id)
        return deid.deidentify(out) if redact_pii else out
    if redact_pii:
        args = {k: deid.deidentify(v) if isinstance(v, str) else v for k, v in args.items()}
    if type_ == "mcp":
        c = _mcp(config, secrets)
        c.initialize()
        return c.call_tool(action, args)
    if type_ == "webhook":
        payload = args.get("payload", "")
        try:
            body = json.loads(payload) if payload else {}
        except json.JSONDecodeError:
            body = {"text": payload}
        method = config.get("method", "POST")
        r = httpx.request(method, _webhook_url(config, secrets), headers=_webhook_headers(config, secrets), timeout=TIMEOUT,
                          json=body if method != "GET" else None, params=body if method == "GET" else None)
        r.raise_for_status()
        return r.text[:4000] or f"{method} {r.status_code}"
    if type_ == "slack":
        return _slack_post(config, secrets, str(args.get("text", "")), str(args.get("channel", "")))
    if type_ == "teams":
        return _teams_post(secrets, str(args.get("title", "")), str(args.get("text", "")))
    if type_ == "notion":
        return _notion_append(config, secrets, str(args.get("title", "")), str(args.get("content", "")))
    raise RuntimeError(f"no driver for {type_}")
