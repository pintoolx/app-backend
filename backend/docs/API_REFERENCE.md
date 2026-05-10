# Backend API Reference

> **Live OpenAPI/Swagger**: 啟動 backend 後可直接打 `http://<host>:3000/api/docs` 互動式 try-it。
> 這份文件是**離線快速索引**——所有路由、auth 模式、DTO 名稱都在這裡，便於前端整合時對照。
> 文件 by feature area 分組，跟 `backend/src/**/*.controller.ts` 結構對應。

## 0. 全域慣例

### Auth 模式速查

| Guard | Header / Mechanism | 用在哪 |
|---|---|---|
| **JWT** (`JwtAuthGuard`) | `Authorization: Bearer <jwt>` | 大多 user-facing endpoint。從 `POST /auth/login` 拿 |
| **AdminJWT** (`AdminJwtGuard` + `AdminRolesGuard`) | `Authorization: Bearer <admin_jwt>` | 所有 `/admin/**` 路由。要先過 `/admin/auth/login` + `/admin/auth/2fa` |
| **PER token** (`PerAuthGuard`) | `Authorization: Bearer <per_token>` 或 `X-PER-Token: <per_token>` | `/private-state` 類 endpoint。Subscription-scoped |
| **API Key** (`ApiKeyGuard`) | `X-API-Key: <agent_api_key>` | Agent / workflow 端點 |
| **Signature-based** | request body 帶 `walletAddress` + `signature` | Crossmint / `/auth/login` |
| **none** | — | 公開資料：marketplace、health、metrics、creator profile |

### 共通 response envelope
所有 controller 都回 `{ success: true, data: ... }`（list 端點多帶 `count`）。SSE 端點直接 stream message events。

### 錯誤碼
- `400` — DTO validation / business rule violation
- `401` — 沒帶/錯 token
- `403` — 帶了但權限不夠（admin role、PER scope mismatch）
- `404` — 資源不存在（含「不屬於這個 wallet」case）
- `500` — adapter / DB 失敗

### Cross-cutting patterns
- **Quote / preview** 端點 (`/subscriptions/.../quote`, `/.../withdraw-preview`, `/strategies/:id/purchase-quote`) 一律不改 DB 狀態，純讀取/計算
- **Idempotency**: `/private-execution/cycles` 接 `idempotencyKey`；`/strategies/:id/purchase-confirm` 用 `payment_tx_signature` UNIQUE 防重複
- **SSE**: `/subscriptions/:id/events` 推 `cycle.applied` event
- **Status enums**:
  - Deployment: `draft / deployed / paused / stopped / closed`
  - Subscription: `pending_funding / active / paused / exiting / closed`
  - Execution: `pending / running / completed / failed / cancelled`
- **Admin audit**：所有 admin 改動會自動寫 audit log（`@AdminAudit` decorator）

---

## 1. Auth (Wallet sign-in)

**Controller**: `backend/src/auth/auth.controller.ts` · **Auth**: 公開

| Method | Path | Summary |
|---|---|---|
| POST | `/auth/challenge` | 產生 wallet 簽章用的 challenge nonce（5 分鐘有效） |
| POST | `/auth/login` | 驗證 challenge 簽章，回 JWT + wallet 身份 |

**DTO**: `WalletChallengeDto` (`{ walletAddress }`), `WalletLoginDto` (`{ walletAddress, signature }`)

---

## 2. Admin Auth (2FA flow)

**Controller**: `backend/src/admin/auth/admin-auth.controller.ts` · **Auth**: IP allowlist enforced

| Method | Path | Summary |
|---|---|---|
| POST | `/admin/auth/login` | Step 1：email + password → 拿到 2FA-pending token |
| POST | `/admin/auth/2fa` | Step 2：驗 TOTP → 拿到 access + refresh token |
| POST | `/admin/auth/refresh` | Rotate refresh token，回新 access session |
| POST | `/admin/auth/logout` | Revoke 當前 refresh token |
| GET | `/admin/auth/me` | 回當前 admin 身份 claims（要 AdminJWT） |

**DTOs**: `AdminLoginDto`, `AdminTotpVerifyDto` (`{ tempToken, code }`), `AdminRefreshDto`

---

## 3. Strategies (Marketplace + Owner CRUD)

**Controller**: `backend/src/strategies/strategies.controller.ts`

| Method | Path | Auth | Summary |
|---|---|---|---|
| GET | `/strategies` | JWT | 列出我訂閱的 creator 已發佈的 strategies |
| GET | `/strategies/marketplace` | none | **公開 marketplace**：所有已發佈 strategy + creator denorm（verified、subscriber count、price、forSaleOneTime）|
| GET | `/strategies/me` | JWT | 我擁有的所有 strategies |
| GET | `/strategies/me/purchases` | JWT | 我買斷過的 strategies 清單 |
| GET | `/strategies/:id` | JWT | Strategy 詳情。owner / 訂閱者 / 已買斷者 → private view；其他 → public view |
| GET | `/strategies/:id/pnl` | none | 30d PnL 時序（draft strategy 回 synthetic preview，標 `isPreview: true`，可帶 `?days=1..90`） |
| GET | `/strategies/:id/private` | JWT | Owner-only 的完整 private view |
| POST | `/strategies` | JWT | 從 workflow graph 建草稿 strategy |
| PATCH | `/strategies/:id` | JWT | 更新 strategy（owner-only） |
| POST | `/strategies/:id/compile` | JWT | 重新 compile public + private IR |
| POST | `/strategies/:id/publish` | JWT | 發佈到 marketplace |
| PATCH | `/strategies/:id/purchase-price` | JWT | 上架/下架單買價（owner-only），body `{ priceAmount, paymentMint }`，傳 null 下架 |
| GET | `/strategies/:id/purchase-quote` | none | 買斷報價（公開） |
| POST | `/strategies/:id/purchase-intent` | JWT | 組未簽 SPL transfer 給 buyer 簽 |
| POST | `/strategies/:id/purchase-confirm` | JWT | 提交 `txSignature`，後端驗 mint+amount+payout 後寫入 |

**Typed responses**: `MarketplaceStrategyView`, `StrategyView`, `PnlTimeseriesView`, `StrategyPurchaseView`

---

## 4. Strategy Deployments

**Controller**: `backend/src/strategy-deployments/strategy-deployments.controller.ts` · **Auth**: JWT

### Lifecycle
| Method | Path | Summary |
|---|---|---|
| POST | `/strategies/:id/deploy` | 建 deployment（綁帳號 + vault） |
| GET | `/deployments/me` | 我擁有的所有 deployments |
| GET | `/deployments/:id` | Deployment 詳情（creator-only） |
| POST | `/deployments/:id/pause` | 暫停 |
| POST | `/deployments/:id/resume` | 恢復 |
| POST | `/deployments/:id/stop` | 停止 |
| POST | `/deployments/:id/close` | 關閉（terminal） |
| POST | `/deployments/:id/trigger` | 手動觸發一次 strategy run |
| POST | `/deployments/:id/collect-fees` | 收取累積 fee |
| POST | `/deployments/:id/set-keeper` | 設定/清除 on-chain keeper |
| POST | `/deployments/:id/public-snapshot` | 透過 Anchor 發佈 typed public snapshot |
| POST | `/deployments/:id/close-vault-authority` | 關 vault authority account |
| POST | `/deployments/:id/close-public-snapshot` | 關 public snapshot account |

### ER (Ephemeral Rollups)
| Method | Path | Summary |
|---|---|---|
| POST | `/deployments/:id/er/delegate-strategy-state` | Delegate state 到 ER validator |
| POST | `/deployments/:id/er/delegate` | Delegate vault 到 MagicBlock ER |
| POST | `/deployments/:id/er/route` | 透過 Magic Router 轉發 base64 tx |
| POST | `/deployments/:id/er/undelegate` | Commit ER state 並 undelegate |

### Umbra (private treasury)
| Method | Path | Summary |
|---|---|---|
| POST | `/deployments/:id/umbra/register` | 註冊 per-deployment Umbra Encrypted User Account |
| POST | `/deployments/:id/umbra/deposit` | 排入 shielded deposit |
| POST | `/deployments/:id/umbra/withdraw` | 排入 shielded withdraw 到公開錢包 |
| POST | `/deployments/:id/umbra/transfer` | 排入 shielded transfer |
| GET | `/deployments/:id/umbra/balance` | 讀 encrypted treasury balance |
| POST | `/deployments/:id/umbra/grants` | 給 viewer key 看 balance |

### PER (Privacy Enhanced Routing)
| Method | Path | Auth | Summary |
|---|---|---|---|
| POST | `/deployments/:id/per/groups` | JWT | 取代 PER 權限群組成員 |
| GET | `/deployments/:id/per/auth/challenge` | none | 拿 PER auth challenge |
| POST | `/deployments/:id/per/auth/verify` | none | 驗簽，換 PER bearer token |
| GET | `/deployments/:id/per/private-state` | PER | 讀 PER private state |

### Permissions
| Method | Path | Summary |
|---|---|---|
| POST | `/deployments/:id/permissions` | 給 wallet 角色（creator-only） |
| DELETE | `/deployments/:id/permissions/:memberWallet` | 撤銷角色 |
| GET | `/deployments/:id/permissions` | 列出該 deployment 的所有 permission |

---

## 5. Subscriptions & Follower Vaults

### 5.1 訂閱主流程

**Controller**: `backend/src/follower-vaults/subscriptions.controller.ts` · **Auth**: JWT

| Method | Path | Summary |
|---|---|---|
| **GET** | `/deployments/:deploymentId/subscriptions/quote` | **Subscribe modal pre-flight quote**：費用、PDA preview、risk guardrail。`?amount=&mint=&riskPreset=` |
| POST | `/deployments/:deploymentId/subscriptions` | 建訂閱（含 risk preset、auto-rebalance、optional deposit→bundle fund-intent） |
| GET | `/deployments/:deploymentId/subscriptions` | 列該 deployment 所有訂閱（creator-only） |
| GET | `/deployments/:deploymentId/subscriptions/:subscriptionId` | 單筆訂閱 lifecycle view |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/fund-intent` | 組 unsigned funding 指令 |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/submit-fund-intent` | 提交已簽 funding tx |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/shield` | Shield funds 進 Umbra（自動 → active） |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/pause` | 暫停訂閱 |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/resume` | 恢復訂閱 |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/unsubscribe` | 開始 exit |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/redeem` | 完成 exit、關訂閱 + vault |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/resume-provisioning` | 重啟中斷的 on-chain provisioning |
| POST | `/deployments/:deploymentId/subscriptions/:subscriptionId/params` | 組 unsigned `adjust_subscription_params` 指令 |

### 5.2 Withdraw / Balance / PnL / Events

| Method | Path | Summary |
|---|---|---|
| **GET** | `/deployments/:deploymentId/subscriptions/:subscriptionId/withdraw-preview` | **部分提領 dry-run**，含 `willCloseVault` 警示 |
| **POST** | `/deployments/:deploymentId/subscriptions/:subscriptionId/withdraw-intent` | 組 unsigned `withdraw_from_vault` 指令 |
| GET | `/deployments/:deploymentId/subscriptions/:subscriptionId/balance` | Vault SPL token 餘額 |
| GET | `/deployments/:deploymentId/subscriptions/:subscriptionId/private-balance` | 讀加密 treasury balance（per-vault Umbra 身份） |
| GET | `/deployments/:deploymentId/subscriptions/:subscriptionId/pnl` | Per-subscription yield / APR / timeseries |
| **SSE** | `/deployments/:deploymentId/subscriptions/:subscriptionId/events` | **Stream `cycle.applied` event**，每筆 applied receipt 一個 message |

### 5.3 PER + Visibility Grants
| Method | Path | Auth | Summary |
|---|---|---|---|
| GET | `/deployments/:id/subscriptions/:subId/per/auth/challenge` | JWT | Issue subscription-scoped PER challenge |
| POST | `/deployments/:id/subscriptions/:subId/per/auth/verify` | JWT | 驗 challenge → 拿 follower-self PER token |
| GET | `/deployments/:id/subscriptions/:subId/private-state` | PER | 讀 sanitized follower-private state |
| POST | `/deployments/:id/subscriptions/:subId/visibility-grants` | JWT | 發 bounded visibility grant |
| GET | `/deployments/:id/subscriptions/:subId/visibility-grants` | JWT | 列 grants |
| GET | `/deployments/:id/subscriptions/:subId/visibility-grants/:grantId` | JWT | 讀單筆 grant |
| DELETE | `/deployments/:id/subscriptions/:subId/visibility-grants/:grantId` | JWT | Revoke grant |

### 5.4 跨 deployment 視圖

**Controller**: `backend/src/follower-vaults/my-subscriptions.controller.ts` · **Auth**: JWT

| Method | Path | Summary |
|---|---|---|
| GET | `/subscriptions/me` | **跨 deployment 列出我所有訂閱**（含 `?status=` filter）。Portfolio dashboard 用這支 |

### 5.5 私密執行週期

**Controller**: `backend/src/follower-vaults/private-execution-cycles.controller.ts` · **Auth**: JWT

| Method | Path | Summary |
|---|---|---|
| POST | `/deployments/:deploymentId/private-execution/cycles` | 啟動私密執行 cycle（接 `idempotencyKey` 防重複） |
| GET | `/deployments/:deploymentId/private-execution/cycles/:cycleId` | 拿 cycle + per-follower receipts |
| GET | `/deployments/:deploymentId/private-execution/cycles` | 列最近的 cycles |

**Typed responses**: `FollowerSubscriptionView`（含 `riskPreset`/`autoRebalance`/`onchainFootprint`/`fundIntentInstruction`）, `SubscriptionPnlView`, `WithdrawPreview`, `WithdrawIntent`, `PrivateExecutionCycleView`

---

## 6. Creator Subscriptions (月費方案)

**Controller**: `backend/src/creator-subscriptions/creator-subscriptions.controller.ts`

| Method | Path | Auth | Summary |
|---|---|---|---|
| PATCH | `/creator-subscriptions/plan` | JWT | Creator 設定/更新月費方案 |
| GET | `/creator-subscriptions/creators/:creatorWallet/plan` | none | 公開讀月費方案 |
| POST | `/creator-subscriptions/creators/:creatorWallet/intent` | JWT | Subscriber 建立或刷新訂閱 intent |
| GET | `/creator-subscriptions/creators/:creatorWallet/payment-intent` | JWT | Subscriber 拿付款細節 |
| POST | `/creator-subscriptions/creators/:creatorWallet/confirm-payment` | JWT | Subscriber 提交 `txSignature` 確認付款、開通 access |
| GET | `/creator-subscriptions/me` | JWT | 列我訂閱的 creator |
| POST | `/creator-subscriptions/creators/:creatorWallet/cancel` | JWT | 取消訂閱 |

---

## 7. Creator Profile (公開)

**Controller**: `backend/src/creators/creators.controller.ts` · **Auth**: 公開

| Method | Path | Summary |
|---|---|---|
| GET | `/creators/:wallet` | Creator profile：display name、verified flag、subscriber count、月費價、最近發佈 strategies |

---

## 8. Workflow / Workflow-AI

### 8.1 Workflows

**Controller**: `backend/src/workflows/workflows.controller.ts` · **Auth**: API Key

| Method | Path | Summary |
|---|---|---|
| GET | `/workflows/active` | 列出 lifecycle manager 內存中的 active workflow instances |

### 8.2 Workflow AI

**Controller**: `backend/src/workflow-ai/workflow-ai.controller.ts` · **Auth**: JWT

| Method | Path | Summary |
|---|---|---|
| POST | `/workflow-ai/conversations` | 建新 AI 對話 |
| POST | `/workflow-ai/conversations/:id/messages` | 送訊息（**SSE stream** AI 回應） |
| POST | `/workflow-ai/conversations/:id/confirm` | 確認儲存生成的 workflow |
| GET | `/workflow-ai/conversations/:id` | 對話歷史 + status |
| POST | `/workflow-ai/conversations/:id/draft-strategy` | 預覽生成的 workflow 為 draft strategy |
| POST | `/workflow-ai/conversations/:id/confirm-strategy` | 把 workflow 存成新 strategy |

---

## 9. Agent (Node Registry)

**Controller**: `backend/src/agent/agent.controller.ts`

| Method | Path | Auth | Summary |
|---|---|---|---|
| POST | `/agent/register` | none | Agent 用 wallet 簽名註冊，拿 API key |
| GET | `/agent/accounts` | API Key | 列 agent accounts |
| **GET** | `/agent/nodes` | none | **列出所有 node 類型 + 參數**（前端 Workflow Canvas 用這支拿 primitive library） |
| POST | `/agent/workflows` | API Key | 建 workflow |
| POST | `/agent/wallets/init` | API Key | 用 Crossmint 建 account wallet |
| DELETE | `/agent/wallets/:id` | API Key | 關 account、提走資產 |

> **Node 種類**（`/agent/nodes` 回 12 個）：`pythPriceFeed`、`heliusWebhook`、`jupiterSwap`、`orcaSwap`、`jupiterLimitOrder`、`kamino`、`luloLend`、`stakeSOL`、`driftPerp`、`sanctumLst`、`transfer`、`getBalance`、`riskGuard`（後者為 sibling Anchor program）。
> 每個 node 的 `properties[]` 中如果有 `sensitive: true`，前端應在 Strategy Detail public view 畫 🔒 icon 在那個欄位旁。

---

## 10. Crossmint (Managed Wallets)

**Controller**: `backend/src/crossmint/crossmint.controller.ts` · **Auth**: 簽名驗證

| Method | Path | Summary |
|---|---|---|
| POST | `/crossmint/wallets/init` | 用 Crossmint 建 account wallet |
| DELETE | `/crossmint/wallets/:id` | 刪除/關閉 account，提走資產 |
| POST | `/crossmint/wallets/:id/withdraw` | 從 account wallet 提 SOL 到 owner |

---

## 11. Referrals

**Controller**: `backend/src/referral/referral.controller.ts` · **Auth**: JWT（admin route 走內部 role check）

| Method | Path | Summary |
|---|---|---|
| POST | `/referrals/admin/codes` | Admin 為目標 wallet 產 single-use codes |
| POST | `/referrals/admin/codes/unlimited` | Admin 產 unlimited-use codes（dev 用） |
| PATCH | `/referrals/admin/quotas/:walletAddress` | Admin 設 wallet 的 lifetime code quota |
| PATCH | `/referrals/admin/quotas/:walletAddress/increase` | Admin 增加 quota |
| POST | `/referrals/codes` | User 在自己 quota 內產 single-use codes |
| POST | `/referrals/redeem` | 兌換 single-use referral code |
| GET | `/referrals/my-codes` | 列我建的 codes |

---

## 12. Admin (詳細區)

> **共通**：所有 `/admin/**` 都要 AdminJWT，敏感操作（force-close、ban、maintenance toggle）需 superadmin role。

### 12.1 Overview / Audit / System
| Method | Path | Summary |
|---|---|---|
| GET | `/admin/overview` | KPI snapshot：counts、adapter matrix、recent actions |
| GET | `/admin/audit` | 搜尋 audit log（max 500 筆，filter by admin/action/target/status/date） |
| GET | `/admin/system/adapter-matrix` | 顯示哪些 port 是 real vs noop |
| GET | `/admin/system/health` | 完整 health probe（DB、RPC、adapters） |
| GET | `/admin/system/keeper` | Keeper keypair 狀態 + on-chain SOL 餘額 |
| GET | `/admin/system/maintenance` | 讀 maintenance mode 狀態 |
| POST | `/admin/system/maintenance` | 切 maintenance mode（superadmin） |

### 12.2 Strategies / Deployments
| Method | Path | Summary |
|---|---|---|
| GET | `/admin/strategies` | 列所有 strategy（bypass creator filter） |
| GET | `/admin/strategies/:id` | Detail + version history |
| GET | `/admin/deployments` | 列所有 deployment |
| GET | `/admin/deployments/:id` | Detail + recent runs |
| POST | `/admin/deployments/:id/pause` | Operator 暫停 |
| POST | `/admin/deployments/:id/resume` | Operator 恢復 |
| POST | `/admin/deployments/:id/stop` | 停止（body 要 echo `confirmTargetId`） |
| POST | `/admin/deployments/:id/force-close` | Superadmin 強制關閉（撤 PER token） |
| POST | `/admin/deployments/:id/emergency-pause` | Operator 緊急暫停 |
| POST | `/admin/deployments/:id/emergency-resume` | Operator 緊急恢復 |
| POST | `/admin/deployments/:id/collect-fees` | Operator 收 fee |

### 12.3 Executions
| Method | Path | Summary |
|---|---|---|
| GET | `/admin/executions` | 列 workflow executions |
| POST | `/admin/executions/:id/kill` | 取消 running execution |

### 12.4 Privacy ops
| Method | Path | Summary |
|---|---|---|
| POST | `/admin/privacy/per-tokens/:token/revoke` | Revoke 單個 PER token |
| POST | `/admin/privacy/deployments/:id/revoke-all-tokens` | Revoke 該 deployment 所有 PER token |
| POST | `/admin/privacy/visibility-grants/:id/revoke` | Revoke visibility grant |
| POST | `/admin/privacy/follower-vaults/:id/pause` | 暫停 vault + 訂閱 |
| POST | `/admin/privacy/follower-vaults/:id/recover` | Recover 暫停的 vault |
| POST | `/admin/privacy/private-cycles/:id/retry` | Retry 已完成/失敗的 cycle |

### 12.5 Privacy 觀察
| Method | Path | Summary |
|---|---|---|
| GET | `/admin/privacy/overview` | 隱私 + 加密狀態：adapter modes、PER tokens、snapshots、Umbra、ER |
| GET | `/admin/privacy/per-tokens` | 列 PER tokens（redacted；前 8 chars） |
| GET | `/admin/privacy/snapshots` | 列 public snapshots |
| GET | `/admin/privacy/keys` | 加密 key inventory（superadmin only；secret 永不返回） |
| GET | `/admin/privacy/deployments/:id` | 該 deployment 的隱私詳情 |
| GET | `/admin/privacy/deployments/:id/follower-vaults` | 列該 deployment 的 follower vaults |
| GET | `/admin/privacy/deployments/:id/subscriptions` | 列該 deployment 的訂閱 |
| GET | `/admin/privacy/deployments/:id/private-cycles` | 列該 deployment 的私密 cycles |
| GET | `/admin/privacy/follower-vaults` | 跨 deployment 列 follower vaults |
| GET | `/admin/privacy/subscriptions` | 跨 deployment 列訂閱 |
| GET | `/admin/privacy/private-cycles` | 跨 deployment 列私密 cycles |
| GET | `/admin/privacy/private-cycles/:cycleId` | 單筆 cycle + sanitized receipts |
| GET | `/admin/privacy/umbra-identities` | Per-vault Umbra identity inventory |
| GET | `/admin/privacy/visibility-grants` | 列 visibility grants |

### 12.6 Users
| Method | Path | Summary |
|---|---|---|
| GET | `/admin/users` | 列 end-users（filter by partial wallet） |
| GET | `/admin/users/:wallet` | 單一 wallet detail：accounts + counts |
| GET | `/admin/users/banned` | 列被 ban 的 wallets |
| POST | `/admin/users/:wallet/ban` | Superadmin ban wallet（body echo `confirmTargetId`） |
| POST | `/admin/users/:wallet/unban` | Superadmin unban |

### 12.7 Creators
| Method | Path | Summary |
|---|---|---|
| PATCH | `/admin/creators/:wallet/verified` | Operator 切 verified trust badge，body `{ verified: boolean }` |

---

## 13. 公開 / 基礎建設

| Controller | Method | Path | Summary |
|---|---|---|---|
| `health.controller.ts` | GET | `/health/live` | Liveness probe（純 process alive） |
| `health.controller.ts` | GET | `/health/ready` | Readiness probe：DB / RPC / MagicBlock / Umbra 平行檢查 |
| `metrics.controller.ts` | GET | `/metrics` | Prometheus exposition (text/plain) |
| `onchain-program.controller.ts` | GET | `/program/strategy-runtime/metadata` | Program metadata + 指令名 |
| `onchain-program.controller.ts` | GET | `/program/strategy-runtime/idl` | 內建 strategy_runtime IDL JSON |
| `onchain-program.controller.ts` | GET | `/program/strategy-runtime/instructions` | 指令 manifest（discriminators / accounts / args） |
| `onchain-program.controller.ts` | GET | `/program/strategy-runtime/pdas/deployments/:deploymentId` | Derive deployment / vault / state / snapshot PDAs |
| `telegram.controller.ts` | POST | `/telegram/webhook` | Telegram bot webhook（header `x-telegram-bot-api-secret-token` 驗 secret） |
| `root.controller.ts` | GET | `/` | Welcome 訊息 |
| `root.controller.ts` | GET | `/favicon.ico` | 204 No Content |
| `app.controller.ts` | GET | `/health` | 簡單 health check |

---

## 14. 14-cuts demo 對應

供前端規劃時對照：

| Cut | 對應端點 |
|---|---|
| 1, 2 — Studio dashboard | `POST /strategies` + `GET /creators/:wallet` |
| 3 — Workflow Canvas primitive library | `GET /agent/nodes` |
| 4 — Inspector 30d PnL preview | `GET /strategies/:id/pnl?days=30`（draft 自動回 synthetic preview，標 `isPreview: true`） |
| 5 — Publish flow | `POST /strategies/:id/publish` |
| 6 — Strategy Market | `GET /strategies/marketplace?sort=recent\|trending` |
| 7 — Wallet sign | `POST /auth/challenge` + `POST /auth/login` |
| 8 — Verified badge | Marketplace 回 `creatorVerified: boolean`；Admin 用 `PATCH /admin/creators/:wallet/verified` 切 |
| 9 — Strategy Detail | `GET /strategies/:id` + `publicDefinition.nodes[].redactedParameterKeys[]`（畫 🔒 用） |
| 10, 11 — Subscribe modal | `GET /deployments/:id/subscriptions/quote` → `POST /deployments/:id/subscriptions`（含 `riskPreset` / `autoRebalance` / `depositAmount`/`depositMint` 自動 bundle fund-intent） |
| 12 — Portfolio dashboard | `GET /subscriptions/me`（每筆帶 `onchainFootprint`）；`GET /:id/balance`；`GET /:id/pnl`；SSE `/:id/events` |
| 13 — Portfolio menu | `POST /:id/pause` / `/resume`；`GET /:id/withdraw-preview` → `POST /:id/withdraw-intent` |
| 14 — `Just Published` 標 | Marketplace `?sort=recent`，前端用 `updatedAt` 做 30 分內亮標 |

---

## 15. 啟動 + 開發提示

```bash
# 啟 backend（dev mode）
cd backend && pnpm install && pnpm run start:dev
# Swagger UI:  http://localhost:3000/api/docs
# Health:      http://localhost:3000/api/health/ready
```

- **Env**：拿 `backend/.env.example` 複製成 `.env`，至少要設 `SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`SOLANA_RPC_URL`、`STRATEGY_RUNTIME_PROGRAM_ID`
- **Swagger 是 source-of-truth**：後端 controller 上的 `@ApiOperation` / DTO `@ApiProperty` 改了 Swagger UI 會即時反映
- **生 client SDK**：可以用 `openapi-generator` 從 `/api/docs-json` 產 typed TS client；目前後端沒主動維護 client lib
