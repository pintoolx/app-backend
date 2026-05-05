---
date: 2026-04-27
type: internal Anchor program spec
project: pintool
related:
  - 2026-04-27-frontier-weekly-update.md (ship list)
  - 2026-04-27-pintool-substack-roadmap.md (v1-v5 content roadmap)
status: draft for team review
deadline: Frontier 2026-05-11
---

# PinTool — Internal Anchor Program Spec

## Design principles

1. **Anchor 是唯一的資金管理者** — Vault PDA 的 authority 永遠是 Anchor program 的 PDA,
   subscriber 自己也不直接控制(避免 trust mode 1 跟 2/3 的安全模型分裂)。
2. **Executor 是 thin client** — 解密 workflow + 讀鏈上 state + 決定下一步 + 簽 instruction tx。
   Executor 摸不到任何錢。
3. **Whitelist-bounded operations** — 創作者只能用 Anchor 已 register 的 node types 串 workflow。
   新 node type = PinTool 升級 Anchor program(這是 trust 邊界,非 bug)。
4. **Subscription 的 executor pubkey 可改** — subscriber 換 trust mode = 換 executor.pubkey。
   解密金鑰需重新授權給新 executor。
5. **Encryption substrate 抽象化** — Anchor 不知道是 Arcium / Umbra / Encrypt,
   只存 `encrypted_blob` + `substrate: u8`,具體加解密在鏈下做。

---

## Accounts (PDAs)

### `CreatorProfile` ⭐

Creator 持久身份 + 跨 workflow 統計 + 提現口袋。
**這是 subscriber management layer 的 creator side**——一個 creator 一個。

```
seeds: ["creator", creator_pubkey: Pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `creator_pubkey` | Pubkey | 唯一識別,可動所有 ops |
| `display_name` | String (max 64) | profile page 顯示名 |
| `bio_uri` | String (max 200) | Arweave / IPFS / shdw 指向 bio + avatar |
| `twitter_handle` | Option<String> | 社群 link |
| `sns_name` | Option<String> | .sol 名 |
| `workflow_count` | u64 | 跨所有 content 統計 |
| `total_subscriber_count` | u64 | 跨所有 workflow 訂閱數 |
| `total_revenue_lamports` | u64 | 累積總收入(歷史) |
| `withdrawable_lamports` | u64 | 可提餘額(escrow) |
| `status` | enum | Active / Paused / Suspended |
| `created_at` | i64 | unix epoch |
| `bump` | u8 | PDA bump |

### `WorkflowPolicy`

Creator 發布的單一策略內容 + 加密 blob。

```
seeds: ["workflow", creator: Pubkey, slug: String]
```

| Field | Type | Purpose |
|---|---|---|
| `creator` | Pubkey | 發布者(對應 CreatorProfile.creator_pubkey)|
| `slug` | String (max 64) | URL-safe 識別字 |
| `encrypted_blob` | Vec<u8> (max 4KB) | workflow JSON 的加密版 |
| `substrate` | u8 enum | 0=Arcium, 1=Umbra, 2=Encrypt (TBD) |
| `node_types` | Vec<NodeType> | whitelist:此 workflow 用到的 node 種類 |
| `max_per_call_lamports` | u64 | 單筆執行上限 |
| `allowed_protocols` | Vec<Pubkey> | 白名單 protocol(Jupiter / Kamino / ...) |
| `schedule_kind` | enum | OnDemand / Cron(seconds) / Triggered(condition) |
| `subscription_price_lamports` | u64 | 訂閱費(每 period) |
| `subscription_period_seconds` | i64 | 計費週期 |
| `status` | enum | Active / Paused / Deprecated |
| `subscriber_count` | u64 | 此 workflow 訂閱數(per-workflow stats) |
| `revenue_lamports` | u64 | 此 workflow 累積收入(per-workflow stats) |
| `bump` | u8 | PDA bump |

**Subscribe 時的金流**:
- 新 subscriber 付費 → 同時更新 WorkflowPolicy.revenue + CreatorProfile.withdrawable
- Creator 提現呼叫 `withdraw_revenue(creator_profile)` → 一筆 tx 提全部
- per-workflow stats 留著給 analytics 用

### `Subscription`

訂閱關係 + 解密授權。

```
seeds: ["subscription", workflow_policy: Pubkey, subscriber: Pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `workflow_policy` | Pubkey | 訂哪個 workflow |
| `subscriber` | Pubkey | 訂閱者 |
| `executor` | Pubkey | trust mode 決定 — 可改(`update_executor`)|
| `subscribed_at` | i64 | unix epoch |
| `expires_at` | i64 | 到期時間 |
| `status` | enum | Active / Expired / Cancelled |
| `decryption_grant` | Vec<u8> | 加密金鑰 re-encrypted 給 `executor` 用 |
| `bump` | u8 | |

### `Vault` (SOL holder)

Subscriber 的 SOL 存放 PDA,authority 是 Anchor program PDA。

```
seeds: ["vault", workflow_policy: Pubkey, subscriber: Pubkey]
owner: SystemProgram
authority: program PDA (program signs)
```

### `VaultTokenAccount` (per mint)

每個 SPL token 一個 ATA。

```
seeds: ["vault_token", workflow_policy, subscriber, mint]
owner: TokenProgram
authority: program PDA
```

### `VaultState`

執行狀態追蹤。

```
seeds: ["vault_state", workflow_policy, subscriber]
```

| Field | Type | Purpose |
|---|---|---|
| `last_executed_at` | i64 | 上次執行時間 |
| `next_executable_at` | i64 | 下次可執行(限速)|
| `current_step_index` | u32 | workflow 進度 |
| `total_executions` | u64 | 計數器 |
| `last_pnl_lamports` | i64 | 上次執行 PnL(可給 leaderboard 用)|

### `NodeRegistry` (admin-managed)

Anchor 認得的 node types。

```
seeds: ["node_registry"]
```

| Field | Type | Purpose |
|---|---|---|
| `admin` | Pubkey | PinTool 治理金鑰 |
| `nodes` | Vec<NodeDef> | (name, validator_program, doc_uri) |

### `SubscriberProfile` (v2 預留)

對偶 CreatorProfile,給 subscriber 的跨訂閱統計。

```
seeds: ["subscriber", subscriber_pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `subscriber_pubkey` | Pubkey | 唯一識別 |
| `display_name` | Option<String> | 訂閱者展示名(可不設,匿名)|
| `total_subscriptions` | u64 | 訂閱過幾個 workflow |
| `active_subscriptions` | u64 | 目前 active 數 |
| `total_spent_lamports` | u64 | 累積花費 |
| `total_pnl_lamports` | i64 | 跨訂閱 vault PnL aggregate |
| `bump` | u8 | |

**v1 不做**——subscriber 的統計可以從 Subscription account 掃出來。
v2 加上是為了:
- Subscriber discovery / leaderboard
- 「最賺錢的訂閱者」social proof
- Cross-content recommendation

---

## Instructions

### Creator 端

```rust
create_creator_profile(
    display_name: String,
    bio_uri: String,
    twitter_handle: Option<String>,
    sns_name: Option<String>,
)
  → CreatorProfile
  // creator 第一次發布前要先建,只建一次

update_creator_profile(profile, new_display_name, new_bio_uri, ...)
  // 改顯示名 / bio / 社群 link 不用改任何 workflow

publish_workflow(
    creator_profile: Pubkey,
    slug: String,
    encrypted_blob: Vec<u8>,
    substrate: u8,
    node_types: Vec<NodeType>,
    max_per_call_lamports: u64,
    allowed_protocols: Vec<Pubkey>,
    schedule_kind: ScheduleKind,
    subscription_price_lamports: u64,
    subscription_period_seconds: i64,
)
  → WorkflowPolicy
  // 同時 CreatorProfile.workflow_count++

update_workflow(policy, new_blob, new_metadata)
  // 已存在 subscription 用舊版,新訂閱用新版

pause_workflow(policy)
resume_workflow(policy)

withdraw_revenue(creator_profile, amount)
  // 從 CreatorProfile.withdrawable_lamports 提到 creator 錢包
  // 一筆 tx 提全部 workflow 累積收入,不用一個個 workflow 處理
```

### Subscriber 端

```rust
subscribe(workflow_policy, executor_pubkey, decryption_grant)
  → Subscription, Vault, VaultState
  // 從 subscriber 錢包扣 subscription_price_lamports → 進 policy.revenue
  // 建 Vault + VaultState
  // 設 executor 為指定 pubkey

deposit_sol(vault, amount)
deposit_token(vault_token_account, amount)
  // subscriber 自己往 vault 入金,executor 不能呼叫

withdraw_sol(vault, amount)
withdraw_token(vault_token_account, amount)
  // subscriber 自己提款,任何時候都可

cancel_subscription(subscription)
  // 設 status = Cancelled
  // 退剩餘 prorated 訂閱費
  // 把 vault 內容提回 subscriber
  
update_executor(subscription, new_executor, new_decryption_grant)
  // 換 trust mode 用 — 重新授權解密金鑰
```

### Executor 端(每個 node type 一個 instruction)

```rust
execute_swap(
    subscription,
    workflow_policy,
    vault,
    vault_state,
    from_mint,
    to_mint,
    amount,
    min_output,
)
  // 驗證:
  //   ctx.accounts.executor.key() == subscription.executor
  //   subscription.status == Active
  //   now < subscription.expires_at
  //   workflow_policy.node_types contains "swap"
  //   amount <= workflow_policy.max_per_call_lamports
  //   now >= vault_state.next_executable_at
  // 通過後 CPI to Jupiter v6 / Raydium / Orca
  // VaultState.total_executions++
  // VaultState.last_executed_at = now

execute_deposit(subscription, protocol, target_vault, amount)
  // 同樣驗證 + CPI to Kamino / Drift / MarginFi

execute_withdraw(subscription, protocol, source_vault, amount)
  // 從 protocol 領回到 vault

execute_condition(subscription, oracle, threshold)
  // 純讀:讀 Pyth / Switchboard,emit event 給 executor 看
  // 不動任何 vault state

execute_split(subscription, ratios, target_vaults)
  // fan-out:把 vault 內容按比例分到多個目標
```

### Platform 端(admin 限定)

```rust
register_node(name, validator_program, doc_uri)
  // 開新 node type
  
deregister_node(name)
  // 停用 node type(不影響已 publish 的 workflow,但不能新建)
  
register_protocol(protocol_pubkey, allowed_ops: Vec<u8>)
  
set_platform_fee_bps(bps)
  // 0-1000 (max 10%)
```

---

## Trust mode 對照

| 模式 | `subscription.executor` | Executor 跑在哪 | 信任度 |
|---|---|---|---|
| 1. Subscriber's machine | `subscriber.pubkey` | 訂閱者本機 | 最 trustless,executor = 自己 |
| 2. Self-hosted | 訂閱者選定的 server keypair | 訂閱者 VPS | 信任自己的 server |
| 3. PinTool managed | PinTool well-known pubkey | PinTool 後台 | 信任 PinTool 不亂搞 |

**任一模式下,Anchor 的安全保證一樣**:executor 只能呼叫 whitelisted ops,在 policy 限制內,不能直接動 vault 任何 lamport。

---

## Encryption flow(substrate TBD,W1 spike)

### Option A — Arcium MXE(主候選)

```
publish:
  Creator → encrypts workflow JSON to MXE cluster
  → MXE returns encrypted_blob
  → publish_workflow(encrypted_blob=blob, substrate=0)

subscribe:
  Subscriber 呼叫 subscribe(executor_pubkey)
  → Anchor emit "subscription created" event
  → off-chain MXE re-encrypts blob to executor_pubkey
  → MXE submits update tx setting Subscription.decryption_grant

execute:
  Executor 讀 Subscription.decryption_grant → 解密拿 viewing key
  → 用 viewing key 解 WorkflowPolicy.encrypted_blob → 拿 plaintext workflow
  → 讀 VaultState.current_step_index → 決定要跑哪個 node
  → 建 instruction tx → 簽 → 送
```

### Option B — Umbra viewing keys(備選)

```
publish:
  Creator 生 ephemeral key K
  → AES encrypt workflow JSON with K → ciphertext
  → publish_workflow(encrypted_blob=ciphertext, substrate=1)

subscribe:
  Subscriber call subscribe()
  → off-chain: ECIES encrypt K to executor_pubkey
  → 同 tx 包進 Subscription.decryption_grant

execute:
  Executor decrypts grant with own private key → 拿 K
  → AES decrypt blob with K → workflow JSON
```

### W1 決策標準

- Arcium MXE 在 Mainnet Alpha 是否能 handle 4KB blob + 100ms decrypt?
- Umbra SDK 文件齊全?ECIES 在 wallet adapter 串接費力嗎?
- 兩個都試 1 天,選 dev experience 好的當 v1 預設,另一個當 fallback。

---

## Compute unit budget

| Instruction | 估計 CU | 備註 |
|---|---|---|
| `subscribe` | ~80k | 建 4 個 PDA |
| `execute_swap` (Jupiter v6 single-hop) | ~150k | 含 validation |
| `execute_swap` (Jupiter multi-hop) | ~400k | 可能需要 priority fee + CU req |
| `execute_deposit` (Kamino) | ~120k | |
| `execute_condition` (read Pyth) | ~30k | |

每個 `execute_*` 必須能在單一 tx 內完成。多 hop / 多 protocol 的複雜操作要拆成多 tx。

---

## 安全性質

1. **Executor 拿不到錢** — 沒有任何 instruction 讓 executor 直接從 vault 提現
2. **Subscriber 隨時可提現** — `withdraw_sol` / `withdraw_token` 不需 executor 簽
3. **Creator 拿不到 subscriber 的錢** — Creator 只能 publish + withdraw_revenue (累積的訂閱費 escrow,不是 vault)
4. **取消訂閱即時生效** — `cancel_subscription` 後 executor 呼叫會 fail
5. **Workflow paused → 全部 subscriber 的 executor 呼叫 fail** — Creator 緊急停損用
6. **Whitelist enforcement** — workflow 用的 node 必須在 `policy.node_types`,protocol 必須在 `allowed_protocols`

---

## Failure modes

| 情況 | 結果 |
|---|---|
| Subscription expired | execute_* fail with `SubscriptionExpired` |
| Workflow paused | execute_* fail with `WorkflowPaused` |
| Vault 餘額不足 | tx fail with `InsufficientFunds`,VaultState 不變 |
| Executor offline | 沒人呼叫 → 不執行,vault 安全(trade-off:可能錯過時機)|
| Creator deletes workflow | 已存在 subscription 仍可執行直到 expiry,但 status 變 Deprecated |
| Oracle 異常 | `execute_condition` fail with `OracleStale`,executor 等下一輪 |

---

## 跨 v1-v5 的延伸點

| Version | Anchor 改動 |
|---|---|
| v1 (Frontier) | 上述完整 spec — workflow + execute_* nodes |
| v2 vault recommendations | 加 `RecommendationPolicy`(共用 ContentPolicy enum)+ `execute_rebalance` instruction |
| v3 signal feeds | 加 `SignalRecord` per-signal PDA + `emit_signal` instruction |
| v4 alpha threads | 加 `ThreadPolicy`(無 execute,純讀)+ Arweave/SHDW URI 欄位 |
| v5 bundles | 加 `BundlePolicy` + revenue-split router instruction |

---

## Open questions(W1 必須決)

1. **Encryption substrate**: Arcium MXE 還是 Umbra viewing key?(決於 dev experience spike)
2. **Per-call cap 單位**: lamports 還是 % of vault?(目前傾向 lamports,不會被 vault 漲跌影響上限)
3. **Subscription escrow**: Creator 主動提領(pull),還是按期自動撥(push)?(傾向 pull,省 cron)
4. **Performance fee**: v1 要不要做?(傾向 v1 不做,v2 vault rec 才需要)
5. **Multi-token vault**: 一個 PDA + 多個 ATA,還是多個獨立 vault PDA?(一個 PDA + 多 ATA)
6. **Slippage / oracle 防護**: execute_swap 要不要強制帶 oracle reference price?(必須,防 sandwich)

---

## Architecture diagrams

兩張永久維護(若改架構,直接覆蓋這兩個 URL,不再開新的):

| 用途 | URL |
|---|---|
| **Pitch 版**(對外/judge/影片)| https://excalidraw.com/#json=MsYyDqYSyi2BzZF7dXog6,tSFutomPA1AMZ0hFUxwRBQ |
| **Internal 版**(對內/開發/技術選型)| https://excalidraw.com/#json=TyHRlpyZHlSRwIJVVuv6B,vanoRBNDXxHDxvxQBRqczA |

兩張結構(2026-04-27 晚上重畫,加 MagicBlock 三件套):

**Top**: Creator + Subscriber(Internal 版多 TukTuk crank trigger)

**Middle**: Anchor program zone — 中央 gatekeeper
- Pitch:WorkflowPolicy + Vault PDA 兩個 sub-box
- Internal:WorkflowPolicy + Subscription record + Vault PDA 三個 sub-box,加 instruction list

**Bottom 左**: MagicBlock — Encrypted Execution
- ER · sub-second rebalance loops(magicblock-er-real.adapter.ts)
- PER · strategy logic in TEE(magicblock-per-real.adapter.ts)
- PP · encrypted balances & amounts(magicblock-private-payments.ts)

**Bottom 右**: Whitelisted DeFi Programs(CPI targets)
- Pyth · price feeds ✅
- Orca whirlpool · swap CPI
- Kamino · lending CPI(next)

**箭頭**(全部具體語意,沒有「delegate」這種模糊字):
1. Creator → Anchor:publish / edit
2. Subscriber → Anchor:subscribe · deposit · withdraw
3. TukTuk → Anchor (Internal 版):trigger
4. Anchor → MagicBlock:delegate vault(進 ER session)
5. MagicBlock → Anchor:signed instructions(commit results back)
6. Anchor → DeFi:CPI
