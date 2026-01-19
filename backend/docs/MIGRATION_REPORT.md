# PinTool Backend - 系統更新報告

**日期**: 2026-01-18  
**版本**: 2.0.0 (Crossmint Integration)

---

## 一、更新概述

本次更新將系統從自管私鑰架構遷移至 **Crossmint 託管錢包架構**，並新增多個 DeFi 功能節點。

### 主要變更

1. **錢包管理**: 從本地加密私鑰 → Crossmint 託管錢包
2. **Gas 費用**: 由 Crossmint 自動贊助 (Solana)
3. **節點擴展**: 新增 5 個 DeFi 節點
4. **程式碼清理**: 移除舊有加密服務和未使用的程式碼

---

## 二、Crossmint 整合

### 2.1 架構設計

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Workflow      │────▶│  CrossmintService │────▶│  Crossmint API  │
│   Executor      │     │                  │     │  (託管錢包)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ CrossmintWallet  │
                        │    Adapter       │
                        └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │   Workflow Nodes │
                        │ (Swap, Transfer) │
                        └──────────────────┘
```

### 2.2 核心檔案

| 檔案 | 功能 |
|------|------|
| `src/crossmint/crossmint.service.ts` | Crossmint API 封裝，錢包創建/獲取 |
| `src/crossmint/crossmint-wallet.adapter.ts` | 錢包適配器，實作簽名接口 |
| `src/crossmint/crossmint.module.ts` | NestJS 模組定義 |

### 2.3 API 規格

**創建錢包**
```typescript
POST https://staging.crossmint.com/api/2025-06-09/wallets
{
  "chainType": "solana",
  "type": "smart",
  "owner": "userId:{walletAddress}:solana:mpc:{index}"
}
```

**發送交易**
```typescript
POST /wallets/{locator}/transactions
{
  "params": {
    "transaction": "<base64 serialized transaction>"
  }
}
```

### 2.4 驗證結果

```
✅ Crossmint Connection Test - PASSED
   Environment: staging
   Wallet Created: Dn2xoMk71LZiJCY4L6iEn7W6e9rMRvCD5RJNKau8cATc
   Type: smart (Solana)
```

### 2.5 關鍵功能

| 功能 | 狀態 | 說明 |
|------|------|------|
| 創建錢包 | ✅ | `createWalletForUser()` |
| 獲取錢包 | ✅ | `getWalletForAccount()` |
| 簽名交易 | ✅ | `signTransaction()` |
| 發送交易 | ✅ | `signAndSendTransaction()` |
| Gas 贊助 | ✅ | Crossmint 自動處理 |

---

## 三、新增節點 (5 個)

### 3.1 DriftNode - 永續合約

**檔案**: `src/web3/nodes/drift.node.ts`

| 操作 | 說明 |
|------|------|
| `openLong` | 開多倉 |
| `openShort` | 開空倉 |
| `close` | 平倉 |
| `fundingRate` | 獲取資金費率 |

**支援市場**: SOL-PERP, BTC-PERP, ETH-PERP, JUP-PERP 等 30+ 市場

**API Key 需求**: 不需要 (錢包簽名認證)

---

### 3.2 LuloNode - 借貸協議

**檔案**: `src/web3/nodes/lulo.node.ts`

| 操作 | 說明 |
|------|------|
| `deposit` | 存款賺取利息 |
| `withdraw` | 提款 |
| `info` | 查詢帳戶資訊 |

**支援代幣**: USDC, SOL 等

**API Key 需求**: `LULO_API_KEY` (必需)

---

### 3.3 SanctumNode - LST 交換

**檔案**: `src/web3/nodes/sanctum.node.ts`

| 操作 | 說明 |
|------|------|
| `swap` | LST 交換 |
| `quote` | 獲取報價 |
| `apy` | 獲取 APY |

**支援 LST**: SOL, mSOL, bSOL, jitoSOL, jupSOL, INF, hSOL, stSOL 等 15+

**API Key 需求**: `SANCTUM_API_KEY` (必需)

---

### 3.4 StakeNode - SOL 質押

**檔案**: `src/web3/nodes/stake.node.ts`

| 操作 | 說明 |
|------|------|
| `stake` | SOL → jupSOL |
| `unstake` | jupSOL → SOL |
| `info` | 查詢質押資訊 |

**特點**:
- 使用 Jupiter Staking
- 自動複利
- 無鎖定期
- 最小質押: 0.1 SOL

**API Key 需求**: 不需要

---

### 3.5 HeliusWebhookNode - 事件監聽

**檔案**: `src/web3/nodes/helius-webhook.node.ts`

| 操作 | 說明 |
|------|------|
| `create` | 創建 Webhook |
| `get` | 獲取 Webhook 資訊 |
| `delete` | 刪除 Webhook |
| `list` | 列出所有 Webhooks |

**支援事件類型**: SWAP, TRANSFER, NFT_SALE, NFT_MINT, STAKE_TOKEN 等

**API Key 需求**: `HELIUS_API_KEY` (必需)

---

## 四、現有節點更新

### 4.1 SwapNode

**檔案**: `src/web3/nodes/swap.node.ts`

**變更**:
- 移除: 本地私鑰簽名邏輯
- 新增: 透過 `AgentKitService` 獲取 Crossmint 錢包
- 新增: 使用 `CrossmintWalletAdapter.signAndSendTransaction()`

**程式碼變更**:
```typescript
// 舊版
const keypair = await this.getKeypairFromEncryptedKey(account.encrypted_private_key);
const signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);

// 新版
const wallet = await agentKitService.getWalletForAccount(accountId);
const result = await wallet.signAndSendTransaction(transaction);
```

---

### 4.2 KaminoNode

**檔案**: `src/web3/nodes/kamino.node.ts`

**變更**:
- 移除: `EncryptionService` 依賴
- 新增: 透過 `CrossmintService` 獲取錢包
- 更新: `KaminoClient` 使用 `CrossmintWalletAdapter`

---

### 4.3 TransferNode

**檔案**: `src/web3/nodes/transfer.node.ts`

**變更**:
- 新增節點 (本次新增)
- 支援 SOL 和 SPL Token 轉帳
- 使用 Crossmint 錢包簽名

---

### 4.4 BalanceNode

**檔案**: `src/web3/nodes/balance.node.ts`

**變更**:
- 新增節點 (本次新增)
- 支援條件判斷 (>, <, =, >=, <=)
- 可用於 workflow 分支邏輯

---

### 4.5 LimitOrderNode

**檔案**: `src/web3/nodes/limit-order.node.ts`

**變更**:
- 新增節點 (本次新增)
- 使用 Jupiter Trigger API
- 支援限價買/賣

---

### 4.6 PriceFeedNode

**檔案**: `src/web3/nodes/price-feed.node.ts`

**變更**: 無 (不需要錢包操作)

---

## 五、移除的程式碼

### 5.1 移除的檔案

| 檔案/資料夾 | 原因 |
|-------------|------|
| `src/encryption/` | 不再需要本地加密 |
| `src/web3/services/payment-handler.service.ts` | X402 支付未使用 |
| `src/web3/services/payment-solana.service.ts` | X402 支付未使用 |
| `src/web3/types/faremeter.types.ts` | X402 類型未使用 |

### 5.2 移除的依賴

```json
// package.json
- "@faremeter/rides": "^0.13.0"
```

### 5.3 移除的配置

```typescript
// configuration.ts
- encryption: {
-   secret: process.env.ENCRYPTION_SECRET,
- }
```

---

## 六、資料庫變更

### 6.1 新增欄位

```sql
-- accounts 表
ALTER TABLE accounts 
  ADD COLUMN crossmint_wallet_locator VARCHAR(255),
  ADD COLUMN crossmint_wallet_address VARCHAR(64);
```

### 6.2 移除欄位 (待執行)

```sql
-- Migration: 20260118210000_remove_legacy_wallet_fields.sql
ALTER TABLE accounts 
  DROP COLUMN account_address,
  DROP COLUMN encrypted_private_key,
  DROP COLUMN encryption_method;
```

### 6.3 Migration 檔案

| 檔案 | 狀態 |
|------|------|
| `20260118125103_add_crossmint_wallet_fields.sql` | 已執行 |
| `20260118210000_remove_legacy_wallet_fields.sql` | 待執行 |

---

## 七、環境變數

### 7.1 必需

```bash
SUPABASE_URL=xxx
SUPABASE_SERVICE_KEY=xxx
JWT_SECRET=xxx
SOLANA_RPC_URL=xxx
CROSSMINT_SERVER_API_KEY=xxx
CROSSMINT_ENVIRONMENT=staging|production
```

### 7.2 可選 (依功能)

```bash
HELIUS_API_KEY=xxx        # HeliusWebhookNode
LULO_API_KEY=xxx          # LuloNode
SANCTUM_API_KEY=xxx       # SanctumNode
TELEGRAM_BOT_TOKEN=xxx    # Telegram 通知
```

---

## 八、節點總覽

### 8.1 完整節點列表 (11 個)

| 節點 | 類別 | API Key | 狀態 |
|------|------|---------|------|
| SwapNode | 交易 | 不需要 | 已更新 |
| LimitOrderNode | 交易 | 不需要 | 新增 |
| KaminoNode | 收益 | 不需要 | 已更新 |
| LuloNode | 收益 | LULO_API_KEY | 新增 |
| StakeNode | 收益 | 不需要 | 新增 |
| DriftNode | 衍生品 | 不需要 | 新增 |
| SanctumNode | LST | SANCTUM_API_KEY | 新增 |
| TransferNode | 工具 | 不需要 | 新增 |
| BalanceNode | 工具 | 不需要 | 新增 |
| PriceFeedNode | 工具 | 不需要 | 無變更 |
| HeliusWebhookNode | 自動化 | HELIUS_API_KEY | 新增 |

### 8.2 功能覆蓋

```
交易功能
├── 即時兌換 (SwapNode - Jupiter)
└── 限價單 (LimitOrderNode - Jupiter Trigger)

收益功能
├── Kamino Vaults (KaminoNode)
├── Lulo 借貸 (LuloNode)
└── Jupiter 質押 (StakeNode)

衍生品
└── Drift 永續合約 (DriftNode)

LST 管理
└── Sanctum LST 交換 (SanctumNode)

工具
├── 餘額查詢 (BalanceNode)
├── 代幣轉帳 (TransferNode)
└── 價格查詢 (PriceFeedNode)

自動化
└── 鏈上事件監聽 (HeliusWebhookNode)
```

---

## 九、驗證結果

### 9.1 編譯測試

```
✅ npm run build - PASSED
   webpack 5.97.1 compiled successfully
```

### 9.2 Crossmint 連接測試

```
✅ Wallet Creation - PASSED
✅ Wallet Retrieval - PASSED
✅ Transaction Signing - Ready
```

### 9.3 待驗證項目

| 項目 | 方法 |
|------|------|
| 實際交易簽名 | 執行 SwapNode 測試 |
| Gas 贊助 | 觀察交易費用來源 |
| Lulo 整合 | 需申請 API Key |
| Sanctum 整合 | 需申請 API Key |
| Helius 整合 | 需申請 API Key |

---

## 十、下一步建議

### 10.1 立即執行

1. 執行 Migration 移除舊欄位:
   ```bash
   supabase db push
   ```

2. 設定環境變數

3. 測試完整 workflow

### 10.2 後續優化

1. 新增 E2E 測試
2. 新增錯誤重試機制
3. 新增交易監控
4. 優化 Gas 估算

---

## 十一、檔案清單

### 新增檔案
- `src/web3/nodes/drift.node.ts`
- `src/web3/nodes/lulo.node.ts`
- `src/web3/nodes/sanctum.node.ts`
- `src/web3/nodes/stake.node.ts`
- `src/web3/nodes/helius-webhook.node.ts`
- `src/web3/nodes/transfer.node.ts`
- `src/web3/nodes/balance.node.ts`
- `src/web3/nodes/limit-order.node.ts`
- `src/crossmint/crossmint.service.ts`
- `src/crossmint/crossmint-wallet.adapter.ts`
- `src/crossmint/crossmint.module.ts`
- `scripts/test-crossmint.ts`
- `supabase/migrations/20260118210000_remove_legacy_wallet_fields.sql`
- `.env.example`

### 修改檔案
- `src/app.module.ts`
- `src/config/configuration.ts`
- `src/web3/constants.ts`
- `src/web3/nodes/swap.node.ts`
- `src/web3/nodes/kamino.node.ts`
- `src/web3/web3.module.ts`
- `src/database/schema/initial-1.sql`
- `package.json`

### 刪除檔案
- `src/encryption/encryption.service.ts`
- `src/encryption/encryption.module.ts`
- `src/web3/services/payment-handler.service.ts`
- `src/web3/services/payment-solana.service.ts`
- `src/web3/types/faremeter.types.ts`

---

**報告結束**

*此報告由系統自動生成於 2026-01-18*
