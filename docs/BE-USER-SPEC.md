# 使用者管理 API 規格書（後端現況）

| 項目 | 內容 |
|---|---|
| 文件性質 | 現有 API 的逆向整理（as-built），供前端對接與後續調整參考 |
| 範圍 | `/api/users` 帳號目錄、預先註冊、角色與狀態變更、原檔閱覽權限、CSV 匯出 |
| 主要程式 | `backend/app/routers/users.py`、`backend/app/auth.py`（`users` 集合存取、帳號記錄與 `require_permission` 權限依賴）、`backend/app/schemas.py`（`UserOut`、`UserDetail`、`UserCreate`、`UserPatch` 等）、`backend/app/db.py`（`audit` 稽核寫入）、`backend/app/routers/audit.py`（稽核分類） |
| 版本基準 | 目前工作目錄（分支 `dev-role`），核對日期 2026-11-02 |
| 測試現況 | `backend/tests/test_sessions.py` 的 `test_admin_grants_original_view_with_reason_and_audit`（`original_view` 缺原因回 422、有原因回 200 並寫入稽核）；`backend/tests/test_users_permissions.py`（`users` / `users-viewer` 權限）；`backend/tests/test_roles.py` 中指派 `roles` 的案例。其餘規則（`ADMIN_EMAILS` 保護、最後 admin 保護、停權與快取失效等）沒有測試 |

> 本文件以程式碼為準。標示為「**待確認**」的項目是程式行為與直覺或文件不一致之處，需與負責人確認。

---

## 1. 存取控制

| 項目 | 規則 | 來源 |
|---|---|---|
| 路由層級 | `APIRouter(prefix="/api/users")`，各端點以 `require_permission("users")` 控管：讀取端點（`GET /api/users`、`GET /api/users/{email}`）需 `users` 或 `users-viewer`；寫入端點（`export.csv`、`POST`、`PATCH`、`DELETE`）需 `users`（`write=True`，`users-viewer` 不足）。帳號角色為 `admin` 者一律通過 | `users.py` 第 36–38 行、`auth.py` `require_permission` |
| 身分驗證 | `Authorization: Bearer <Firebase ID token>`，由 `current_user` 驗證 | `auth.py` `current_user` |
| 無權限 | 403，`permission required`（非 admin 且未持有對應權限） | `auth.py` `require_permission` |
| 被停權帳號 | 403，`account suspended`（`ADMIN_EMAILS` 內的帳號除外） | `auth.py` `current_user` |
| 前端判斷 | 僅為 UI 便利，實際權限以後端為準 | `AGENTS.md` 原則 5 |

---

## 2. 資料模型

集合：`users/{email}`。文件 ID 為小寫 e-mail。

| 欄位 | 型別 | 說明 | 寫入來源 |
|---|---|---|---|
| `email` | string | 小寫 e-mail | 預先註冊、首次登入 |
| `uid` | string | Firebase uid，預先註冊時為 `""`，首次登入時回填 | `auth.py` `_account` |
| `name` | string | 顯示名稱，來自 Google 帳號 | `auth.py` `_account` |
| `role` | string | 儲存值，僅 `admin` / `builder` / `user` 有效 | 預先註冊、`PATCH` |
| `status` | string | `active` / `suspended` | `PATCH` |
| `department` | string | 科別，須在 `DEPARTMENTS` 內或為空字串 | 預先註冊、`PATCH` |
| `original_view` | bool | 可開啟含個資的原始檔 | `PATCH` |
| `original_view_changed_at` / `original_view_changed_by` | datetime / string | 原檔閱覽權限最後變更 | `PATCH` |
| `roles` | string[] | 指派的角色 id（`roles/{id}`），僅作紀錄，存取仍依 `role`；`UserOut` 預設 `[]` | `PATCH` |
| `roles_changed_at` / `roles_changed_by` | datetime / string | 角色指派最後變更（不在 `UserOut` 回傳內） | `PATCH` |
| `groups` | string[] | 所屬群組 id（`groups/{id}`），由群組管理端點寫入；不在 `UserOut` 回傳內，但由 `/api/me` 回傳 | `groups.py` |
| `created_at` / `created_by` | datetime / string | 預先註冊時間與管理者；由登入建立時 `created_by` 為 `""` | 預先註冊、首次登入 |
| `first_login_at` | datetime \| null | 首次登入時間 | `auth.py` |
| `last_seen_at` | datetime \| null | 最後一次 API 呼叫，每 10 分鐘最多寫入一次 | `auth.py` |
| `status_reason` / `status_changed_at` / `status_changed_by` | string / datetime / string | 最後一次狀態變更的原因與操作者 | `PATCH` |
| `role_changed_at` / `role_changed_by` | datetime / string | 最後一次角色變更 | `PATCH` |

**有效角色（effective role）**：`auth.effective_role()` 的計算規則

1. e-mail 在 `ADMIN_EMAILS` 內 → 一律為 `admin`。
2. 儲存的 `role` 在 `ROLES` 內 → 採用該值。
3. 其他 → `user`。

`UserOut.role`、`UserOut.bootstrap_admin` 都是由上述規則計算後回傳，不是直接回傳儲存值。

`GET /api/me` 回傳 `uid, email, name, role, department, roles, groups, permissions`（`permissions` 為使用者 `roles` 與所屬群組的 `role_ids` 所授予的權限 id，不含帳號 `role` 的授權），不含 `original_view`（`main.py` `me`、`auth.py` `granted_permissions`）。

**2026-10-30 說明**：`department` 欄位與 API 名稱不變，僅於前端使用者管理頁的 UI 標籤顯示為「群組」。此欄位與群組管理的 `groups` 集合（見 `BE-GROUP-SPEC.md`）是不同的資料，本次不合併。

**department 容錯**：`UserOut` 的 validator 會把不在 `DEPARTMENTS` 內的科別轉為空字串，不會報錯。

---

## 3. 端點總覽

| 方法 | 路徑 | 權限 | 成功回應 | 說明 |
|---|---|---|---|---|
| GET | `/api/users` | `users` / `users-viewer` | 200 `UserDirectory` | 帳號目錄與網域統計 |
| GET | `/api/users/export.csv` | `users` | 200 CSV 串流 | 匯出 CSV |
| GET | `/api/users/{email}` | `users` / `users-viewer` | 200 `UserDetail` | 單一帳號，含擁有資源數 |
| POST | `/api/users` | `users` | 201 `UserDetail` | 預先註冊 |
| PATCH | `/api/users/{email}` | `users` | 200 `UserDetail` | 變更部門、角色、狀態、角色指派、原檔閱覽權限 |
| DELETE | `/api/users/{email}` | `users` | 204 | 取消尚未使用的預先註冊 |

> 注意：`/export.csv` 必須在 `/{email}` 之前宣告，否則會被當成 email 處理。程式目前的順序正確。

### 3.1 GET `/api/users`

- 回傳 `UserDirectory`：`{ "users": [UserOut], "domains": [{ "domain", "users" }] }`。
- `users`：`users` 集合全部文件，**未分頁**。排序依 `last_seen_at` 降序；`last_seen_at` 為 `null` 時以空字串排序，因此從未登入或僅預先註冊的帳號排在列表最後。
- `domains`：`ALLOWED_DOMAINS` 的每個網域與其帳號數。環境變數未設定時為空陣列。網域清單唯讀，無法由 API 修改。

### 3.2 GET `/api/users/export.csv`

- `Content-Type: text/csv`，檔名 `tcvgh-accounts.csv`，檔案開頭含 UTF-8 BOM（Excel 可正確顯示中文）。
- 欄位順序：`email, name, role, status, department, bootstrap_admin, first_login_at, last_seen_at, created_by, status_reason, status_changed_by, status_changed_at`。
- 每次匯出寫入稽核 `users.export`，並記錄 `rows`（筆數）。
- 匯出內容不含 `uid`、`original_view`、`role_changed_*`。

### 3.3 GET `/api/users/{email}`

- 路徑中的 `email` 會轉小寫查詢。找不到回 404 `user not found`。
- 回傳 `UserDetail` = `UserOut` + `owned`：
  - `agents`：`owner_uid` 為該使用者的 Agent 數量。
  - `published_agents`：其中 `status == "published"` 的數量。
  - `connectors`：`connectors.owner_uid` 符合的數量。
  - `documents`：`documents.uploaded_uid` 符合的數量。
- `uid` 為空（尚未登入）時，`owned` 全部為 0。

### 3.4 POST `/api/users`（預先註冊）

請求 `UserCreate`：

| 欄位 | 型別 | 預設 | 驗證 |
|---|---|---|---|
| `email` | string | 必填 | 長度 3–254；去除前後空白並轉小寫；需符合 `^[^@\s]+@[^@\s]+\.[^@\s]+$`，否則 422 `invalid e-mail` |
| `role` | `admin` \| `builder` \| `user` | `user` | 型別驗證 |
| `department` | string | `""` | 非空時需在 `DEPARTMENTS` 內，否則 422 `unknown department …` |

業務規則：

- `ALLOWED_DOMAINS` 有設定時，網域必須在清單內，否則 422 `… is not an allowed sign-in domain`。
- 已存在的 e-mail（不論是否登入過）回 409 `this e-mail already has an account`。
- 建立的文件：`uid=""`、`status=active`、`created_by=<管理者 e-mail>`、`first_login_at=null`、`last_seen_at=null`。
- 寫入後清除該 e-mail 的快取。
- 稽核：`user.preregister`，含 `target_email`、`role`。
- **不需要 `reason` 欄位**。即使直接指派 `admin` 角色也不需附原因。
  - **待確認**：`PATCH` 變更角色必須填寫原因，預先註冊卻不用，兩者不一致。

### 3.5 PATCH `/api/users/{email}`

請求 `UserPatch`：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `role` | `admin` \| `builder` \| `user` \| null | null 表示不變更 |
| `roles` | string[] \| null，最多 50 筆 | 指派的角色 id，整份取代；null 表示不變更。各項去除空白、略過空字串、去重（保留首次出現順序）。變更**不需** `reason` |
| `status` | `active` \| `suspended` \| null | null 表示不變更 |
| `department` | string \| null | null 表示不變更；空字串表示清除 |
| `original_view` | bool \| null | null 表示不變更 |
| `reason` | string，最長 200 | 變更 `role`、`status` 或 `original_view` 時必填（去除空白後不可為空） |

**判斷「變更」的方式**：

- `role_change`：`role` 非 null 且與目前有效角色不同。
- `status_change`：`status` 非 null 且與目前值不同。
- `view_change`：`original_view` 非 null 且與目前值不同。
- `roles_change`：`roles` 非 null 且與目前 `roles` 不同。
- 若角色、狀態、角色指派、原檔閱覽皆無變更、也沒有部門變更，直接回傳目前資料，不寫入、不稽核。

**驗證順序與錯誤碼**：

| 條件 | 狀態碼 | 訊息 |
|---|---|---|
| 目標帳號不存在 | 404 | `user not found` |
| 變更角色或狀態，且目標為自己 | 409 | `you cannot change your own role or status` |
| 變更角色或狀態，且目標是 `ADMIN_EMAILS` 內的帳號 | 409 | `this admin is set by ADMIN_EMAILS; change it in the deployment, not here` |
| 變更角色或狀態，但 `reason` 為空 | 422 | `a reason is required to change role or status` |
| 會讓 admin 失去權限（角色改為非 admin，或改為 `suspended`），且剩餘啟用中的 admin 為 0 | 409 | `cannot remove the last active admin` |
| 部門不在 `DEPARTMENTS` 內 | 422 | `unknown department …` |
| `roles` 有變更，且含不存在的角色 id（系統角色 `admin` / `builder` / `user` 或 `roles` 集合中的文件皆視為存在） | 422 | `unknown role: <id>` |
| 變更 `original_view`，且目標為自己 | 409 | `you cannot change your own original-file access` |
| 變更 `original_view`，但 `reason` 為空 | 422 | `a reason is required to change original-file access` |

**「剩餘啟用中的 admin」的計算**（`_other_active_admins`）：`ADMIN_EMAILS` 人數（扣除本人）＋ 角色為 `admin`、非 `ADMIN_EMAILS`、非 `suspended`、且不是本人的帳號數。

**寫入內容**：

- 角色變更：`role`、`role_changed_at`、`role_changed_by`。**`reason` 不會存入文件，只寫入稽核**。
- 狀態變更：`status`、`status_reason`、`status_changed_at`、`status_changed_by`。
- 原檔閱覽：`original_view`、`original_view_changed_at`、`original_view_changed_by`。**`reason` 同樣只寫入稽核**。
- 角色指派：`roles`、`roles_changed_at`、`roles_changed_by`。
- 部門變更：只寫 `department`。

寫入後清除快取（`auth.forget`），本機實例立即生效；其他實例最多等待 `CACHE_TTL`（30 秒）。

**Firebase 同步（僅狀態變更）**：

- `suspended`：停用 Firebase 帳號並撤銷 refresh token。
- `active`：重新啟用 Firebase 帳號（不撤銷 token）。
- `uid` 為空（尚未登入的預先註冊）時不呼叫 Firebase，`firebase_synced` 為 `false`。
- 失敗只記 log，不中斷請求，結果記在稽核的 `firebase_synced`。
- 即使 Firebase 同步失敗，`auth.current_user` 的狀態檢查仍會擋下 API 呼叫。

**稽核**（每個變更各寫一筆）：

| 變更 | action | 主要欄位 |
|---|---|---|
| 角色 | `user.role` | `target_email`、`old`、`new`、`reason` |
| 停權 | `user.suspend` | `target_email`、`reason`、`firebase_synced` |
| 復權 | `user.reactivate` | `target_email`、`reason`、`firebase_synced` |
| 原檔閱覽 | `user.original_view` | `target_email`、`old`、`new`、`reason` |
| 角色指派 | `user.roles` | `target_email`、`old`、`new`（無 `reason`） |
| 部門 | `user.update` | `target_email`、`old`、`department` |

稽核 action 在 `routers/audit.py` 歸類為 `access` 的有 `user.role`、`user.suspend`、`user.reactivate`、`user.update`、`user.preregister`、`user.preregister_cancel`、`user.first_login`、`users.export`；`user.roles` 與 `user.original_view` 未列入分類表，目前歸為 `other`。`user.suspend` 列為警示、`user.reactivate` 列為成功。

回應：`UserDetail`（含 `owned`）。

### 3.6 DELETE `/api/users/{email}`

- 僅用於取消**尚未登入過**的預先註冊。`uid` 不為空時回 409 `this person has signed in; suspend the account instead`。
- 找不到回 404。成功回 204，刪除文件並清除快取。
- 稽核：`user.preregister_cancel`。
- 真實帳號不能刪除，只能停權。
- 群組成員關係存於 `users/{email}.groups`（2026-11-02），刪除預先註冊時會連同文件一併移除，不需另外清理。`roles` 指派同樣存於該文件。

---

## 4. 狀態與角色的生命週期

| 狀態 | 進入 | 效果 |
|---|---|---|
| 預先註冊 | POST `/api/users` | `uid=""`，未登入，可被 DELETE 取消 |
| 啟用（active） | 首次登入，或 PATCH 復權 | 可使用 API |
| 停權（suspended） | PATCH `status=suspended` | `current_user` 回 403；Firebase 帳號停用並撤銷 token |

**首次登入**（非本 API，但會改變本 API 回傳的資料）：

- 文件不存在時自動建立，角色為 `admin`（若在 `ADMIN_EMAILS`）或 `user`，`created_by=""`，稽核 `user.first_login`。
- 文件已存在且尚無 `first_login_at`（預先註冊）時回填 `uid`、`first_login_at`，稽核 `user.first_login`，並帶 `preregistered=true`。

**角色的保護規則**：

- `ADMIN_EMAILS` 內的帳號永遠是 admin，不能在本 API 修改角色或停權。
- 最後一位啟用中的 admin 不能被降級或停權。
- 自己不能修改自己的角色、狀態或原檔閱覽權限。

---

## 5. 錯誤碼摘要

| 狀態碼 | 情況 |
|---|---|
| 401 | Bearer token 缺少或無效 |
| 403 | 無 `users` 權限（`permission required`）；帳號停權；e-mail 未驗證；網域不允許 |
| 404 | 帳號不存在 |
| 409 | 重複預先註冊；自我變更；bootstrap admin 變更；最後一位 admin；對已登入帳號執行 DELETE |
| 422 | e-mail 格式錯誤；網域不允許（預先註冊）；科別不存在；缺少原因；欄位型別或長度不符（例如 `reason` 超過 200 字、`role` 不在列舉內，由 Pydantic 回傳預設格式） |

---

## 6. 待確認事項

1. **預先註冊可直接指派 `admin` 而不需原因**，但 `PATCH` 變更角色需要原因。建議統一。
2. **角色與原檔閱覽的原因不寫入文件**，僅存在稽核紀錄。前端若要顯示「最近一次變更原因」，只能查稽核。
3. **users 路由測試覆蓋不足**。除 `original_view`、權限與 `roles` 指派案例外，`ADMIN_EMAILS` 保護、最後 admin 保護、停權與快取失效等規則沒有測試。
4. **`GET /api/users` 未分頁**，帳號數量增加後回應會變大。目前規模下是否可接受？
