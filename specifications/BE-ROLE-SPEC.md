# 角色管理 API 規格書（後端現況）

| 項目 | 內容 |
|---|---|
| 文件性質 | 後端現況（as-built）與暫緩項目的保留說明 |
| 範圍 | `GET /api/roles`、`POST /api/roles`、`PATCH /api/roles/{id}`；Firestore `roles` 集合 |
| 主要程式 | `backend/app/routers/roles.py`、`backend/app/schemas.py`（`RoleOut`、`RoleIn`、`RolePatch`）、`backend/app/db.py`（集合說明）、`backend/tests/test_roles.py` |
| 前端對照 | `specifications/FE-ROLE-SPEC.md` |
| 版本基準 | 分支 `remove-deferred-role-features`，2026-11-02 |
| 遷移紀錄 | `backend/scripts/migrate_role_status.py`（`suspended` → `status`，已於正式資料執行） |

> **範圍說明**：本 API 僅管理系統角色 `admin`、`builder`、`user` 的顯示名稱、英文名稱、說明、狀態與權限標籤（僅供顯示），以及新增與刪除自訂角色。下列項目 **暫緩**，不屬於目前實作：單一角色的詳細端點、權限矩陣（資源 × 操作）、寫入時必填的變更原因、自訂角色的成員指派。第 5 節保留這些項目的想法。

---

## 1. 設計原則

1. **存取控制**：所有 `/api/roles` 端點都依賴 `require_admin`，非管理員回 403。
2. **角色分類**：
   - **系統角色**：`admin`、`builder`、`user`。沒有 Firestore 文件時使用程式內建值（`SYSTEM_ROLES`）；有文件時，文件欄位覆寫內建值。
   - **自訂角色**：`roles` 集合中其餘的文件。目前只能由 `POST` 建立。
3. **固定管理員**：`admin` 不可經由 API 修改（`PATCH` 回 403）。`ADMIN_EMAILS` 指定的帳號永遠為 `admin`，在成員數中計入。
4. **權限標籤僅供顯示**：`can` 是前端顯示用的能力標籤（字串陣列）。目前不參與 `require_admin`、`require_builder` 等存取判斷。`permission_count` 等於 `len(can)`。
5. **稽核**：建立與修改角色會寫入 `db.audit(...)`，動作名稱為 `role.create`、`role.update`。

---

## 2. 資料模型

### 2.1 集合 `roles/{role_id}`

文件 ID 為角色代號。系統角色的代號固定為 `admin`、`builder`、`user`；自訂角色的代號由系統（Firestore 自動 ID）產生，不開放由使用者指定（2026-11-02 決定）。

| 欄位 | 型別 | 說明 | 寫入來源 |
|---|---|---|---|
| `name` | string | 角色名稱，1–40 字，去除前後空白後不可為空 | `POST`、`PATCH` |
| `en` | string | 英文名稱，最多 40 字，可為空字串（非必填） | `POST`（固定為空字串）、`PATCH` |
| `desc` | string | 說明，最多 300 字 | `POST`、`PATCH` |
| `custom` | boolean | 是否為自訂角色。`POST` 寫入 `true`。文件沒有此欄位時，以代號判斷：`admin`、`builder`、`user` 為系統角色，其餘為自訂 | `POST` |
| `status` | boolean | 狀態，**`true` = 啟用**。文件沒有此欄位時視為啟用。`POST` 寫入 `true` | `POST`、`PATCH` |
| `can` | string[] | 權限標籤，最多 20 個，每個 1–20 字，去除前後空白並去除重複 | `PATCH` |
| `created_at` / `created_by` | datetime / string | 建立時間與建立者 e-mail | `POST` |
| `updated_at` / `updated_by` | datetime / string | 最後修改時間與修改者 e-mail | `PATCH`（系統角色的覆寫文件也會寫入） |

> 舊欄位 `suspended` 已改名為 `status`（語意反轉）。讀取時不再使用 `suspended`。正式資料的遷移已由人工完成。

### 2.2 集合 `users`（相關欄位）

成員數由 `users/{email}` 的有效角色計算（`auth.effective_role`）：`ADMIN_EMAILS` 內的帳號為 `admin`；`role` 不在允許清單內或缺少時為 `user`。

---

## 3. API 端點

所有端點前綴為 `/api/roles`，皆依賴 `require_admin`。

| 方法 | 路徑 | 成功 | 錯誤 | 說明 |
|---|---|---|---|---|
| GET | `/api/roles?search=&type=` | 200 `RoleListOut` | 403 | 角色列表與統計 |
| POST | `/api/roles` | 201 `RoleOut` | 403、422 | 新增自訂角色 |
| PATCH | `/api/roles/{role_id}` | 200 `RoleOut` | 403（`admin`）、404（不存在的自訂角色）、422 | 修改基本資料、狀態與權限標籤 |
| DELETE | `/api/roles/{role_id}` | 204 | 403（內建角色）、404（不存在） | 刪除自訂角色，並移除群組中的關聯 |

### 3.1 GET `/api/roles`

- **查詢參數**：`search`（最長 100 字，比對名稱、英文名稱、說明，不分大小寫）；`type`（`all` / `system` / `custom`，其他值回 422）。前端目前只使用前端過濾，不傳這兩個參數。
- **排序**：系統角色依 `admin`、`builder`、`user` 順序在前，自訂角色依名稱排序在後。
- **統計**：`stats` 一律計算全部角色，不受 `search` 與 `type` 影響。

回應範例：

```json
{
  "roles": [
    {
      "id": "admin", "name": "系統管理員", "en": "Admin", "desc": "…",
      "custom": false, "status": true, "member_count": 1,
      "permission_count": 4, "can": ["發布核可", "監控與成本", "資安稽核", "帳號管理"]
    }
  ],
  "stats": { "total_roles": 3, "system_roles": 3, "custom_roles": 0, "assigned_users": 4 }
}
```

- `member_count`：有效角色等於此角色的使用者數。
- `assigned_users`：所有角色的 `member_count` 加總。

### 3.2 POST `/api/roles`（新增自訂角色）

- **請求主體（`RoleIn`）**：`{ "name": "現場主管", "desc": "負責現場排班" }`
  - `name`：必填，1–40 字，去除前後空白後不可為空。
  - `desc`：選填，最多 300 字，預設空字串。
- **行為**：代號由 Firestore 自動產生；寫入 `custom: true`、`status: true`、`en: ""`、`can: []`。
- **回應**：201 與新角色的 `RoleOut`。
- **稽核**：`role.create`（`role_id`、`name`）。

### 3.3 PATCH `/api/roles/{role_id}`（修改角色）

- **請求主體（`RolePatch`）**，所有欄位皆選填，只寫入有傳入的欄位：

  | 欄位 | 規則 |
  |---|---|
  | `name` | 1–40 字，去除前後空白後不可為空 |
  | `en` | 最多 40 字，去除前後空白，允許空字串（即清空） |
  | `desc` | 最多 300 字 |
  | `status` | boolean，`true` = 啟用 |
  | `can` | 最多 20 個；每個去除前後空白後 1–20 字；重複項目保留第一個 |

- **業務規則**：
  - `role_id == "admin"` → 403（`admin role is fixed`）。
  - 自訂角色不存在 → 404（`role not found`）。系統角色即使沒有文件也可以修改，會建立覆寫文件。
  - 傳入空的請求主體 → 200，不寫入、不記稽核。
- **寫入方式**：`merge=true`，只更新傳入的欄位，並更新 `updated_at`、`updated_by`。
- **稽核**：`role.update`（`role_id`、`fields`）。
- **回應**：200 與更新後的 `RoleOut`。

### 3.4 DELETE `/api/roles/{role_id}`（刪除自訂角色）

- **行為**：刪除 `roles/{role_id}` 文件，並把該代號從所有群組的 `role_ids` 移除（同一次請求完成）。群組只保存代號，不會留下指向不存在角色的關聯。
- **錯誤**：
  - 403（`built-in role cannot be deleted`）：`admin`、`builder`、`user` 一律不可刪除，即使有覆寫文件。
  - 404（`role not found`）：不是系統角色，且文件不存在。
- **成功**：204，無回應內容。
- **成員**：自訂角色的有效角色只會是 `admin`、`builder`、`user`，因此自訂角色不會有成員，刪除時不需檢查成員數。
- **稽核**：`role.delete`（`role_id`、`name`）。

---

## 4. 回應欄位（`RoleOut`）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | 角色代號 |
| `name` / `en` / `desc` | string | 見 2.1 |
| `custom` | boolean | 系統角色為 `false` |
| `status` | boolean | `true` = 啟用 |
| `member_count` | integer | 有效角色為此角色的使用者數 |
| `permission_count` | integer | `len(can)`，僅為標籤數，不是實際權限數 |
| `can` | string[] | 權限標籤 |

> 目前沒有 `GET /api/roles/{id}`。前端的細節頁直接使用列表中的資料。

---

## 5. 暫緩項目（保留）

| 項目 | 說明 | 狀態 |
|---|---|---|
| `GET /api/roles/{id}` | 單一角色詳細資料（含權限矩陣） | 暫緩 |
| 權限矩陣 | 11 項資源 × `create` / `read` / `update` / `delete`，儲存格式尚未決定。目前後端的存取控制仍寫死在程式碼中（`require_admin`、`require_builder`） | 暫緩 |
| 變更原因 `reason` | 狀態或權限變更時必填，寫入稽核。目前 `PATCH` 不要求此欄位 | **待確認**（與使用者管理的規則是否一致） |
| 狀態變更的 409 檢查 | 停用角色前檢查是否仍有成員 | 暫緩 |
| 動態權限查表 | 依 `roles` 集合在 `auth.py` 動態判斷權限 | 暫緩 |
| 預設自訂角色 | 「AI 審核員」與「教育訓練講師」是否需要重建 | **待確認**（負責人決定） |

---

## 6. 維護注意

- 新增、修改欄位時，同步更新 `backend/INTEGRATION-API.md` 的 Roles 章節與本文件。
- `status` 語意為 `true` = 啟用。任何新的寫入路徑都必須使用同一語意。
- `constants.js` 的 `ROLES` 仍供使用者管理的下拉選單使用，名稱需與系統角色的內建值一致。
