# Medisense 企業 SSO 設定指南（給醫院資訊室）

Medisense 支援三種登入方式，由管理員在「管理帳戶 → 登入與 SSO」開關與設定：

| 登入方式 | 走哪裡 | 醫院要準備 |
|---|---|---|
| Google Workspace | Firebase 原生 Google 登入 | 允許登入的網域 |
| Microsoft Entra ID（Microsoft 365 / Azure AD） | 開源身分代理 Keycloak | 一個 Entra 應用程式註冊 |
| LDAP / Active Directory | Keycloak 唯讀同步院內目錄 | 一個唯讀服務帳號，以及 Keycloak 能連到目錄的網路 |

所有方式最後都由 Firebase 發登入憑證，Medisense 的權限、群組、稽核不因登入方式而不同。
Entra 用戶端密碼與 LDAP Bind 密碼只存在 Keycloak 的資料庫，Medisense 不保存，也不會在畫面上顯示。

## 0. 平台一次性部署（iKala / 平台維運）

1. Firebase 主控台 → Authentication → 設定 → 升級為 **Identity Platform**。
2. 執行部署腳本，再重新部署後端：

```bash
cd backend && source infra/env.sh
bash infra/15-keycloak.sh
bash infra/04-deploy-backend.sh
```

3. 打開「登入與 SSO」，上方兩個狀態都應是綠色：「Keycloak 已連線」與「Identity Platform 信任 oidc.medisense-sso」。

費用：Keycloak 常駐約每月 US$40–70。Identity Platform 的企業 SSO 登入按每月活躍使用者計費，前 49 位免費。

## 1. Google Workspace

1. 在「允許登入的網域」加入醫院網域，例如 `hospital.org.tw`。這個清單適用於所有登入方式。
2. 「Google 帳號選擇提示（hd）」可填同一網域，登入視窗會預先選這個網域。
3. 如果醫院只用 Microsoft 或 LDAP，可以關閉 Google。部署設定裡的固定管理員仍可用 Google 登入，平台不會被鎖住。

## 2. Microsoft Entra ID

在 Microsoft Entra 系統管理中心操作：

1. 應用程式註冊 → 新增註冊。帳戶類型選「僅此組織目錄中的帳戶」。
2. 重新導向 URI 選「Web」，貼上「登入與 SSO」Entra 卡片上顯示的網址，格式如下：

```
https://medisense-keycloak-<專案編號>.asia-east1.run.app/realms/medisense/broker/entra/endpoint
```

3. 憑證與祕密 → 新增用戶端密碼，複製「值」。密碼有到期日，到期前要回來更新。
4. 權杖設定 → 新增選用宣告 → 權杖類型 ID → 勾選 `email`。Medisense 用 email 對應帳號，沒有 email 的帳號無法登入。
5. API 權限保留 Microsoft Graph 的 `openid`、`profile`、`email`，按「代表組織授與管理員同意」。
6. 回到 Medisense 的 Entra 卡片，填入目錄（租用戶）識別碼、應用程式（用戶端）識別碼、用戶端密碼，按「建立並啟用」。
7. 登出後在登入頁按「使用 Microsoft 帳號登入」測試。

## 3. LDAP / Active Directory

網路：Keycloak 在 Google Cloud 上執行。院內目錄伺服器必須能從 Keycloak 連到，常見做法是 Cloud VPN 或 Interconnect，部署時設 `KC_VPC=1`。建議用 `ldaps://`（636 埠）。

1. 在目錄建立唯讀服務帳號，例如 `CN=svc-medisense,OU=Service,DC=hospital,DC=local`。只需要讀取使用者的權限。
2. 確認使用者有 email 屬性（AD 通常是 `mail`，也可用 `userPrincipalName`），而且屬於允許登入的網域。
3. 在 LDAP 卡片選目錄類型（Active Directory 或 OpenLDAP），填連線網址、Bind DN、Bind 密碼、使用者所在 DN。
4. 想只開放部分人員時，填 LDAP 篩選條件，例如：

```
(memberOf=CN=Medisense Users,OU=Groups,DC=hospital,DC=local)
```

5. 依序按「測試連線」與「測試 Bind 帳號」，都成功後按「建立並啟用」。
6. 登出後按「使用院內帳號登入」，在 Keycloak 頁面輸入院內帳號密碼測試。

Medisense 只讀取目錄，不會修改院內帳號或密碼。

## 4. 同一個人有兩種登入方式

同一個 email 先用 Google 登入過，之後改用 Microsoft 或院內帳號登入時，登入頁會顯示「用 Google 登入並連結」。
連結一次之後，兩種方式都會進到同一個 Medisense 帳號，原本的對話、檔案與連接器都保留。

## 5. 已知限制

- 只用 Microsoft 或 LDAP 登入的人沒有 Google 帳號，BigQuery 的一小時臨時授權無法使用。可以改用 BigQuery 長期連線或其他資料庫連接器。
- 關閉某個登入方式不會刪除帳號。已登入的人在憑證到期（最長一小時）後需要改用其他方式登入。
- 停用帳號仍在「使用者管理」操作，與登入方式無關。
