# Medisense 架構總覽（含資料庫連接器與 Cloud SQL）

依 repo 現況整理（2026-10-31）。標 ⚠ 的是尚未在真實環境驗證的部分。

## 1. 全貌

```
                         使用者（院內瀏覽器，Google Workspace 登入）
                                        │
                                        ▼
                  Firebase Hosting  ── React/Vite 前端（/api/** 轉送後端）
                                        │  Firebase ID token
                                        ▼
┌──────────────────────── Cloud Run：tcvgh-platform-api（FastAPI）────────────────────────┐
│  驗證/RBAC(admin|builder|user) · 群組 · 分享 ACL · 稽核                                   │
│  Agent Runtime（對話、流程、排程）                                                        │
│  去識別化（DLP）· Model routing · 資料庫授權規則 · SQL 守門                              │
└───┬──────────┬───────────┬────────────┬───────────────┬──────────────┬──────────────────┘
    │          │           │            │               │              │ ⚠ ID token
    ▼          ▼           ▼            ▼               ▼              ▼  (run.invoker)
 Firestore   GCS(CMEK)  Vertex AI    Cloud DLP     Secret Manager   Cloud Run：tcvgh-toolbox
 (資料/稽核) (原始檔)   RAG Engine   (去識別化)   (連接器憑證、     （MCP Toolbox，internal）
                                                    DB 密碼)              │ Direct VPC egress
    │                                                                      │ (private ranges)
    ▼ OpenAI 相容 + IAM                                                     ▼
 Cloud Run：tcvgh-litellm（internal）                          ┌──────── 資料庫 ────────┐
  ├ Vertex AI Gemini                                          │ Cloud SQL (PG/MySQL/   │
  ├ AWS Bedrock（keyless）                                    │  SQL Server, private IP)│
  ├ Ollama VM（院內模型，sovereign）                          │ 院內自建 PG/MySQL/MSSQL │
  └ Model Armor                                               └────────────────────────┘
                                                              BigQuery：不經 Toolbox 共用帳號，
                                                              ⚠ 用使用者自己的 Google token（第 7 步）
```

## 2. 元件與職責

| 元件 | 做什麼 | 重點 |
|---|---|---|
| Firebase Hosting + React | 前端、`/api/**` rewrite | 預設 mock，`VITE_MOCK_API=0` 才連後端 |
| tcvgh-platform-api | 所有業務邏輯 | 唯一能呼叫 Toolbox、LiteLLM 的服務 |
| Firestore（命名資料庫） | Agent、連接器、群組、對話、稽核、`config/*` 快照 | 對話有保留天數 TTL |
| Secret Manager | 連接器憑證、資料庫密碼（每個帳號一個 secret） | 密碼寫入後不再回傳 |
| LiteLLM（Cloud Run） | 模型閘道、路由、Model Armor | 設定由「Model 註冊」→ 套用 → GitHub Actions 重新部署 |
| Vertex RAG / GCS / DLP | 知識庫、原始檔（CMEK）、去識別化 | 模型只看到去識別化內容 |
| **MCP Toolbox（Cloud Run）** | 以唯讀帳號執行 SQL 工具 | internal ingress，僅後端 SA 可呼叫；`execute_sql` 無保護，**不得被其他方連到** |
| **Cloud SQL / 院內資料庫** | 實際資料 | 每種權限等級一個唯讀帳號，只授權去識別化 View |

## 3. 資料庫查詢一次完整流程

1. 管理員在「連接器 → 資料庫」建立連線、帳號、預先定義查詢(A)、可查詢檢視表(B)、依群組排序的存取規則。
2. 每次儲存，後端把設定渲染成 `tools.yaml` 存入 Firestore `config/toolbox_render`（密碼只以 `${DBPW_n}` 參照 Secret Manager）。
3. 管理員按「套用」→ 後端快照並觸發 GitHub Actions（`toolbox-apply.yml`）→ `infra/13-deploy-toolbox.sh` 把 YAML 放進 secret `toolbox-tools`，重新部署 Toolbox。
4. 使用者與 Agent 對話：
   - 後端依**執行者本人**的群組，第一條符合的規則決定可用的查詢/檢視表與資料庫帳號；無符合＝拒絕，管理員也無捷徑。
   - A：模型只填參數，後端呼叫 `連接器__帳號__查詢` 工具。
   - B：模型寫 SQL → sqlglot 守門（單一 SELECT、僅登記檢視表與欄位、禁敏感欄位、函式白名單、強制 LIMIT）→ 通過才呼叫 `*-execute-sql`。
   - 結果去識別化後才回給模型；寫一筆 `db.query` 稽核（不含內容）。
5. 排程以排程擁有者身分、用其規則執行；BigQuery 不支援排程。

## 4. 防線分層（資料庫）

| 層 | 防護 | 性質 |
|---|---|---|
| 1 資料庫角色 | 唯讀、只授權 View、逾時、連線數、稽核 | **主要防線**（DBA 負責，見 DBA 檢查清單） |
| 2 網路 | Toolbox internal ingress + VPC；Cloud SQL private IP；僅後端 SA 可呼叫 | 隔離 |
| 3 平台授權 | 群組規則、每次呼叫重驗、無管理員捷徑 | 誰能查什麼 |
| 4 SQL 守門 | 解析、白名單、LIMIT | 擋明顯錯誤、給模型修正依據 |
| 5 輸出 | DLP 去識別化、筆數截斷、稽核 | 事後與外洩控制 |

## 5. Cloud SQL 在哪裡

- Toolbox 使用 `cloud-sql-postgres` / `cloud-sql-mysql` / `cloud-sql-mssql` 來源，經 Cloud SQL connector 連線（Toolbox SA 需 `roles/cloudsql.client`），建議 `ipType: private`，連線本身加密。
- 帳號密碼仍是「權限等級帳號」模式，密碼在 Secret Manager，以環境變數 `DBPW_n` 掛入 Toolbox。
- 一般自建資料庫（postgres/mysql/mssql）走 Direct VPC egress 的私有位址，並可勾「啟用 SSL」⚠（三種值依驅動慣例，未對真實庫驗證）。

## 6. 部署與變更流程

| 對象 | 腳本 / 流程 |
|---|---|
| 基礎、API、前端 | `infra/01–05, 07, 08, 11`；Hosting 由 GitHub Actions 部署 |
| LiteLLM | 管理頁「套用」→ `litellm-apply.yml` → `infra/09` → `03` |
| Toolbox | 管理頁「套用」→ `toolbox-apply.yml` → `infra/13`；一次性權限 `infra/14`（先跑 `infra/10`） |
| 後端 | `infra/04`，需帶 `TOOLBOX_URL` |

## 7. 未驗證 / 待辦

- ⚠ Toolbox 實機：`/mcp` 路徑、`execute-sql` 參數名 `sql`、SSL 值、空設定是否能啟動、映像版本（目前 `:latest`）。
- ⚠ 部署腳本與 GitHub 工作流程只做過語法檢查。
- SQL Server 無查詢逾時（上游限制），靠資料庫端 Resource Governor。
- BigQuery 使用者授權流程（第 7 步）、「流程」多步驟接資料庫、範例問答的管理畫面（第 6 步）。
- Oracle HIS 刻意暫緩。
