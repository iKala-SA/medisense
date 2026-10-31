# 資料庫連接器（Database）設計

狀態：草案，待確認後實作。日期：2026-10-30。

## 1. 目標與範圍
- 在「連接器」頁新增 **資料庫** 分頁（與 SaaS 區分）。
- 第一階段資料庫：**PostgreSQL、MySQL、BigQuery、SQL Server、Cloud SQL**（PostgreSQL / MySQL / SQL Server 三種）。Oracle HIS 暫不做。
- 查詢層級：**A 預先定義的參數化查詢** ＋ **B 範圍內的自然語言查詢**。
- 只有**管理員**能建立、修改資料庫連接器與存取規則。

## 2. 架構
```
Agent / 流程 / 對話 ─► 後端（授權、SQL 檢查、去識別化、稽核）─► MCP Toolbox（Cloud Run，內部存取）─► 資料庫
```
- Toolbox 只接受後端的呼叫，不認得平台的使用者與角色。**所有授權判斷都在後端**。
- 資料庫帳密只存在 Secret Manager，由 Toolbox 以環境變數 `${NAME}` 取用，不進後端程式或 Firestore。
- 後端用現有的 MCP 客戶端呼叫 Toolbox（`tools/list`、`tools/call`）。

## 3. 授權：用「群組」決定資料庫角色
資料庫連接器有一份**存取規則**清單，由管理員排序：

| 欄位 | 說明 |
|---|---|
| 群組 | 沿用現有 `groups/{id}`（`member_emails`） |
| 資料來源 | 對應一個**唯讀的資料庫角色**（Toolbox 的一個 source） |
| 開放的查詢 | A：預先定義的查詢清單 |
| 開放的視圖 | B：可被自然語言查詢的視圖與欄位 |

- 規則由上而下比對，**第一條符合的生效**；沒有符合的規則 **一律拒絕**。
- 比對對象是**執行的人**，不是 Agent 擁有者。分享 Agent 不等於分享資料。
- **排程執行**：用排程擁有者的規則，畫面上註明。BigQuery 不支援排程（見 §6）。
- 使用者屬性（email、群組）由後端直接綁到查詢參數，**不經過模型**。不使用 Toolbox 的 `authenticatedParameters`（有[已知問題 #4049](https://github.com/googleapis/mcp-toolbox/issues/4049)，且後端已驗證過使用者）。
- 現有的自訂角色還沒有強制力，這個設計不依賴它；日後可加「是否有查詢權限」的前置條件，不用改本設計。

## 4. 查詢層級
**A．預先定義的查詢**：管理員寫 SQL（用 `$1`、`?` 等參數佔位）與參數說明，後端存成 Toolbox 的 `postgres-sql`／`mysql-sql`／`mssql-sql`／`bigquery-sql` 工具。模型只能填參數。**不使用 template parameters**（官方警告會繞過預備陳述式、有 SQL injection 風險）。

**B．範圍內的自然語言查詢**：管理員登記**可查詢的視圖**（名稱、說明、欄位清單、敏感欄位標記、範例問答）。模型在這個範圍內產生**唯讀** SQL。Toolbox 的 `execute_sql` 沒有保護（無唯讀、筆數、逾時），所以後端在轉送前檢查：
1. 只允許單一 `SELECT`（解析語法，不用字串比對）。
2. 只允許存取已登記的視圖與欄位；敏感欄位一律拒絕。
3. 強制加筆數上限（預設 100 列）。
4. 禁止多重陳述、註解夾帶、函式呼叫白名單以外的函式。
5. 檢查通不過就拒絕並回報原因，不送出。
這一層**不是**主要防線；真正的防線是資料庫角色本身只有那些視圖的唯讀權限。

兩者共通：結果回到模型前一律**去識別化**；每次呼叫寫入稽核（誰、哪個連接器、哪條規則、哪個查詢或 SQL、回傳筆數，不記內容）。

## 5. 各資料庫的設定（依 Toolbox 官方文件）
| 資料庫 | Toolbox source 類型 | 連線欄位 | 逾時 | 備註 |
|---|---|---|---|---|
| PostgreSQL | `postgres` | host、port、database、user、password | 靠資料庫角色的 `statement_timeout` | 角色設唯讀 |
| MySQL | `mysql` | host、port、database、user、password、`queryParams` | `queryTimeout` | 可設 TLS |
| SQL Server | `mssql` | host、port、database、user、password | **Toolbox 尚無 `queryTimeout`**（[#4287](https://github.com/googleapis/mcp-toolbox/issues/4287)） | 逾時要靠後端或資料庫端 |
| Cloud SQL | `cloud-sql-postgres`（及 mysql / mssql 版本） | project、region、instance、database、user、password、`ipType` | 同上 | 支援密碼或 IAM 驗證；**文件沒列 readOnly 欄位** |
| BigQuery | `bigquery` | project、location、`allowedDatasets`、`writeMode`、`maxQueryResultRows`、`maximumBytesBilled` | 以 `maximumBytesBilled` 控成本 | 見 §6 |

- 所有 source 都設唯讀（可設定時）；密碼用 `${ENV}`。
- 第一階段要確認的 Toolbox 欄位（我只讀到部分頁面）：SQL Server、Cloud SQL MySQL / SQL Server 的完整 source 欄位，以及 toolsets 宣告語法。實作時逐頁驗證，不憑印象。

## 6. BigQuery：用使用者本人的身分（方案 A）
- 設 `useClientOAuth: X-BigQuery-Auth`（自訂標頭，避免跟 Cloud Run 的 `Authorization` 衝突）、`writeMode: blocked`、`allowedDatasets`。
- 使用者第一次查詢時，**瀏覽器向 Google 取得約一小時的 access token**（範圍 `bigquery`），隨請求送到後端，後端轉給 Toolbox。**我們不保存任何使用者憑證**。
- 權限由 Google IAM 決定：使用者需有專案的「BigQuery 工作使用者」與資料集／視圖的「資料檢視者」。
- 限制：**排程與背景執行無法使用 BigQuery**（沒有使用者在場）；token 過期時請使用者重新授權。
- 你要做的：啟用 BigQuery API；OAuth 同意畫面設為「內部」並加入 `https://www.googleapis.com/auth/bigquery` 範圍；確認 Web OAuth 用戶端的授權來源包含平台網址；用 Google 群組授權使用者。

## 7. 設定如何送到 Toolbox（需要你決定）
Toolbox 的資料來源與工具來自 `tools.yaml`；它支援動態重新載入，但 Cloud Run 的檔案系統是暫時的。我們沒有驗證「在 Cloud Run 上不重新部署就能更新設定」可不可靠，有兩個做法：
- **做法 1（建議）：沿用 LiteLLM 的模式**：管理員儲存 → 後端把設定檢查、渲染成 `tools.yaml` 存進 Firestore → 按「套用」→ GitHub Actions 重新部署 Toolbox。好處：已有現成流程、可稽核、可回滾；缺點：套用要幾分鐘。
- **做法 2：把設定放在掛載的儲存空間，靠動態重新載入**：變更即時，但 Cloud Run 與重新載入的行為我還沒驗證過，風險較高。

## 8. 基礎設施（你執行，我寫腳本）
- `backend/infra/13-deploy-toolbox.sh`：部署 Toolbox 為 Cloud Run 服務，**只允許後端的服務帳戶呼叫**；服務帳戶；資料庫帳密的 Secret 掛載。
- Toolbox 到資料庫的網路（VPC／私有 IP）；資料庫只允許 Toolbox 的服務帳戶來源。
- **給 DBA 的清單**（我會產生）：每種資料庫建立唯讀角色、只授權指定視圖、設定語句逾時、連線上限的 SQL 範本。

## 9. 畫面
- 連接器頁最上層：**SaaS｜資料庫**。SaaS 維持現狀，資料庫是獨立的清單與搜尋。
- 資料庫分頁：連接器清單（狀態、資料庫種類、規則數、被幾個 Agent／流程使用）。
- 新增／編輯（管理員）：選種類 → 連線資訊（密碼只進 Secret Manager）→ 存取規則（群組排序）→ 預先定義查詢 → 可查詢視圖 → 測試連線 → 套用。
- 規則測試工具：輸入一個 email，顯示會命中哪條規則、能用哪些查詢與視圖。

## 10. 實作順序
1. 資料模型與後端授權（連接器、存取規則、稽核）＋測試。
2. SQL 檢查層（B）＋測試（大量惡意與邊界案例）。
3. 管理員畫面（資料庫分頁、精靈、規則、測試工具）。
4. Toolbox 部署腳本、DBA 清單、套用流程。
5. 預先定義查詢（A）端到端，接上 Agent／流程。
6. 範圍內自然語言查詢（B）端到端。
7. BigQuery 使用者憑證流程。

## 11. 未決與風險
- §7 的設定更新方式（做法 1 或 2）。
- SQL Server 無查詢逾時；Cloud SQL 無 readOnly 欄位：需靠資料庫角色。
- B 的準確度取決於視圖說明與範例的品質；產生的 SQL 一律先過 §4 的檢查。
- 資料庫中有直接識別資訊的欄位：去識別化是處理結果文字，擋不住「問法」造成的間接識別，所以敏感欄位要在視圖層就排除。
- 本文件的 Toolbox 設定細節都來自官方文件的部分頁面，未實測。
