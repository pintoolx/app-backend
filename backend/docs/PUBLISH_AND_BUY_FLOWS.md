# Publish & Buy 整合指南

> **目的**：給前端一份照表組裝的對照文件，讓 publish strategy + 買 strategy 兩條主流程的 wallet 互動寫對。
> **重點先講**：兩條 flow 都有 on-chain tx，但**誰簽什麼**完全不同。Publish 大多後端代簽；買 strategy 都要前端錢包簽。

---

## 0. TL;DR — 4 條 Flow × On-chain × 誰簽

| Flow | 場景 | On-chain 步驟 | 誰簽 |
|---|---|---|---|
| **A. Creator publish + deploy** | Creator 把 strategy 上 marketplace + 真正開戶上鏈 | `initialize_deployment` 等 4 個 PDA | **後端 keeper** |
| **B. Creator-level 月費訂閱** | Subscriber 付月費解鎖該 creator **全部** strategies | 原生 SOL `SystemProgram.transfer`（lamports） | **Subscriber wallet** |
| **C. Per-strategy 一次性買斷** | Subscriber 買單一 strategy（永久解鎖那一支）| 原生 SOL `SystemProgram.transfer`（lamports） | **Buyer wallet** |
| **D. 跟單入金訂閱** | Subscriber 真的丟錢進 vault 跟著 strategy 操作 | 多步混合：開戶 + 入金（任意 SPL）+ shield | **Keeper + Follower wallet 混合** |

> 沒有任何 endpoint 會「強迫前端錢包簽 strategy_runtime program 指令」——所有 strategy_runtime 上鏈動作都是後端 keeper 代簽。前端錢包：B/C 簽**原生 SOL transfer**；D fund 簽**SPL transfer 進 vault**。
>
> **重要**：所有金額欄位（`monthlyPriceAmount`、`priceAmount`、`amount`）都是 **lamports**（1 SOL = 1_000_000_000）。前端顯示時記得除 1e9。

---

## 1. Flow A — Creator publish + deploy

### Sequence
```
[creator] ─▶ POST /strategies                   (純 DB，建草稿)
         ─▶ POST /strategies/:id/publish        (純 DB，draft → published)
         ─▶ POST /strategies/:id/deploy         (✅ 後端 keeper 簽 4 PDA)
```

### Step 1 — 建草稿 strategy
```http
POST /strategies
Authorization: Bearer <creator_jwt>
Content-Type: application/json

{
  "name": "DCA SOL daily",
  "description": "Buy SOL whenever price drops 2%",
  "definition": { /* WorkflowDefinition: nodes + connections */ },
  "visibilityMode": "private"
}
```
**回應**：`{ success: true, data: StrategyView }`，`lifecycleState = 'draft'`，**沒上鏈**。

### Step 2 — Publish 到 marketplace
```http
POST /strategies/:id/publish
Authorization: Bearer <creator_jwt>
```
**回應**：`StrategyView`，`lifecycleState = 'published'` + `currentVersion` +1。**沒上鏈**——只是改 DB 讓 marketplace 看得見。

### Step 3 — Deploy 真上鏈
```http
POST /strategies/:id/deploy
Authorization: Bearer <creator_jwt>
Content-Type: application/json

{
  "accountId": "<existing crossmint vault account uuid>",
  "executionMode": "offchain",        // optional, 預設讀 compiled IR
  "treasuryMode": "public",           // optional, 預設讀 compiled IR
  "metadata": {}                      // optional
}
```
**回應**：`{ success: true, data: DeploymentView }`，包含 `deploymentId / vaultAuthorityAccount / strategyStateAccount / publicSnapshotAccount` 真實 PDA。

**Creator 完全不需要簽錢包**——後端用 `STRATEGY_RUNTIME_KEEPER_SECRET` keypair 自簽：
- `initializeStrategyVersion`
- `initializeDeployment`
- `initializeVaultAuthority`
- `initializeStrategyState`
- `setLifecycleStatus(deployed)`

---

## 2. Flow B — Creator-level 月費訂閱

> 一次訂閱解鎖該 creator **所有** published strategies。月費**原生 SOL**，30 天到期需重訂。

### Pre-req（creator 端先設好）
```http
PATCH /creator-subscriptions/plan
Authorization: Bearer <creator_jwt>

{ "monthlyPriceAmount": "100000000",   // 0.1 SOL (lamports)
  "payoutWallet": "<creator_payout_wallet>",
  "metadata": {} }
```

### Sequence
```
[subscriber] ─▶ POST /creator-subscriptions/creators/:wallet/intent     (DB + 組 unsigned tx)
            ─▶ wallet.signAndSendTransaction(tx)                         (✅ 錢包簽原生 SOL transfer)
            ─▶ POST /creator-subscriptions/creators/:wallet/confirm-payment  (後端 RPC verify)
```

### Step 1 — 拿 unsigned payment intent
```http
POST /creator-subscriptions/creators/:creatorWallet/intent
Authorization: Bearer <subscriber_jwt>
```
**回應**：
```json
{
  "success": true,
  "data": {
    "subscription": { "id": "...", "status": "payment_required", "planPriceAmount": "100000000", ... },
    "paymentIntent": {
      "subscriptionId": "...",
      "creatorWallet": "...",
      "subscriberWallet": "...",
      "amount": "100000000",
      "payoutWallet": "...",
      "billingPeriodDays": 30,
      "onchainPayment": {
        "transactionBase64": "<base64-encoded unsigned SystemProgram.transfer Tx>",
        "recentBlockhash": "...",
        "lastValidBlockHeight": 12345,
        "feePayer": "<subscriber_wallet>"
      }
    }
  }
}
```

### Step 2 — 前端簽並送出
```typescript
import { Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

const tx = Transaction.from(Buffer.from(paymentIntent.onchainPayment.transactionBase64, 'base64'));
const signedTx = await wallet.signTransaction(tx);          // Phantom / wallet adapter
const txSignature = await connection.sendRawTransaction(signedTx.serialize());
await connection.confirmTransaction(txSignature, 'confirmed');
```

### Step 3 — Confirm 給後端
```http
POST /creator-subscriptions/creators/:creatorWallet/confirm-payment
Authorization: Bearer <subscriber_jwt>

{ "txSignature": "<signature from step 2>" }
```
後端 RPC `getParsedTransaction(sig)` 驗 mint + amount + payout 都對才寫入 DB，subscription 變 `active`，`currentPeriodEnd = now + 30d`。

---

## 3. Flow C — Per-strategy 一次性買斷

> 跟 Flow B 同一個 SOL transfer pattern，但解鎖**單一 strategy**（永久，不到期）。
> 與月費**併存**——有任一即可看 private definition。

### Pre-req（creator 端標價）
```http
PATCH /strategies/:id/purchase-price
Authorization: Bearer <creator_jwt>

{ "priceAmount": "500000000" }        // 0.5 SOL (lamports)
// 傳 { "priceAmount": null } 下架
```

### Sequence
```
[buyer] ─▶ GET /strategies/:id/purchase-quote     (純 DB，公開可拿)
       ─▶ POST /strategies/:id/purchase-intent    (DB + 組 unsigned tx)
       ─▶ wallet.signAndSendTransaction(tx)        (✅ 錢包簽原生 SOL transfer)
       ─▶ POST /strategies/:id/purchase-confirm   (後端 RPC verify + 寫入)
```

### Step 1 — 拿價格（前端 detail 頁顯示用）
```http
GET /strategies/:id/purchase-quote?wallet=<buyer_wallet>
```
**回應**：
```json
{
  "data": {
    "strategyId": "...",
    "priceAmount": "500000000",
    "payoutWallet": "<creator_payout_wallet>",
    "alreadyOwned": false
  }
}
```

### Step 2 — 拿 unsigned tx
```http
POST /strategies/:id/purchase-intent
Authorization: Bearer <buyer_jwt>
```
**回應**：
```json
{
  "data": {
    "strategyId": "...",
    "priceAmount": "500000000",
    "payoutWallet": "<payout>",
    "onchainPayment": {
      "transactionBase64": "<base64-encoded unsigned SystemProgram.transfer Tx>",
      "recentBlockhash": "...",
      "lastValidBlockHeight": 12345,
      "feePayer": "<buyer_wallet>"
    }
  }
}
```

### Step 3 — 前端簽 + send（同 Flow B Step 2）

### Step 4 — Confirm
```http
POST /strategies/:id/purchase-confirm
Authorization: Bearer <buyer_jwt>

{ "txSignature": "<sig>" }
```
寫入 `strategy_purchases` 表（`payment_tx_signature` UNIQUE 防重複）。買家現在叫 `GET /strategies/:id` 會拿到 private view。

---

## 4. Flow D — 跟單入金訂閱（最複雜，Cut 10/11/12 demo flow）

> 這條才是真的「丟錢進 vault 自動跟著 strategy 動作」。
> 混合三種簽法：**後端 keeper 開戶 → 前端錢包簽入金 → 後端 keeper shield**。

### Sequence
```
[follower] ─▶ GET  /deployments/:id/subscriptions/quote                   (純 DB pre-flight)
          ─▶ POST /deployments/:id/subscriptions                          (✅ keeper 開 3 PDAs，會卡幾秒)
          ─▶ (poll status to provisioning_complete)
          ─▶ POST /deployments/:id/subscriptions/:sId/fund-intent          (組 unsigned 入金 tx)
          ─▶ wallet.signTransaction(tx)                                    (✅ follower 錢包簽)
          ─▶ POST /deployments/:id/subscriptions/:sId/submit-fund-intent   (後端 broadcast)
          ─▶ POST /deployments/:id/subscriptions/:sId/shield               (✅ keeper Umbra shield)
          ─▶ subscription.status = 'active'  ✓
```

### Step 1 — Quote（subscribe modal pre-flight）
```http
GET /deployments/:deploymentId/subscriptions/quote?amount=1000000&mint=<USDC_MINT>&riskPreset=moderate
Authorization: Bearer <follower_jwt>
```
**回應**：
```json
{
  "data": {
    "depositAmount": "1000000",
    "mint": "<USDC_MINT>",
    "netDepositAfterFees": "1000000",
    "fees": {
      "platformFeeBps": 0,
      "platformFeeAmount": "0",
      "creatorFeeBps": 0,
      "creatorFeeAmount": "0",
      "estimatedNetworkFeeLamports": 5000
    },
    "vaultAuthorityPdaPreview": "<pre-derived PDA>",
    "followerVaultPdaPreview": "<pre-derived PDA>",
    "subscriptionPdaPreview": "<pre-derived PDA>",
    "riskPreset": "moderate",
    "maxDrawdownBps": 1500
  }
}
```

### Step 2 — 建訂閱（後端 keeper 跑 provisioning state machine）
```http
POST /deployments/:deploymentId/subscriptions
Authorization: Bearer <follower_jwt>

{
  "riskPreset": "moderate",        // optional, → 對應 maxDrawdownBps 自動填
  "autoRebalance": true,           // optional
  "maxCapital": "10000000",        // optional cap
  "depositAmount": "1000000",      // ⚡ 給了的話 response 自動 bundle fund-intent
  "depositMint": "<USDC_MINT>"
}
```
**這支 endpoint 會卡幾秒**——後端同步呼叫 4 個 anchor instruction（keeper 簽）：
1. `initializeFollowerSubscription` → state `subscription_initialized`
2. `initializeFollowerVault` → state `vault_initialized`
3. `initializeFollowerVaultAuthority` → state `vault_authority_initialized`
4. Umbra register + PER 加入 → state `provisioning_complete`

**回應**：
```json
{
  "data": {
    "id": "<subscriptionId>",
    "status": "pending_funding",
    "provisioningState": "provisioning_complete",
    "subscriptionPda": "...",
    "followerVaultPda": "...",
    "vaultAuthorityPda": "...",
    "onchainFootprint": {
      "programId": "FBh8…vkF",
      "subscriptionPda": "...",
      "followerVaultPda": "...",
      "vaultAuthorityPda": "...",
      "provisioningComplete": true,
      "driftDetected": false
    },
    "fundIntentInstruction": {     // ← 因為 step 2 帶了 depositAmount
      "instructionBase64": "<base64>",
      "recentBlockhash": "...",
      "vaultTokenAccount": "<vault_USDC_ATA>",
      "mint": "<USDC_MINT>",
      "amount": "1000000"
    }
  }
}
```

> **⚠️ 如果 `provisioningState === 'provisioning_failed'`**：response 還會帶 `provisioningError`，叫 `POST /:subId/resume-provisioning` 從中斷點續做。

### Step 3 — 拿入金 instruction（如果 step 2 沒帶 depositAmount 才需要）
```http
POST /deployments/:deploymentId/subscriptions/:subscriptionId/fund-intent
Authorization: Bearer <follower_jwt>

{ "mint": "<USDC_MINT>", "amount": "1000000" }
```
回應裡的 `instruction.instructionBase64` 是 SPL transfer 指令，要包成 v0 transaction 後簽。

### Step 4 — 前端錢包簽 + 送
```typescript
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

// fundIntentInstruction.instructionBase64 是 JSON-encoded TransactionInstruction
const payload = JSON.parse(Buffer.from(instructionBase64, 'base64').toString('utf-8'));
const ix = new TransactionInstruction({
  programId: new PublicKey(payload.programId),
  keys: payload.keys.map((k: any) => ({
    pubkey: new PublicKey(k.pubkey),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  })),
  data: Buffer.from(payload.data, 'base64'),
});

const message = new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash: recentBlockhash,
  instructions: [ix],
}).compileToV0Message();

const tx = new VersionedTransaction(message);
const signedTx = await wallet.signTransaction(tx);
const signedTxBase64 = Buffer.from(signedTx.serialize()).toString('base64');
```

### Step 5 — 把簽好的 tx 送回後端 broadcast
```http
POST /deployments/:deploymentId/subscriptions/:subscriptionId/submit-fund-intent
Authorization: Bearer <follower_jwt>

{ "signedTxBase64": "<base64>" }
```

### Step 6 — Shield（後端 Umbra 處理，subscription 變 active）
```http
POST /deployments/:deploymentId/subscriptions/:subscriptionId/shield
Authorization: Bearer <follower_jwt>

{ "mint": "<USDC_MINT>", "amount": "1000000" }
```
**回應**：包含 `queueSignature` / `callbackSignature`。完成後 `status` 變 `active`，可以開始接 strategy cycle。

---

## 5. 前端 wallet 簽 tx code snippet 速查

### Pattern A — 簽完整 base64 Transaction（Flow B、C、D 都會用到）
```typescript
import { Transaction } from '@solana/web3.js';

const tx = Transaction.from(Buffer.from(transactionBase64, 'base64'));
const signed = await wallet.signTransaction(tx);
const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
await connection.confirmTransaction(sig, 'confirmed');
return sig;     // 回傳給 confirm-payment / confirm-purchase
```

### Pattern B — 簽 instruction（Flow D fund-intent 拿到的是 instruction，不是完整 tx）
```typescript
// 從 backend response 還原 TransactionInstruction
const payload = JSON.parse(Buffer.from(instructionBase64, 'base64').toString('utf-8'));
const ix = new TransactionInstruction({
  programId: new PublicKey(payload.programId),
  keys: payload.keys.map((k: any) => ({
    pubkey: new PublicKey(k.pubkey),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  })),
  data: Buffer.from(payload.data, 'base64'),
});

const { blockhash } = await connection.getLatestBlockhash('confirmed');
const message = new TransactionMessage({
  payerKey: wallet.publicKey,
  recentBlockhash: blockhash,
  instructions: [ix],
}).compileToV0Message();

const tx = new VersionedTransaction(message);
const signed = await wallet.signTransaction(tx);
return Buffer.from(signed.serialize()).toString('base64');   // 給 submit-fund-intent
```

### Pattern C — Polling provisioning_complete（Flow D step 2 之後）
```typescript
async function waitForProvisioning(deploymentId: string, subscriptionId: string, jwt: string) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(
      `${API}/deployments/${deploymentId}/subscriptions/${subscriptionId}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );
    const { data } = await r.json();
    if (data.provisioningState === 'provisioning_complete') return data;
    if (data.provisioningState === 'provisioning_failed') throw new Error(data.provisioningError);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Provisioning timeout');
}
```

> 大多時候 step 2 同步就完成了（response 直接帶 `provisioning_complete`），polling 是 fallback。

---

## 6. 常見 4xx 錯誤與處理

| Endpoint | Status | 訊息關鍵字 | 怎麼救 |
|---|---|---|---|
| `POST /strategies/:id/publish` | 400 | `compiled IR is missing` | 先 `POST /strategies/:id/compile` |
| `POST /strategies/:id/deploy` | 400 | `Strategy is not published` | 先 publish |
| `POST /creator-subscriptions/.../confirm-payment` | 400 | `Payment transaction has already been used` | 同 signature 不能重複 confirm，DB 已有 |
| `POST /creator-subscriptions/.../confirm-payment` | 400 | `Payment transaction not found or not confirmed` | 等 tx confirmed 再 retry |
| `POST /strategies/:id/purchase-confirm` | 400 | `Strategy already purchased by this wallet` | 已買過，不用重買 |
| `POST /deployments/:id/subscriptions` | 400 | `Follower already has a subscription for this deployment` | 用 `GET /deployments/:id/subscriptions/:subId` 取既有 |
| `POST /:subId/fund-intent` | 400 | `Subscription must be pending_funding or active` | 訂閱狀態不對，可能已 closed |
| `POST /:subId/withdraw-intent` | 400 | `Cannot withdraw in status …` | 必須在 active/paused/exiting |
| `POST /:subId/withdraw-intent` | 400 | `Requested amount exceeds vault balance` | 先 `GET /:subId/withdraw-preview` 看 availableAmount |

---

## 7. 常見坑

1. **「Publish 完了為什麼 marketplace 上看到但跟單失敗？」**
   - Publish 只更 DB，**沒有 deploy**。要再叫 `POST /strategies/:id/deploy` 真上鏈才能跟單。
   - Publish 是 marketplace 可見，Deploy 是 vault 可開。兩件事。

2. **「Subscribe modal 為什麼會卡幾秒？」**
   - `POST /deployments/:id/subscriptions` 同步跑 provisioning state machine（4 個 anchor 指令連簽）
   - 正常 5-15 秒；UI 應該顯示 spinner + 訊息「Setting up your private vault on-chain…」

3. **「Provisioning 失敗了，subscription row 卻已經建好」**
   - 對。`provisioning_state = 'provisioning_failed'`，PDA 都還沒 init 完
   - **不要重新 POST**——叫 `POST /:subId/resume-provisioning` 從中斷點接

4. **「fund-intent 拿到的不是完整 transaction」**
   - 對，是 `TransactionInstruction` 的 JSON payload。要包成 v0 transaction 後簽（見 Pattern B）

5. **「Subscriber 怎麼知道自己是月費 OR 買斷解鎖的？」**
   - `GET /strategies/:id` 兩種都會回 private view
   - 想分明：`GET /strategies/me/purchases` 列買斷紀錄；`GET /creator-subscriptions/me` 列月費
   - 或 `GET /strategies/:id/purchase-quote?wallet=<me>` 看 `alreadyOwned`

6. **「為什麼 `/deploy` 要傳 accountId？」**
   - 那是 Crossmint vault account 的 UUID（不是 Solana pubkey），對應後端 `accounts` 表
   - 通常前端先呼叫 `POST /agent/wallets/init` 或 `POST /crossmint/wallets/init` 拿一個 vault account

---

## 8. 整合 checklist

### Creator side
- [ ] Wallet sign-in：`POST /auth/challenge` → `POST /auth/login` 拿 JWT
- [ ] 建草稿 `POST /strategies`
- [ ] (optional) 預覽 IR `POST /strategies/:id/compile`
- [ ] Publish：`POST /strategies/:id/publish`
- [ ] Deploy：`POST /strategies/:id/deploy` —— **要先有 vault accountId**
- [ ] (optional) 上架單買價：`PATCH /strategies/:id/purchase-price`
- [ ] (optional) 設月費方案：`PATCH /creator-subscriptions/plan`

### Subscriber 月費 side (Flow B)
- [ ] Wallet sign-in
- [ ] `POST /creator-subscriptions/creators/:wallet/intent` 拿 unsigned tx
- [ ] 錢包簽 base64 tx + send（Pattern A）
- [ ] `POST /creator-subscriptions/creators/:wallet/confirm-payment` 帶回 signature
- [ ] 確認 `subscription.status === 'active'`

### Subscriber 買斷 side (Flow C)
- [ ] `GET /strategies/:id/purchase-quote` 顯示價格
- [ ] `POST /strategies/:id/purchase-intent` 拿 unsigned tx
- [ ] 錢包簽 + send（Pattern A）
- [ ] `POST /strategies/:id/purchase-confirm` 帶回 signature
- [ ] 確認 `data.id` 已建（買斷紀錄）

### Subscriber 跟單 side (Flow D)
- [ ] `GET /deployments/:id/subscriptions/quote` 顯示費用
- [ ] `POST /deployments/:id/subscriptions` （帶 `depositAmount`+`depositMint` 自動 bundle fund-intent）
- [ ] 等 / 確認 `provisioningState === 'provisioning_complete'`（Pattern C polling）
- [ ] 從 `fundIntentInstruction` 取 instruction，包 v0 tx 簽（Pattern B）
- [ ] `POST /:subId/submit-fund-intent` 帶 `signedTxBase64`
- [ ] `POST /:subId/shield` 觸發 Umbra
- [ ] 確認 `subscription.status === 'active'`
- [ ] (UI) 開 SSE `/:subId/events` 接 cycle 通知

---

## 9. 測試環境位置

- **API 文件**：啟 backend 後 `http://localhost:3000/api/docs`（Swagger UI 可 try-it）
- **Strategy Runtime program**：`FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF`（devnet）
- **DB**：Pintool Dev Supabase（已套全部 migration）
- **這份文件對照源頭**：
  - Strategies: `backend/src/strategies/strategies.controller.ts`
  - Deployments: `backend/src/strategy-deployments/strategy-deployments.controller.ts`
  - Creator subs: `backend/src/creator-subscriptions/creator-subscriptions.controller.ts`
  - Follower vaults: `backend/src/follower-vaults/subscriptions.controller.ts`
