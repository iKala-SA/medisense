# 群組管理後端規格書

| 項目 | 內容 |
|---|---|
| 文件性質 | 後端規格（2026-10-30 範圍調整後的版本）。以程式碼現況為基準；標示 **已實作** 的內容與程式一致，標示 **過渡期** 的項目仍保留 |
| 範圍 | `/api/groups` 的群組 CRUD，以及群組成員的新增與移除 |
| 不在範圍 | 角色的權限效果（RBAC 權限模型）、自訂角色的權限、主要群組、科別併入群組、資源分享與 `/api/directory`（見第 8 節）。群組與角色的**關聯**（`role_ids`）已納入，見 §2.1 |
| 實作狀態 | 2026-10-30：群組 CRUD、PATCH（名稱、說明、`role_ids`）、成員清單／加入／移出、`role_ids` 驗證與稽核、`updated_by` 均已實作。測試 `backend/tests/test_groups.py`（17 項）
| 目標模組 | `backend/app/routers/groups.py`、`backend/app/schemas.py`（`GroupIn`、`GroupOut`、成員相關 schema）、`backend/app/db.py`（集合說明） |
| 相關文件 | `specifications/FE-GROUP-SPEC.md`、`specifications/FE-USER-SPEC.md`、`specifications/BE-USER-SPEC.md`、`backend/INTEGRATION-API.md` |
| 基準 | `dev-group` 分支，HEAD `48558eb0` |
| 實作狀態 | 2026-10-30：PATCH、成員清單／加入／移除、`updated_by` 與對應稽核已實作，測試見 `backend/tests/test_groups.py`（17 項）。前端已接上成員端點（`frontend/src/api.js`、`frontend/src/live/GroupsPage.jsx`） |

> 範例資料一律使用合成內容，例如 `staff-a@example.test`、「護理部」（依 `AGENTS.md` 原則 4）。

---

## 1. 設計原則

1. **群組目前不影響存取權。** 管理介面只認 `users.role`，群組成員關係不參與任何授權判斷。群組的成員名單目前僅供分享功能使用（見第 8 節）。
2. **成員關係單一來源。** 成員只存於 `groups/{id}.member_emails`，不在使用者文件中重複保存。
3. **管理端點一律 `require_admin`。** 群組相關端點不開放給非管理員。
4. **授權只在後端強制。** 前端的管理員判斷僅為 UI 便利（依 `AGENTS.md` 原則 5）。
5. **變更寫入稽核。** 所有群組與成員變更呼叫 `db.audit(...)`。

---

## 2. 資料模型

### 2.1 集合：`groups/{id}`

| 欄位 | 型別 | 說明 | 狀態 |
|---|---|---|---|
| `id` | string | 文件 ID（Firestore 自動產生，不重複） | 已實作（沿用文件 ID） |
| `name` | string | 1–80 字，去除前後空白後不可為空；同名可重複（見 Q8） | 已實作 |
| `description` | string | 0–500 字；去除前後空白（見 Q8） | 現況 |
| `member_emails` | string[] | 成員 e-mail：去除空白、轉小寫、去重，上限 1000 筆 | 現況 |
| `created_by` / `created_at` | string / datetime | 建立者與建立時間 | 現況 |
| `updated_at` | datetime | 最後更新時間 | 現況 |
| `updated_by` | string | 最後修改者 e-mail | 已實作 |
| `role_ids` | string[] | 與群組關聯的角色，指向 `roles/{id}`（系統角色 `builder`，或既有的自訂角色文件）。可包含 `admin`、`user`（2026-10-30 決定：兩者皆可關聯，列入可選清單）；未知角色回 422。上限 50 筆，去除空白、丟棄空字串並去除重複。刪除自訂角色時，`roles.py` 會自動從所有群組的 `role_ids` 移除該 id（稽核 `role.delete`）。只是關聯，**不影響任何存取權限**（2026-10-30 決定：角色權限暫不實作）。見 §10 Q7 | 已實作（2026-10-30） |

`GroupIn` 包含 `name`、`description`、`member_emails`、`role_ids`。`role_ids` 是 2026-10-30 新增的唯一欄位，其餘欄位不再新增。

### 2.2 `users/{email}` 的 `department`

- 欄位與 API 維持不變，值仍須在 `schemas.DEPARTMENTS`（12 個固定科別）之內，或為空字串。
- 本規格不改變此欄位的儲存或驗證。
- **UI 標籤**：使用者管理頁將此欄位顯示為「群組」（見 `FE-USER-SPEC.md`）。這與本文件的 `groups` 集合是不同的資料，見第 8 節與 FE 規格第 8 節。

---

## 3. 存取控制

| 端點群 | 權限 | 來源 |
|---|---|---|
| `/api/groups`（全部） | `require_admin` | `groups.py` router 層級 dependency（現況） |
| `/api/directory` | 任何已登入使用者 | 分享功能（另案，見第 8 節） |

---

## 4. API 端點

### 4.1 端點總覽

| 方法 | 路徑 | 成功回應 | 說明 | 狀態 |
|---|---|---|---|---|
| GET | `/api/groups` | 200 `GroupOut[]` | 群組列表，依 `name` 不分大小寫排序 | 現況 |
| POST | `/api/groups` | 201 `GroupOut` | 建立群組 | 現況 |
| GET | `/api/groups/{id}` | 200 `GroupOut` | 單一群組 | 現況 |
| PATCH | `/api/groups/{id}` | 200 `GroupOut` | 部分更新：`name`、`description`、`role_ids`（不含成員） | 已實作 |
| PUT | `/api/groups/{id}` | 200 `GroupOut` | 完整取代（含 `member_emails`、`role_ids`） | 現況（過渡期保留，見 Q4） |
| DELETE | `/api/groups/{id}` | 204 | 刪除群組 | 現況 |
| GET | `/api/groups/{id}/members` | 200 `GroupMemberOut[]` | 成員清單 | 已實作 |
| POST | `/api/groups/{id}/members` | 200 `MemberAddResult` | 批次加入既有帳號 | 已實作 |
| DELETE | `/api/groups/{id}/members/{email}` | 204 | 移除單一成員 | 已實作 |

### 4.2 `POST /api/groups`、`PUT /api/groups/{id}`（已實作；過渡期）

- `role_ids`（可省略，預設空陣列）：同 §4.3 的規則，去除空白、丟棄空字串並去除重複；未知角色回 422，拒絕時不寫入。

- `name`：去除前後空白後為 1–80 字，去除後不可為空（422）。**同名允許**（2026-10-30 決定，見 §2.1），不做唯一性檢查。
- `description`：0–500 字，去除前後空白。
- `member_emails`：每筆去除空白、轉小寫；需含 `@` 且不含空白，否則 422；去重；上限 1000 筆。
- `PUT` 為完整取代：省略的 `description` 會變為空字串，省略的 `member_emails` 會變為空陣列，省略的 `role_ids` 會變為空陣列（即清空關聯）。
- 不存在回 404 `group not found`。
- 稽核：`group.create`、`group.update`，含 `group_id`、`name`、`members`（成員數）。

### 4.3 `PATCH /api/groups/{id}`（已實作）

- 可更新 `role_ids`（整份取代，去除重複）。不影響成員名單。只要請求含 `role_ids`，稽核 `group.update` 即記錄 `old_role_ids`、`new_role_ids`（不比對是否真的變動）。

- 請求：`{ "name"?: string, "description"?: string, "role_ids"?: string[] }`，只更新有提供的欄位。
- `member_emails` 會被忽略（不寫入、不報錯）。成員變更一律經由第 4.5 節的端點。
- 名稱去除前後空白後不可為空（422）；同名允許。
- 請求沒有任何可更新欄位時，不寫入、不稽核，直接回傳目前內容。
- 稽核：`group.update`，`fields` 記錄本次請求提供的欄位（不比對是否實際變動）。
- 設計理由：前端編輯名稱時若使用 PUT，會以舊的成員清單覆寫他人剛加入或移除的成員。

### 4.4 `DELETE /api/groups/{id}`（現況）

- 刪除文件，回 204。成員名單隨文件一併刪除。
- 不存在回 404。
- 稽核：`group.delete`，含 `group_id`、`name`。
- 群組被刪除後，分享功能中指向該群組的紀錄不會被清理（見第 8 節）。

### 4.5 成員端點（已實作）

**`GET /api/groups/{id}/members`**

- 回傳 `GroupMemberOut`：`email`、`name`、`department`、`status`（`active` / `suspended`）、`has_account`。
- `has_account` 為 false 表示 `users` 中沒有對應文件（例如帳號已刪除），前端需顯示警示。此時 `name`、`department` 為空字串，`status` 為 `active`。
- 依 `name`（無則 `email`）不分大小寫排序。不分頁；成員上限為 1000 筆。

**`POST /api/groups/{id}/members`**

- 請求：`{ "emails": string[] }`，每次 1–100 筆。
- 每筆去除空白、轉小寫；格式與 `GroupIn` 相同：需含 `@` 且不含空白（見 Q2）。不合格者列入 `rejected`，原因 `invalid_email`。
- 判斷順序：格式 → 已在群組或同一批次重複（列入 `skipped`）→ 網域 → 帳號存在。
- 網域需在 `ALLOWED_DOMAINS` 內（未設定時不限制）。不符者列入 `rejected`，原因 `domain_not_allowed`。
- 必須是既有帳號：`users/{email}` 必須存在，含預先註冊帳號（見 Q3）。不存在者列入 `rejected`，原因 `not_a_registered_account`，**不建立新帳號**。
- 已在群組中的 e-mail 列入 `skipped`，不重複寫入。
- 寫入使用 `ArrayUnion`，避免併發覆蓋。
- 總成員數（現有成員加上本次可加入者）超過 1000 時回 422 `group member limit is 1000`，整批不寫入。
- 回應 `MemberAddResult`：`{ "added": [...], "skipped": [...], "rejected": [{ "email", "reason" }] }`。
- 稽核：`group.member_add`，含 `group_id`、`added` 數量、`rejected` 數量、`emails`（實際加入的清單）。僅在有實際寫入時稽核。

**`DELETE /api/groups/{id}/members/{email}`**

- 不要求理由。
- e-mail 不在群組中回 404 `member not found`。
- 寫入使用 `ArrayRemove`。
- 稽核：`group.member_remove`，含 `group_id`、`email`。

---

## 5. 有效權限

- 本範圍不新增權限模型。管理介面的守門維持 `require_admin`，只看 `users.role`。
- `current_user` **不查詢群組**。因此群組成員的增減不會增加每次請求的 Firestore 查詢，也不需要權限快取的失效機制。
- 分享功能（`sharing.py`）仍會以 `member_emails` 查詢群組，這點不變（見第 8 節）。

---

## 6. 稽核事件

| 事件代碼 | 狀態 | 觸發時機 | 內容重點 |
|---|---|---|---|
| `group.create` | 現況 | 建立群組 | `group_id`、`name`、`members` |
| `group.update` | 已實作（PATCH 記錄請求提供的 `fields`，含 `role_ids` 時另記 `old_role_ids`、`new_role_ids`；PUT 維持現況） | 修改名稱、說明、角色關聯（PATCH）或完整取代（PUT） | `group_id`、`fields`（PATCH）／`name`、`members`（PUT） |
| `group.delete` | 現況 | 刪除群組 | `group_id`、`name` |
| `group.member_add` | 已實作 | 加入成員 | `group_id`、`added` 數量、`rejected` 數量、`emails`（本次實際加入的 e-mail 清單） |
| `group.member_remove` | 已實作 | 移除成員 | `group_id`、`email` |

- 分類為 `access`（`backend/app/routers/audit.py`）。`group.create`、`group.update`、`group.delete`、`group.member_add`、`group.member_remove` 皆已列入（Q9 已決定）。
- 前端 `constants.js` 的 `ACTION_LABEL` 需補上以上所有代碼的顯示名稱（見 FE 規格第 9 節）。

---

## 7. 錯誤對照

| 情境 | HTTP | `detail` |
|---|---|---|
| 非管理員 | 403 | `admin role required` |
| 群組不存在 | 404 | `group not found` |
| 成員不在群組中 | 404 | `member not found` |
| e-mail 格式錯誤（PUT／POST 群組） | 422 | pydantic 驗證錯誤（陣列），`msg` 為 `Value error, invalid e-mail: …` |
| 欄位長度不符（含 `member_emails` 超過 1000 筆、`role_ids` 超過 50 筆） | 422 | pydantic 驗證錯誤（陣列） |
| 批次加入的 `emails` 為空或超過 100 筆 | 422 | pydantic 驗證錯誤（陣列） |
| 成員超過上限 | 422 | `group member limit is 1000` |
| PATCH 名稱為空白 | 422 | pydantic 驗證錯誤（陣列） |
| 角色不存在 | 422 | `unknown role: {id}` |
| 成員批次加入中的不合格項目 | 200（列於 `rejected`） | `invalid_email`、`domain_not_allowed`、`not_a_registered_account` |

---

## 8. 範圍外（維持現況）

| 項目 | 現況 | 本次處理 |
|---|---|---|
| 角色的權限效果（RBAC）、自訂角色的權限 | 不存在 | 不實作；角色的權限不會被套用到任何功能 |
| 主要群組（`primary_group_id`） | 不存在 | 不實作（科別併入暫緩） |
| 使用者的 `department` | 固定 12 個科別（`schemas.DEPARTMENTS`） | 不改動；UI 標籤見第 2.2 節 |
| 資源分享（`sharing.py`、各 `share` 端點） | 以 `groups.member_emails` 判斷群組成員的存取權 | 不改動。**群組成員的增減會影響分享的存取權**，需於另案決定去留 |
| `/api/directory` 的 `groups` 結果 | 回傳群組名稱、說明與成員數 | 不改動；另案 |
| 分享紀錄中的群組標記 | 群組刪除後不會被清理 | 不改動；另案 |

---

## 9. 測試需求

後端測試目前已有 `backend/tests/test_groups.py`（17 項），涵蓋部分下列需求；各項覆蓋狀況以該檔為準。以下為需求清單：

| # | 測試 |
|---|---|
| T1 | 同名群組可建立、可 PATCH／PUT 為既有名稱（不回 409）（已實作） |
| T2 | PATCH 只更新名稱或說明，不影響 `member_emails` |
| T3 | PUT 完整取代行為與現況一致（過渡期）（已實作） |
| T4 | 加入未註冊 e-mail 列入 `rejected`，且不建立 `users` 文件 |
| T5 | 重複加入列入 `skipped`，清單無重複 |
| T6 | 批次加入後超過 1000 人時整批不寫入 |
| T7 | 移除不在群組中的成員回 404 |
| T8 | 併發加入不同成員不會互相覆蓋（`ArrayUnion`） |
| T9 | 刪除群組後成員清單一併消失 |
| T10 | 各端點的稽核事件代碼與內容正確 |
| T11 | 非管理員存取所有群組端點回 403 |
| T12 | 成員清單的姓名與 email 不因 `get_all` 回傳順序而錯配（回歸測試） |
| T13 | `role_ids` 預設為空、可設定與移除、重複值去除、成員不受影響 |
| T14 | `role_ids` 接受 `admin`、`user`、`builder` 與既有自訂角色；未知角色回 422 且拒絕時不寫入（已實作） |

測試使用 `tests/fake_firestore.py`，保持離線可執行。

---

## 10. 待確認事項

| # | 問題 | 本文件採用的預設 | 需要誰決定 |
|---|---|---|---|
| Q1 | 群組名稱唯一性是否改為不分大小寫、去除空白？ | 已由 §2.1 決定為「同名可重複」，不適用 | 負責人＋後端 |
| Q2 | 成員 e-mail 格式是否統一為前端的嚴格規則？ | **已決定（2026-10-30）**：維持後端現行規則（含 `@`、不含空白）；前端的格式檢查需與之相同 | 負責人 |
| Q3 | 成員是否必須為既有帳號（含預先註冊）？ | **已決定（2026-10-30）**：是，只接受既有帳號；未註冊者列入 `rejected`，不建立帳號 | 負責人 |
| Q4 | `PUT` 何時淘汰，改由 `PATCH` 取代？ | 前端已改用 `PATCH`（`api.js` 無群組 `PUT` 呼叫）；移除 `PUT` 的時點待定 | 負責人＋後端 |
| Q5 | 既有群組中若有非帳號的 e-mail，如何處理？ | 列入報告，由管理員手動移除；不自動刪除 | 負責人 |
| Q6 | 同名群組與資料遷移時，既有資料的大小寫如何處理？ | 依 Q1 決定 | 負責人 |
| Q7 | 群組可關聯 `admin` 角色，是否會形成提權路徑？群組成員增減是否因此影響管理權限？ | 關聯已可設定（2026-10-30 實作），但**不授權**。在權限生效前不會有提權。若日後讓角色生效，`admin` 的關聯需另有核可規則（例如只有既有管理員可設定，且需稽核理由）。**權限生效前需負責人確認** | 負責人＋後端 |
| Q8 | POST／PUT 的 `name`、`description` 是否去除前後空白，PATCH 的 `role_ids` 是否過濾空字串？ | 2026-11-02 決定：皆要。`name`、`description` 去除前後空白（`name` 去除後不可為空）；`role_ids` 去除空白並丟棄空字串。已實作（`backend/app/schemas.py`，`backend/tests/test_groups.py`） | 負責人＋後端 |
| Q9 | `group.member_add`、`group.member_remove` 是否列入 `audit.py` 的 `access` 分類？ | 2026-11-02 決定：要。已列入 `backend/app/routers/audit.py` 的 `access` 分類 | 負責人＋後端 |

---

## 11. 維護注意

- 修改 API 時同步更新 `backend/INTEGRATION-API.md`（依 `AGENTS.md`）。
- 新增或修改集合欄位時同步更新 `backend/app/db.py` 頂部的集合說明（依 `AGENTS.md`）。
- 群組端點依 `AGENTS.md` 需有明確權限依賴，本規格為 `require_admin`。
- 修改成員關係時，需同步檢查分享功能（`sharing.py`）的群組判斷。
- 本文件中的範例皆為合成資料，不含真實個資。
