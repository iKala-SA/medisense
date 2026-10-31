# 資料庫連接器：DBA 檢查清單

給負責院內資料庫的 DBA。平台的檢查（SQL 守門、欄位限制、筆數上限）**不是主要防線**，真正的防線是**資料庫帳號本身只能讀被開放的檢視表**。請在管理員於「連接器 → 資料庫」建立連線**之前**完成下列項目，並把帳號與密碼交給管理員（密碼會存進 Secret Manager，之後不會再顯示）。

設計背景見 `DB-CONNECTORS-DESIGN.md`。

## 0. 先決定「有幾種權限等級」
每一種權限等級建立**一個**資料庫帳號，例如：

| 帳號 | 對應的群組（由管理員在平台設定） | 可讀的檢視表 |
|---|---|---|
| `medisense_ro_pharm` | 藥劑部 | `v_stock`、`v_drug_usage` |
| `medisense_ro_nurse` | 護理部 | `v_ward_census` |

使用者**不會**拿到帳號密碼；平台依使用者所屬群組決定這次查詢用哪個帳號。同一個人符合多條規則時，**排在最前面的規則生效**。

## 1. 通用項目（所有資料庫）
- [ ] **只建立唯讀帳號**。不給 INSERT / UPDATE / DELETE / DDL、不給 EXECUTE（預存程序）、不給建立暫存表的權限。
- [ ] **只授權「檢視表」，不授權底層資料表**。檢視表要事先去識別化（遮罩或排除身分證號、病歷號、姓名、電話、地址等），只留查詢需要的欄位。
- [ ] 把「可查的檢視表與欄位」清單提供給管理員（名稱、欄位、哪些欄位是敏感的）。敏感欄位平台會一律擋下，但**最好檢視表裡根本沒有**。
- [ ] **逾時與連線數**：每個帳號限制單一查詢時間與同時連線數（各資料庫做法見下）。
- [ ] **網路**：只允許 Toolbox 所在的 VPC / 子網路連入；不開放公網。Cloud SQL 建議使用 private IP。
- [ ] **加密連線**：啟用 TLS（資料庫端強制）。平台的「啟用 SSL」代表**加密但不驗證憑證**（Postgres `sslmode=require`、MySQL `tls=skip-verify`），內部 CA 或自簽憑證也能連；若要驗證 CA，請告知我們另外處理。
- [ ] **字元集**：MySQL / SQL Server 的資料表與連線請使用 UTF-8（MySQL 為 `utf8mb4`）。資料若以 latin1 存放，中文會以亂碼回傳。
- [ ] **稽核**：開啟資料庫端稽核（pgaudit、SQL Server Audit、MySQL audit plugin、Cloud SQL 稽核旗標），保留帳號、時間、語句。平台另有自己的稽核（誰、哪條規則、哪個查詢、回傳筆數），兩邊互為備援。
- [ ] 密碼：高強度、不重複使用；輪替方式見最後一節。

## 2. PostgreSQL（含 Cloud SQL for PostgreSQL）
```sql
CREATE ROLE medisense_ro_pharm LOGIN PASSWORD '…' CONNECTION LIMIT 10;
ALTER ROLE medisense_ro_pharm SET statement_timeout = '30s';
ALTER ROLE medisense_ro_pharm SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE medisense_ro_pharm SET default_transaction_read_only = on;
REVOKE ALL ON SCHEMA public FROM PUBLIC;           -- 視現況調整
GRANT USAGE ON SCHEMA reporting TO medisense_ro_pharm;
GRANT SELECT ON reporting.v_stock, reporting.v_drug_usage TO medisense_ro_pharm;
```
- 不要 `GRANT ... ON ALL TABLES`；新增檢視表時再逐一授權。
- Cloud SQL：`statement_timeout` 也可用資料庫旗標設定；`ipType` 在平台頁面的「IP 類型」欄選 `private`。

## 3. MySQL（含 Cloud SQL for MySQL）
```sql
CREATE USER 'medisense_ro_pharm'@'%' IDENTIFIED BY '…' REQUIRE SSL WITH MAX_USER_CONNECTIONS 10;
GRANT SELECT ON reporting.v_stock TO 'medisense_ro_pharm'@'%';
GRANT SELECT ON reporting.v_drug_usage TO 'medisense_ro_pharm'@'%';
```
- 平台會對 MySQL 來源設定查詢逾時 30 秒（Toolbox `queryTimeout`）；資料庫端建議同時設 `max_execution_time`（毫秒）。

## 4. SQL Server（含 Cloud SQL for SQL Server）
```sql
CREATE LOGIN medisense_ro_pharm WITH PASSWORD = '…', CHECK_POLICY = ON;
USE hisdb;
CREATE USER medisense_ro_pharm FOR LOGIN medisense_ro_pharm;
GRANT SELECT ON reporting.v_stock TO medisense_ro_pharm;
GRANT SELECT ON reporting.v_drug_usage TO medisense_ro_pharm;
DENY  INSERT, UPDATE, DELETE, EXECUTE, ALTER ON SCHEMA::dbo TO medisense_ro_pharm;
```
- **Toolbox 的 SQL Server 來源沒有查詢逾時設定**（上游尚未支援），所以必須在資料庫端限制：用 **Resource Governor** 為這個登入建立工作負載群組，設定 `REQUEST_MAX_CPU_TIME_SEC`、`MAX_DOP`、`REQUEST_MAX_MEMORY_GRANT_PERCENT`。Cloud SQL for SQL Server 若不支援 Resource Governor，請改用較小的筆數與檢視表複雜度，並監控長查詢。
- Toolbox 的 SQL Server 來源只支援帳號密碼登入（不支援 Windows 驗證 / 每位使用者各自身分），這是本平台以「權限等級帳號 + 群組規則」設計的原因。
- 連線加密：若要強制，請告知管理員（來源的 `encrypt` 設定）。

## 5. BigQuery
BigQuery **不使用共用帳號**：查詢以**使用者自己的 Google 身分**執行（瀏覽器取得的短期授權，平台不儲存），所以 DBA 的工作是 IAM：
- [ ] 建立 Google 群組（例如 `medisense-bq-pharm@…`），對應平台上的群組。
- [ ] 在**被開放的資料集**上授予 `roles/bigquery.dataViewer`；在專案上授予 `roles/bigquery.jobUser`。不要在專案層級授予 dataViewer。
- [ ] 建議以 **Authorized View** 提供去識別化資料，而不是授權底層資料表。
- [ ] 在 Cloud 專案設定每日查詢量 / 掃描量配額（避免一次掃描過多資料）。
- [ ] 平台端設定：唯讀（`writeMode: blocked`）、只允許已登記的資料集（`allowedDatasets`）、筆數上限。
- [ ] OAuth 設定（同意畫面、授權來源、範圍 `https://www.googleapis.com/auth/bigquery`）由管理員在第 7 步依指示完成。
- BigQuery 的查詢**不會**由排程或背景流程執行（沒有使用者在線就沒有授權）。

## 6. 驗證（請 DBA 在交付前做）
以新帳號登入後確認：
- [ ] `SELECT` 已授權的檢視表 → 成功。
- [ ] `SELECT` 底層資料表、系統目錄（`pg_user`、`information_schema` 以外的敏感內容、`sys.*`）→ 失敗或只看得到自己的權限。
- [ ] `INSERT` / `UPDATE` / `DELETE` / `CREATE TABLE` / 呼叫預存程序 → 全部失敗。
- [ ] 故意執行一個很慢的查詢 → 在設定的時間內被中止。
- [ ] 稽核紀錄裡看得到這些動作。

## 7. 平台端部署（由我們的人執行）
1. `source infra/env.sh`；第一次先執行 `bash infra/10-litellm-apply-cicd.sh`（若已做過 LiteLLM 套用就略過），再執行 `bash infra/14-toolbox-apply-cicd.sh`。
2. 管理員在「連接器 → 資料庫」建立連線、帳號、查詢、檢視表與規則 → 按「套用」。第一次也可手動 `bash infra/13-deploy-toolbox.sh`。
3. 把腳本最後印出的 `TOOLBOX_URL` 設到後端（`infra/04-deploy-backend.sh`）。
4. Toolbox 服務是 **internal ingress + 只允許後端的服務帳號呼叫**。Toolbox 內建的 `execute_sql` 沒有任何保護，所以**絕對不可**讓其他服務或使用者直接連到它。

## 8. 密碼輪替與帳號異動
- 輪替：DBA 改密碼 → 管理員在帳號欄輸入新密碼 → 儲存 → 按「套用」。（留空表示沿用舊密碼。）
- 新增權限等級：DBA 建帳號與授權 → 管理員新增帳號 → 在規則中指派給群組 → 套用。
- 開放新的檢視表：DBA 先授權 → 管理員登記檢視表與欄位（敏感欄位要標記）→ 加入規則 → 套用。
- 停用：管理員刪除規則或帳號 → 套用；DBA 同時停用資料庫帳號。
