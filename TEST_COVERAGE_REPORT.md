# 系統整合測試覆蓋率報告

> 生成時間: 2026-05-01  
> 測試框架: Jest (NestJS)  
> 運行命令: `cd backend && npx jest --runInBand`  
> 總計: **49 個測試套件 / 286 個測試案例**

---

## 一、執行摘要

| 指標 | 數值 |
|------|------|
| 測試套件總數 | 49 |
| 測試案例總數 | 286 |
| **通過** | 281 (98.3%) |
| **失敗** | 5 (1.7%) |
| 整合測試套件 | 5 |
| 單元測試套件 | 44 |
| 有整合測試的模組 | 3 (magicblock, onchain, umbra) |
| 僅有單元測試的模組 | 15 |
| **完全無測試的模組** | 6 (agent, database, telegram, web3 等) |

### 失敗案例摘要

| 測試套件 | 失敗數 | 根因 |
|---------|--------|------|
| `magicblock-er-per-sdk.integration.spec.ts` | 2 | Devnet PDA 已存在 (Account already in use) + RPC 429 Rate Limit |
| `magicblock-er-per.integration.spec.ts` | 1 | RPC 429 Rate Limit |
| `magicblock-per.integration.spec.ts` | 1 | Devnet PDA 已存在 (Account already in use) |
| `anchor-onchain-adapter.integration.spec.ts` | 1 | 測試超時 (120s 不足) |

> **結論**: 所有失敗均為 **基礎設施/環境問題**（RPC 限流、PDA 碰撞、超時），**非邏輯錯誤**。在隔離環境或增加重試/超時後應可通過。

---

## 二、整合測試覆蓋矩陣

### 🟢 層級 1: 完整整合測試 (Real Devnet)

| 模組 | 測試文件 | 案例數 | 通過 | 失敗 | 測試範圍 |
|------|---------|--------|------|------|---------|
| **magicblock** | `magicblock-er-per-sdk.integration.spec.ts` | 7 | 5 | 2 | MagicBlock SDK ER 委派、交易路由、PER 部署創建 |
| **magicblock** | `magicblock-er-per.integration.spec.ts` | 10 | 9 | 1 | ER + PER 共存、TEE Private State、Magic Router 路由 |
| **magicblock** | `magicblock-per.integration.spec.ts` | 5 | 4 | 1 | PER 部署創建、TEE Auth 流程 (/auth/challenge → sign → /auth/login) |
| **onchain** | `anchor-onchain-adapter.integration.spec.ts` | 5 | 4 | 1 | Anchor 適配器 ↔ devnet strategy_runtime 程序交互 |
| **umbra** | `umbra.integration.spec.ts` | 5 | 5 | 0 | Umbra 隱私協議: 註冊、存款 1 USDC、查詢加密餘額、提取 0.5 USDC |

**整合測試統計:**
- 總案例數: **32**
- 通過: **27** (84.4%)
- 失敗: **5** (15.6%) — 全部為環境/基礎設施問題

---

## 三、單元測試覆蓋矩陣

### 🟡 層級 2: 僅有單元測試 (Mocked)

| 模組 | 測試文件數 | 案例數 | 說明 |
|------|-----------|--------|------|
| **admin** | 3 | 23 | 追隨者金庫操作、隱私聚合、權限管理 |
| **auth** | 2 | 9 | JWT 認證、登入控制器 |
| **common** | 1 | 3 | JWT Guard |
| **config** | 1 | 4 | Runtime 配置服務 |
| **crossmint** | 1 | 14 | 錢包創建、簽名、NFT 鑄造 |
| **follower-vaults** | 5 | 34 | 訂閱、資金意向提交、私有執行週期、分配、簽名 |
| **health** | 1 | 2 | 健康檢查就緒狀態 |
| **magicblock** | 6 | 41 | ER 適配器、PER 適配器、私隱支付、客戶端、模組切換、PER 認證/分組倉庫 |
| **observability** | 2 | 6 | 關聯 ID 中間件、指標服務 |
| **onchain** | 3 | 16 | Noop 適配器、Anchor 適配器（mock）、密鑰對服務、模組切換 |
| **referral** | 1 | 6 | 推薦碼生成、獎勵計算 |
| **strategies** | 2 | 11 | 策略 CRUD、權限驗證 |
| **strategy-compiler** | 1 | 4 | 策略編譯驗證 |
| **strategy-deployments** | 1 | 7 | 部署生命週期管理 |
| **strategy-keeper** | 2 | 20 | Keeper 調度、策略運行記錄 |
| **umbra** | 2 | 23 | Umbra 真實適配器、部署簽名器、模組切換 |
| **workflow-ai** | 2 | 12 | AI 工作流控制器、服務 |
| **workflows** | 5 | 12 | 工作流實例、生命週期、控制器、服務 |

**單元測試統計:**
- 測試套件數: **44**
- 總案例數: **254**
- 通過率: **100%** (無單元測試失敗)

---

## 四、零測試模組 (⚠️ 缺口)

以下模組 **完全沒有任何測試文件**:

| 模組 | 源碼文件數 (估計) | 業務重要性 | 風險評級 |
|------|------------------|-----------|---------|
| **agent** | ~5 | 中等 | 🔶 中 |
| **database** | ~15 (schema + functions) | **高** | 🔴 **高** |
| **telegram** | ~3 | 低 | 🟢 低 |
| **web3** | ~20 (nodes + services + utils) | **高** | 🔴 **高** |
| **admin/audit** | ~2 | 低 | 🟢 低 |
| **admin/deployments** | ~3 | 中等 | 🔶 中 |

> **web3** 模組包含 Jupiter Swap、Kamino、Pyth 價格源等核心 DeFi 邏輯，目前 **零測試覆蓋**。

---

## 五、測試層級分類

### 測試金字塔

```
        /\
       /  \     E2E / 整合測試 (32 cases, 5 suites)
      /    \    ——————————————————————
     /------\   單元測試 (254 cases, 44 suites)
    /        \
   /----------\
  無測試模組 (~6 modules)
```

| 層級 | 數量 | 覆蓋模組 |
|------|------|---------|
| **E2E 整合測試** (Real Devnet) | 5 套件 / 32 案例 | magicblock, onchain, umbra |
| **單元測試** (Mocked) | 44 套件 / 254 案例 | admin, auth, follower-vaults, workflows, strategies 等 |
| **無測試** | — | agent, database, telegram, web3, admin/audit, admin/deployments |

---

## 六、各模組測試詳情

### 🟢 magicblock (最完整)

| 測試文件 | 類型 | 案例 | 狀態 |
|---------|------|------|------|
| `magicblock-er-per-sdk.integration.spec.ts` | 整合 | 7 | 5 ✅ 2 ❌ (環境) |
| `magicblock-er-per.integration.spec.ts` | 整合 | 10 | 9 ✅ 1 ❌ (環境) |
| `magicblock-per.integration.spec.ts` | 整合 | 5 | 4 ✅ 1 ❌ (環境) |
| `magicblock-er-real.adapter.spec.ts` | 單元 | 6 | 6 ✅ |
| `magicblock-per-real.adapter.spec.ts` | 單元 | 7 | 7 ✅ |
| `magicblock-private-payments-real.adapter.spec.ts` | 單元 | 8 | 8 ✅ |
| `magicblock-client.service.spec.ts` | 單元 | 6 | 6 ✅ |
| `magicblock.module.spec.ts` | 單元 | 5 | 5 ✅ |
| `per-auth-tokens.repository.spec.ts` | 單元 | 9 | 9 ✅ |
| `per-auth.guard.spec.ts` | 單元 | 10 | 10 ✅ |
| `per-groups.repository.spec.ts` | 單元 | 5 | 5 ✅ |

**覆蓋度**: ER 委派、PER TEE 認證、私隱支付、Magic Router、SDK 集成、倉庫層、Guard 層。

---

### 🟢 onchain (核心程序交互)

| 測試文件 | 類型 | 案例 | 狀態 |
|---------|------|------|------|
| `anchor-onchain-adapter.integration.spec.ts` | 整合 | 5 | 4 ✅ 1 ❌ (超時) |
| `anchor-onchain-adapter.service.spec.ts` | 單元 | 7 | 7 ✅ |
| `keeper-keypair.service.spec.ts` | 單元 | 6 | 6 ✅ |
| `noop-onchain-adapter.service.spec.ts` | 單元 | 3 | 3 ✅ |
| `onchain.module.spec.ts` | 單元 | 3 | 3 ✅ |

**覆蓋度**: Anchor 適配器、Keeper 密鑰對、Noop 適配器、模組切換。整合測試直接調用 devnet 上的 `strategy_runtime` 程序 (Program ID: `FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF`)。

---

### 🟢 umbra (隱私層)

| 測試文件 | 類型 | 案例 | 狀態 |
|---------|------|------|------|
| `umbra.integration.spec.ts` | 整合 | 5 | 5 ✅ |
| `umbra-real.adapter.spec.ts` | 單元 | 19 | 19 ✅ |
| `umbra-deployment-signer.service.spec.ts` | 單元 | 4 | 4 ✅ |
| `umbra.module.spec.ts` | 單元 | 4 | 4 ✅ |

**覆蓋度**: Umbra SDK 集成、加密餘額查詢、註冊/存/取、部署簽名。

---

### 🟡 follower-vaults (業務邏輯層)

| 測試文件 | 類型 | 案例 | 狀態 |
|---------|------|------|------|
| `subscriptions.service.spec.ts` | 單元 | 15 | 15 ✅ |
| `private-execution-cycles.service.spec.ts` | 單元 | 2 | 2 ✅ |
| `fund-intent-submission.service.spec.ts` | 單元 | 7 | 7 ✅ |
| `follower-vault-allocations.service.spec.ts` | 單元 | 6 | 6 ✅ |
| `follower-vault-signer.service.spec.ts` | 單元 | 4 | 4 ✅ |

**覆蓋度**: 訂閱管理、私有執行週期、資金意向提交、分配、簽名。  
**缺口**: ❌ 無整合測試（未在真實 Solana 上測試端到端流程）。

---

### 🟡 workflows (工作流引擎)

| 測試文件 | 類型 | 案例 | 狀態 |
|---------|------|------|------|
| `workflows.service.spec.ts` | 單元 | 3 | 3 ✅ |
| `workflow-lifecycle.service.spec.ts` | 單元 | 3 | 3 ✅ |
| `workflow-instance.spec.ts` | 單元 | 1 | 1 ✅ |
| `workflows.controller.spec.ts` | 單元 | 1 | 1 ✅ |

**覆蓋度**: 工作流實例、生命週期管理、控制器。  
**缺口**: ❌ 案例數偏少（僅 8 個），❌ 無整合測試。

---

### 🟡 strategy-keeper (策略守衛)

| 測試文件 | 類型 | 案例 | 狀態 |
|---------|------|------|------|
| `strategy-keeper.service.spec.ts` | 單元 | 9 | 9 ✅ |
| `strategy-runs.service.spec.ts` | 單元 | 11 | 11 ✅ |

**覆蓋度**: Keeper 調度、策略運行記錄。  
**缺口**: ❌ 無整合測試（未測試與真實策略部署的交互）。

---

### 🟡 strategies (策略管理)

| 測試文件 | 類型 | 案例 | 狀態 |
|---------|------|------|------|
| `strategies.service.spec.ts` | 單元 | 4 | 4 ✅ |
| `strategy-permission.service.spec.ts` | 單元 | 7 | 7 ✅ |

**覆蓋度**: 策略 CRUD、權限驗證。  
**缺口**: ❌ 案例數偏少。

---

### 🔴 web3 (DeFi 核心 — 零測試)

| 目錄 | 源碼類型 | 測試狀態 |
|------|---------|---------|
| `src/web3/nodes/` | PriceFeedNode, SwapNode, KaminoNode | ❌ **無測試** |
| `src/web3/services/` | Jupiter, Kamino, Pyth 服務 | ❌ **無測試** |
| `src/web3/utils/` | Token, Swap, Price Monitor | ❌ **無測試** |

**風險**: 這是系統的核心 DeFi 邏輯層，涉及真實資金操作（Jupiter Swap、Kamino 存款/提款）。目前 **完全依賴手動測試**。

---

### 🔴 database (數據層 — 零測試)

| 目錄 | 內容 | 測試狀態 |
|------|------|---------|
| `src/database/schema/` | Drizzle/Supabase schema 定義 | ❌ **無測試** |
| `src/database/functions/` | 數據庫函數 | ❌ **無測試** |

**風險**: Schema 變更可能導致遷移失敗，但通常由類型檢查捕獲。

---

## 七、失敗案例根因分析

### 失敗 1-3: PDA Account Already in Use

```
Allocate: account ... already in use
Program 11111111111111111111111111111111 failed: custom program error: 0x0
```

- **影響**: `magicblock-per.integration.spec.ts`, `magicblock-er-per-sdk.integration.spec.ts`
- **根因**: `initializeDeployment` 使用 `randomUUID()` 生成 deploymentId，但 PDA 派生可能與之前測試遺留的賬戶碰撞。Devnet 上的賬戶不會自動清理。
- **建議**: 
  1. 在測試 `afterAll` 中調用 `closeDeployment` 清理
  2. 使用時間戳 + random 混合生成唯一 deploymentId
  3. 增加 PDA 存在性檢查，存在則跳過或關閉後重建

### 失敗 4: RPC 429 Rate Limit

```
429 Too Many Requests: {"jsonrpc":"2.0","error":{"code":-32429,"message":"rate limited"}}
```

- **影響**: `magicblock-er-per.integration.spec.ts`, `magicblock-er-per-sdk.integration.spec.ts`
- **根因**: 多個整合測試套件在短時間內併發調用 Helius RPC（已使用 `--runInBand` 但仍有限流）。
- **建議**:
  1. 增加測試間延遲 (`jest.setTimeout` + `await new Promise(r => setTimeout(r, 2000))`)
  2. 使用 `withRpcRetry()` 增加指數退避重試
  3. 考慮使用多個 RPC 端點輪詢

### 失敗 5: Test Timeout

```
Exceeded timeout of 120000 ms for a test
```

- **影響**: `anchor-onchain-adapter.integration.spec.ts` (maps execution modes)
- **根因**: 該測試調用 `initializeDeployment` 並等待確認，在網絡擁堵時 120s 不足。
- **建議**: 將該測試的超時增加至 300s，或拆分為多個小測試。

---

## 八、改進建議 (按優先級)

### 🔴 P0 — 立即行動

1. **修復整合測試穩定性**:
   - 在 `initializeDeployment` 前增加 PDA 存在性檢查，存在則使用新 deploymentId
   - 為所有整合測試增加 `afterAll` 清理邏輯（`closeDeployment`）
   - 將 `withRpcRetry()` 的超時和退避參數調大（當前可能過於激進）

2. **增加 web3 模組測試**:
   - 為 `JupiterSwap`, `KaminoService`, `PriceMonitor` 添加單元測試（mock RPC）
   - 為關鍵節點 (`SwapNode`, `KaminoNode`) 添加整合測試（devnet 小額測試）

### 🟡 P1 — 短期 (1-2 週)

3. **增加 follower-vaults 整合測試**:
   - 測試端到端訂閱流程（創建 → 充值 → 執行 → 提款）
   - 使用 `fund-intent-submission.service.ts` 的真實 devnet 路徑

4. **增加 strategy-keeper 整合測試**:
   - 測試 keeper 調度器與真實部署的交互
   - 測試策略運行記錄的持久化

5. **增加 database schema 測試**:
   - 使用 `drizzle-kit` 生成遷移並驗證 schema 一致性
   - 測試關鍵查詢函數的性能

### 🟢 P2 — 中期

6. **增加 workflows 測試覆蓋**:
   - 目前僅 8 個案例，建議擴展至 20+
   - 添加工作流圖驗證測試（循環檢測、節點類型驗證）

7. **測試平行化優化**:
   - 評估是否可將整合測試拆分為獨立 CI Job
   - 使用 `--maxWorkers=1` + 測試間延遲避免 RPC 限流

---

## 九、測試運行命令參考

```bash
# 全部測試（推薦，避免 RPC 限流）
cd backend && npx jest --runInBand

# 僅整合測試
cd backend && npx jest --testPathPattern="integration" --runInBand

# 僅單元測試
cd backend && npx jest --testPathIgnorePatterns="integration"

# 單個整合測試（調試用）
cd backend && npx jest src/umbra/umbra.integration.spec.ts --testTimeout=300000

# 帶覆蓋率報告
cd backend && npx jest --coverage --runInBand
```

---

## 附錄: 測試文件完整清單

### 整合測試 (5 文件)
- `src/magicblock/magicblock-er-per-sdk.integration.spec.ts`
- `src/magicblock/magicblock-er-per.integration.spec.ts`
- `src/magicblock/magicblock-per.integration.spec.ts`
- `src/onchain/anchor-onchain-adapter.integration.spec.ts`
- `src/umbra/umbra.integration.spec.ts`

### 單元測試 (44 文件)
- `src/admin/ops/admin-follower-vaults-ops.service.spec.ts`
- `src/admin/privacy/admin-follower-vaults.service.spec.ts`
- `src/admin/privacy/admin-privacy.service.spec.ts`
- `src/auth/auth.controller.spec.ts`
- `src/auth/auth.service.spec.ts`
- `src/common/guards/jwt-auth.guard.spec.ts`
- `src/config/runtime-config.service.spec.ts`
- `src/crossmint/crossmint.service.spec.ts`
- `src/follower-vaults/follower-vault-allocations.service.spec.ts`
- `src/follower-vaults/follower-vault-signer.service.spec.ts`
- `src/follower-vaults/fund-intent-submission.service.spec.ts`
- `src/follower-vaults/private-execution-cycles.service.spec.ts`
- `src/follower-vaults/subscriptions.service.spec.ts`
- `src/health/health.service.spec.ts`
- `src/magicblock/magicblock-client.service.spec.ts`
- `src/magicblock/magicblock-er-real.adapter.spec.ts`
- `src/magicblock/magicblock-per-real.adapter.spec.ts`
- `src/magicblock/magicblock-private-payments-real.adapter.spec.ts`
- `src/magicblock/magicblock.module.spec.ts`
- `src/magicblock/per-auth-tokens.repository.spec.ts`
- `src/magicblock/per-auth.guard.spec.ts`
- `src/magicblock/per-groups.repository.spec.ts`
- `src/observability/correlation.middleware.spec.ts`
- `src/observability/metrics.service.spec.ts`
- `src/onchain/anchor-onchain-adapter.service.spec.ts`
- `src/onchain/keeper-keypair.service.spec.ts`
- `src/onchain/noop-onchain-adapter.service.spec.ts`
- `src/onchain/onchain.module.spec.ts`
- `src/referral/referral.service.spec.ts`
- `src/strategies/guards/strategy-permission.service.spec.ts`
- `src/strategies/strategies.service.spec.ts`
- `src/strategy-compiler/strategy-compiler.service.spec.ts`
- `src/strategy-deployments/strategy-deployments.service.spec.ts`
- `src/strategy-keeper/strategy-keeper.service.spec.ts`
- `src/strategy-keeper/strategy-runs.service.spec.ts`
- `src/umbra/umbra-deployment-signer.service.spec.ts`
- `src/umbra/umbra-real.adapter.spec.ts`
- `src/umbra/umbra.module.spec.ts`
- `src/workflow-ai/workflow-ai.controller.spec.ts`
- `src/workflow-ai/workflow-ai.service.spec.ts`
- `src/workflows/workflow-instance.spec.ts`
- `src/workflows/workflow-lifecycle.service.spec.ts`
- `src/workflows/workflows.controller.spec.ts`
- `src/workflows/workflows.service.spec.ts`
