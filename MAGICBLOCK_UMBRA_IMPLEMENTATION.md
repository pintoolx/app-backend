# MagicBlock & Umbra 實作總覽 — 配合 Admin Dashboard

> 本文檔說明我在 PinTool Backend 中實作的 MagicBlock（ER / PER / PP）與 Umbra（Encrypted User Account）兩大隱私基礎設施模組，以及 Admin Dashboard 如何讓營運團隊即時監控與管理這些元件。

---

## 一、架構設計原則

### 1.1 Adapter Pattern（雙模式自動切換）

所有外部協議整合都遵循 **Port-Adapter 架構**：

```
magicblock.port.ts          ← 定義介面（Port）
magicblock-er-real.adapter.ts   ← 真實實作（Real）
magicblock-noop.service.ts      ← 模擬實作（Noop）
```

**MagicBlockModule** 使用 NestJS `useFactory` 在啟動時自動偵測環境變數：

| 環境變數 | 有值時 | 無值時 |
|---------|--------|--------|
| `MAGICBLOCK_ROUTER_URL` | 注入 **MagicBlockErRealAdapter** | 注入 **MagicBlockErNoopAdapter** |
| `MAGICBLOCK_PER_ENDPOINT` | 注入 **MagicBlockPerRealAdapter** | 注入 **MagicBlockPerNoopAdapter** |
| `MAGICBLOCK_PP_ENDPOINT` | 注入 **MagicBlockPrivatePaymentsRealAdapter** | 注入 **MagicBlockPrivatePaymentsNoopAdapter** |
| `UMBRA_MASTER_SEED` | 注入 **UmbraRealAdapter** | 注入 **UmbraNoopAdapter** |

這讓團隊可以在 **本地開發**（noop 模式，無需外部服務）與 **生產環境**（real 模式，連接真實端點）之間無縫切換，且系統永遠不會因缺少環境變數而崩潰。

### 1.2 Admin Dashboard 的可觀測性設計

Admin Dashboard 的 `Overview`、`Privacy`、`System` 三個頁面都會讀取 **Adapter Matrix**，即時顯示每個 adapter 是 `real`（綠色）還是 `noop`（灰色）。這讓營運團隊一眼就能確認哪些隱私功能已上線。

---

## 二、MagicBlock 三大模組

### 2.1 ER — Ephemeral Rollups（交易擴容層）

**檔案**: `backend/src/magicblock/magicblock-er-real.adapter.ts`

MagicBlock ER 是 Solana 的 ephemeral rollup 擴容方案，我的實作提供三個核心操作：

| 方法 | 功能 | Admin 可觀測 |
|------|------|-------------|
| `delegateAccount()` | 將部署的金庫帳戶委派到 ER，透過 Magic Router 提交已簽名的 base64 交易 | ✅ Privacy → ER Delegated 計數 |
| `route()` | 將任意使用者簽名交易透過 Magic Router 路由（ER vs mainnet 自動選擇） | ✅ Deployment Privacy View → er.sessionId |
| `commitAndUndelegate()` | Commit 狀態並解除委派，同樣透過 Magic Router 提交 | ✅ Privacy → Recently Committed (24h) |

**設計亮點**：
- 不依賴 Rust SDK（與 Solana 3.1.x toolchain 不相容），而是讓客戶端準備好已簽名的交易後，由 adapter 負責透過 HTTP 轉發到 Magic Router
- 若無 `signedTxBase64` 會進入 "advisory mode"，記錄 intent 但不阻塞生命週期流程

**Admin Dashboard 對應**：
- `Overview` → Adapter Matrix 中 `er` 欄位顯示 real/noop
- `Privacy` → KPI **ER Delegated**（已委派部署數）、**Recently Committed (24h)**（24h 內 commit 次數）
- `Privacy` → 點進 Deployment Privacy View 可看到該部署的 `er_session_id`、`er_router_url`、`er_committed_at`、`er_delegate_signature`、`er_undelegate_signature`

---

### 2.2 PER — Private Ephemeral Rollups（私有狀態層）

**檔案**: `backend/src/magicblock/magicblock-per-real.adapter.ts`

PER 提供「權限群組 + Challenge/Token 認證 + 私有狀態讀取」的完整私有rollup能力。

| 方法 | 功能 | Admin 可觀測 |
|------|------|-------------|
| `createPermissionGroup()` | 為部署建立 PER 權限群組，設定 member wallet + role | — |
| `requestAuthChallenge()` | 產生 32-byte nonce challenge，存入 Postgres `per_auth_tokens` | ✅ Privacy → PER Tokens 列表 |
| `verifyAuthSignature()` | 驗證 Ed25519 簽名（tweetnacl），將 challenge 升級為 `active` token | ✅ Privacy → PER Active 計數 |
| `getPrivateState()` | 用 active token 讀取 PER 私有狀態與日誌 | — |

**認證流程**（Frontend → Backend）：
```
1. Client POST /per/challenge → 取得 nonce challenge（5 分鐘有效）
2. Client 用 wallet 私鑰簽署 challenge
3. Client POST /per/verify → Backend 驗證簽名，發放 authToken（30 分鐘有效）
4. Client 用 authToken 呼叫 /per/private-state
```

**設計亮點**：
- 完整的 server-side challenge/token 生命週期管理（`challenge` → `active` → `revoked`）
- Token 儲存在 Postgres，支援 admin 查詢與撤銷
- 簽名驗證使用 `tweetnacl` + `@solana/web3.js` PublicKey，確保 Solana 錢包相容

**相關資料表**（`backend/src/database/schema/initial-5-per.sql`）：
- `per_groups` — 權限群組
- `per_group_members` — 群組成員與角色
- `per_auth_tokens` — challenge/token 狀態（這是 Admin Dashboard 直接讀取的表）

**Admin Dashboard 對應**：
- `Privacy` → KPI **PER Active**（有效 token 數）、**Expiring 24h**（24h 內過期 token）
- `Privacy` → **PER Tokens 列表**（token prefix、deployment、wallet、status、issued、expires）
- `Privacy` → Operator 可 **Revoke Token** 或 **Revoke All for Deployment**
- `Overview` → Adapter Matrix 中 `per` 欄位

---

### 2.3 PP — Private Payments（隱私支付層）

**檔案**: `backend/src/magicblock/magicblock-private-payments-real.adapter.ts`

| 方法 | 功能 | Admin 可觀測 |
|------|------|-------------|
| `deposit()` | 隱私存款 | — |
| `transfer()` | 隱私轉帳 | — |
| `withdraw()` | 隱私提款 | — |
| `getBalance()` | 查詢加密餘額（回傳 ciphertext + encryptedBalanceRef） | — |

**設計亮點**：
- 統一的 `dispatch()` helper 處理所有 PP API 呼叫，統一錯誤處理與日誌
- 所有操作回傳 `status: 'pending' | 'confirmed' | 'failed'`，支援異步確認

**Admin Dashboard 對應**：
- `Overview` / `Privacy` / `System` → Adapter Matrix 中 `pp` 欄位顯示 real/noop
- `Privacy` → 點進 Deployment Privacy View 可看到 `pp_session_id`、`pp_endpoint_url`

---

## 三、Umbra — Encrypted User Account（加密用戶帳戶）

**檔案**: `backend/src/umbra/umbra-real.adapter.ts`、`umbra-deployment-signer.service.ts`

Umbra 是基於 Arcium MPC 的加密用戶帳戶協議，我的實作提供完整的註冊、金庫、餘額查詢與 viewer 授權能力。

### 3.1 金鑰派生系統

**UmbraDeploymentSignerService** 是核心安全元件：

```
master_seed（env 或 system_config）
  ├── SHA-256("umbra-ed25519" || deploymentId || master_seed) → ed25519 Keypair
  ├── SHA-256("umbra-x25519"  || deploymentId || master_seed) → x25519 keyPair
  └── HMAC-SHA-256(master_seed, deploymentId).hex.slice(0,16) → seedRef（非機密參照）
```

**設計亮點**：
- **Deterministic**：同一 deployment 永遠產生同一組金鑰，idempotent
- **Dual-source**：master seed 可從 `env` 或 `system_config` table 載入，支援 runtime rotation
- **Never logged**：master seed 只載入一次，cache 在 memory，log 中只出現 `seedRef` 和 fingerprint

### 3.2 UmbraRealAdapter 操作

| 方法 | 功能 | Admin 可觀測 |
|------|------|-------------|
| `registerEncryptedUserAccount()` | 派生金鑰對，可選 enqueue 到 Umbra Queue | ✅ Privacy → Umbra Registrations 統計 |
| `deposit()` | 隱蔽存款（enqueue 到 queue） | — |
| `withdraw()` | 隱蔽提款 | — |
| `transfer()` | 隱蔽轉帳 | — |
| `getEncryptedBalance()` | 透過 Umbra Indexer 查詢加密餘額 | — |
| `grantViewer()` | 授權第三方 wallet 查看加密餘額 | — |

**Local-only 模式**：當 `UMBRA_QUEUE_URL` 未設定時，adapter 仍會派生金鑰並回傳 X25519 pubkey，但不會嘗試 enqueue。這讓開發者可以在沒有 Umbra 服務的情況下測試金鑰派生邏輯。

**Admin Dashboard 對應**：
- `Privacy` → KPI **Umbra Registrations**（confirmed / pending / failed / unset）
- `Privacy` → 點進 Deployment Privacy View 可看到 `umbra_user_account`、`umbra_x25519_pubkey`、`umbra_signer_pubkey`、`umbra_registration_status`
- `System` → **Key Report**（superadmin only）顯示 `umbraMasterSeed` 的 presence、source（env/system_config）、fingerprint（SHA-256 truncated）
- `Overview` / `Privacy` → Adapter Matrix 中 `umbra` 欄位

---

## 四、API 端點（User-Facing）

所有功能都透過 `StrategyDeploymentsController` 暴露為 REST API，受 `JwtAuthGuard` 保護：

### MagicBlock ER
```
POST /deployments/:id/er/delegate     ← 提交已簽名委派交易
POST /deployments/:id/er/route        ← 透過 Magic Router 路由交易
POST /deployments/:id/er/undelegate   ← 提交已簽名 undelegate 交易
```

### Umbra
```
POST /deployments/:id/umbra/register   ← 註冊 EUA（confidential / anonymous）
POST /deployments/:id/umbra/deposit    ← 隱蔽存款
POST /deployments/:id/umbra/withdraw   ← 隱蔽提款
POST /deployments/:id/umbra/transfer   ← 隱蔽轉帳
GET  /deployments/:id/umbra/balance    ← 查詢加密餘額
POST /deployments/:id/umbra/grant      ← 授權 viewer
```

### MagicBlock PER
```
POST /deployments/:id/per/challenge    ← 索取 challenge nonce
POST /deployments/:id/per/verify       ← 驗證簽名，取得 authToken
GET  /deployments/:id/per/private-state ← 讀取私有狀態（需 PerAuthGuard）
POST /deployments/:id/per/members      ← 替換群組成員
```

### MagicBlock PP
```
POST /deployments/:id/pp/deposit       ← 隱私存款
POST /deployments/:id/pp/transfer      ← 隱私轉帳
POST /deployments/:id/pp/withdraw      ← 隱私提款
GET  /deployments/:id/pp/balance       ← 查詢加密餘額
```

---

## 五、Admin Dashboard 各頁面與 MagicBlock/Umbra 的對應關係

| Admin 頁面 | 能看到什麼 | 操作能力 |
|-----------|-----------|---------|
| **Overview** | Adapter Matrix（5 adapter real/noop 狀態）、Running Executions | 唯讀 |
| **Privacy** | PER Token 統計（active/expiring/snapshots/ER delegated）、Adapter Status 卡片、PER Token 列表（可 revoke）、Umbra 註冊統計 | Operator+ 可 Revoke Token / Revoke All for Deployment |
| **System** | Health Check JSON（含 MagicBlock ER/PER/PP 和 Umbra 檢查）、Keeper Status、Adapter Matrix、Maintenance Mode | Superadmin 可開關維護模式 |
| **Deployments** | 部署列表與狀態 | Operator+ 可 Pause/Resume/Stop/Force Close |

---

## 六、測試與規格

每個 Real Adapter 都有對應的 `.spec.ts` 單元測試：
- `magicblock-er-real.adapter.spec.ts`
- `magicblock-per-real.adapter.spec.ts`
- `magicblock-private-payments-real.adapter.spec.ts`
- `umbra-real.adapter.spec.ts`
- `umbra-deployment-signer.service.spec.ts`

Noop Adapters 也有測試確保 fallback 行為正確。

---

## 七、當前生產狀態

目前 Railway production 環境中：
- `MAGICBLOCK_ROUTER_URL` — 未設定 → ER: **noop**
- `MAGICBLOCK_PER_ENDPOINT` — 未設定 → PER: **noop**
- `MAGICBLOCK_PP_ENDPOINT` — 未設定 → PP: **noop**
- `UMBRA_MASTER_SEED` — 未設定 → Umbra: **noop**

這表示所有隱私模組處於待命狀態。設定對應環境變數後，MagicBlockModule 會在下次啟動時自動切換為 real adapter，Admin Dashboard 的 Adapter Matrix 也會即時更新為 `real`（綠色）。

---

## 八、總結

這次實作覆蓋了 **MagicBlock 全線產品（ER、PER、PP）** 與 **Umbra 加密帳戶協議**，從底層 HTTP client、Adapter Pattern、金鑰派生、Challenge/Token 認證，到完整的 Admin Dashboard 可觀測性與操作介面，形成了一套完整的隱私策略基礎設施。
