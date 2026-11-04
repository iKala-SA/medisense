"""Permission matrix resources (design: re-rbac/role-permission-mgmt.html).

Kept in code, not Firestore: the list follows the features it guards, so changes go through review and deploy with the
feature. Enforced per route with `auth.require_permission`: groups only so far; other resources still use
`require_admin` / `require_builder`.
"""

# (id, name, desc) in the order shown on the design page
RESOURCES: tuple[tuple[str, str, str], ...] = (
    ("chat", "對話", "AI 對話與聊天紀錄"),
    ("chat-viewer", "對話（唯讀）", "AI 對話與聊天紀錄"),
    ("workbench", "我的工作台", "個人動態、行事曆與待辦"),
    ("connectors", "連接器", "外部服務與資料來源串接"),
    ("connectors-viewer", "連接器（唯讀）", "外部服務與資料來源串接"),
    ("spaces", "空間", "團隊協作空間與成員內容"),
    ("spaces-viewer", "空間（唯讀）", "團隊協作空間與成員內容"),
    ("agent", "Agent", "Agent 建立、版本與發佈"),
    ("agent-viewer", "Agent（唯讀）", "Agent 建立、版本與發佈"),
    ("skills", "技能", "Agent 可調用的技能模組"),
    ("skills-viewer", "技能（唯讀）", "Agent 可調用的技能模組"),
    ("schedules", "排程", "定時執行的 Agent 任務"),
    ("schedules-viewer", "排程（唯讀）", "定時執行的 Agent 任務"),
    ("sandbox", "沙盒測試", "Agent 草稿的測試環境"),
    ("sandbox-viewer", "沙盒測試（唯讀）", "Agent 草稿的測試環境"),
    ("users", "使用者管理", "帳號建立、停用與部門指派"),
    ("users-viewer", "使用者管理（唯讀）", "帳號建立、停用與部門指派"),
    ("roles", "角色管理", "角色定義與權限設定"),
    ("roles-viewer", "角色管理（唯讀）", "角色定義與權限設定"),
    ("groups", "群組管理", "群組定義與成員設定"),
    ("groups-viewer", "群組管理（唯讀）", "群組定義與成員設定"),
    ("settings", "設定", "系統與個人偏好設定"),
)
