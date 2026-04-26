# 基於現有專案的策略 Deploy 平台轉型分析

## 這份報告要回答什麼

你的目標不是重做一個全新產品，而是把現有產品轉型成：

> 一個可以 deploy 策略、公開展示策略存在與績效，但把策略實現細節加密起來的策略平台。

而且這個轉型不是抽象概念，而是要 **based on 你現在這個 project**。

這份報告會直接回答：

1. 你現在這個專案的核心骨架是什麼。
2. 哪些現有 node 適合改寫成 Anchor / on-chain 形式。
3. 哪些一定還要留在 off-chain。
4. `MagicBlock ER / PER / Private Payments API` 應該插進你現有架構的哪一層。
5. `Umbra` 應該放在哪一層，而不是亂塞進整個系統。
6. 黑客松階段最實際的落地順序是什麼。

## TL;DR

- 你現在的產品本質上已經不是單一 bot，而是接近一個 `workflow control plane + account runtime + node execution engine`。
- 這個骨架非常適合轉成策略 deploy 平台，因為你已經有：
  - workflow graph
  - execution runtime
  - account/vault 概念
  - execution history
  - public/private visibility 雛形
- 最佳轉型方式不是把全部 node 一次搬上鏈，而是拆成 3 層：
  1. `控制平面`：保留現有 Nest backend 作為策略建立、發布、AI 編排、索引與權限管理
  2. `執行平面`：把適合的策略 state / risk guards / vault state 搬到 Anchor，並優先接 `MagicBlock ER/PER`
  3. `隱私資產平面`：有需要時再接 `Umbra` 保護 treasury / balances
- 你的 `workflow` 在未來不該直接等於「執行邏輯」，而應該拆成：
  - `public strategy metadata`
  - `private strategy IR / parameters`
  - `execution state`
  - `public snapshot`
- 真正適合先鏈上化的不是全部 11 個 node，而是：
  - `balance / condition`
  - `transfer`
  - `strategy state transition`
  - `permissioned vault state`
  - 部分 DeFi protocol adapter
- 真正不適合直接鏈上化的，是：
  - `priceFeed polling`
  - `Helius webhook`
  - `Telegram`
  - `AI workflow generation`
  - `Crossmint wallet provisioning`

## 1. 你現在這個專案其實已經具備什麼

從目前 codebase 看，你已經有一個很清楚的 workflow 平台骨架。

### 1.1 Workflow graph 已存在

`backend/src/web3/workflow-types.ts` 已經把 workflow 抽象成：

- `WorkflowDefinition`
- `WorkflowNode`
- `NodeConnection`
- `INodeType`
- `IExecuteContext`

這其實就是一個簡化版 n8n / strategy graph IR。

這代表你現在最有價值的資產不是某個單獨 node，而是：

> 你已經有一套可以描述「策略由哪些步驟、哪些條件、哪些依賴構成」的 DSL。

### 1.2 Runtime executor 已存在

`backend/src/workflows/workflow-instance.ts` 會：

- 找 start nodes
- 依 graph 執行 node
- 注入 services 到 context
- 保存 step logs
- 串接 Telegram 通知

這代表你現在已有 execution orchestration 雛形。未來策略平台不需要推倒重來，而是要把：

- 一部分 execution 從 `TypeScript class runtime`
- 轉成 `Anchor program + relayer/keeper runtime`

### 1.3 Workflow 已有 public/private 的前身

`backend/src/workflows/workflows.service.ts` 與資料表 schema 已經有：

- `workflows.definition`
- `workflows.is_public`
- `workflow_executions.definition_snapshot`
- `accounts.current_workflow_id`

這幾個欄位很重要，因為它們已經說明你產品本來就在走：

- 可保存策略/流程
- 可分配到特定 account
- 可執行與留痕
- 可標示 public visibility

你現在欠缺的不是 workflow capability，而是：

- `public strategy view` 和 `private strategy implementation` 的正式分離

### 1.4 Account 模型已接近策略 vault

`accounts` 表加上 `Crossmint` 錢包模型，本質上已經接近策略 vault / strategy account：

- 每個 account 有自己的 wallet
- account 可綁定 current workflow
- 有獨立 execution 與 transaction history

這非常適合演化成：

- `Strategy Deployment`
- `Strategy Vault`
- `Strategy Instance`

也就是說，今天的 `account + workflow`，其實已經可以被重命名與重塑成明天的：

- `vault + strategy`

## 2. 現有產品的本質結構

我會把你現在的系統理解成 4 層。

### 2.1 Control Plane

這一層包含：

- auth
- agent API
- workflow CRUD
- workflow AI
- Telegram mapping
- Supabase persistence

它的責任是：

- 讓用戶定義策略
- 發布策略
- 管理帳戶
- 保存定義與 execution logs

### 2.2 Execution Plane

這一層包含：

- `WorkflowInstance`
- `WorkflowLifecycleManager`
- `NodeRegistry`
- node classes

它的責任是：

- 實際跑策略圖
- 決定下一步要做什麼
- 連接 trigger 與 DeFi action

### 2.3 Wallet / Asset Plane

這一層目前以 `CrossmintService` 為主：

- 建立 custodial wallet
- 取得 wallet adapter
- 代簽與發送交易
- 提款與關戶

### 2.4 Observation / Notification Plane

這一層包含：

- Pyth price polling
- Helius webhook
- Telegram notifier
- execution logs / transaction history

## 3. 轉型後應該變成什麼

如果你要把它變成「策略 deploy 平台」，我建議你不要把 workflow 概念丟掉，而是要把 workflow 升級成 `Strategy IR`。

## 建議的新分層

### A. Strategy Control Plane（保留現有 Nest backend）

保留並重構你現有的：

- auth
- agent API
- strategy CRUD
- AI strategy builder
- public strategy listing
- indexing / snapshots / analytics

未來這層不再負責直接執行所有策略邏輯，而是負責：

- 建策略
- 編譯策略
- 發布策略
- 啟動 / 停止策略 deployment
- 顯示 public snapshot

### B. Strategy Execution Plane（新）

這層是你要開始接 Anchor + MagicBlock 的地方。

它負責：

- vault state
- strategy parameters
- execution cursor
- risk checks
- position state
- permission state

未來你現在的 TypeScript nodes，會被拆成：

- `Anchor opcodes / state transitions`
- `off-chain keepers / route builders`

### C. Privacy Plane（新）

這層才是 `PER` 與 `Umbra` 的位置。

- `MagicBlock PER`：保護策略邏輯與私密狀態
- `Umbra`：保護資產餘額與私密金流

### D. Public Strategy Surface（新）

這層是策略 deploy 平台最重要但目前還不完整的一層：

- strategy name
- creator
- risk score
- tvl range
- pnl summary
- delayed snapshots
- subscriber-visible metadata

重點是：

> 公開層只能顯示「可被理解但不可逆向還原邏輯」的資料。

## 4. 你的現有 workflow 應怎麼重新定義

未來不要再把一份 `workflow.definition` 視為單一來源真相，而是拆成 4 份資料。

### 4.1 Public Strategy Metadata

公開給所有使用者看：

- strategy id
- name
- description
- creator
- category
- risk level
- public tags
- fee model

### 4.2 Private Strategy IR

只有 creator / authorized runtime 可讀：

- 完整節點圖
- 參數
- threshold
- allocation weights
- rebalance rules
- execution preferences

這是你目前 `workflow.definition` 的演化方向。

### 4.3 Strategy Deployment State

這層是 runtime state，不應和策略定義混在一起：

- current step cursor
- last trigger timestamp
- open positions
- last execution result
- vault balances
- guard flags

### 4.4 Public Snapshot

這層是給外界看的裁切後輸出：

- APY / PnL summary
- last executed at
- current status
- coarse allocation range
- risk exposure band

## 5. 哪些現有 node 適合改寫成 Anchor / 鏈上形式

這裡不要追求「全部上鏈」，而是要做正確切分。

## 5.1 優先鏈上化的 node / 能力

### 1. Balance / Condition 類節點

現在的 `getBalance` 節點在 TypeScript runtime 裡做查詢與門檻判斷。這種能力非常適合變成鏈上策略 guard / predicate。

可鏈上化成：

- `minimum balance guard`
- `position cap guard`
- `cooldown guard`
- `max drawdown guard`
- `allocation threshold guard`

理由：

- 它本質上是 deterministic predicate
- 適合當 Anchor instruction 裡的檢查邏輯

### 2. Transfer 類節點

`transfer` 本質上就是資產移動。若策略 vault 要自主管理資產，這一層非常適合鏈上化。

可鏈上化成：

- vault -> vault transfer
- vault -> user withdraw
- fee distribution
- settlement transfer

### 3. 策略狀態轉移本身

這是最應該鏈上化的，而你現在其實還沒有把它抽成獨立概念。

需要新增的鏈上概念：

- `StrategyState`
- `StrategyVault`
- `ExecutionCursor`
- `PositionState`
- `GuardState`

這些不是對應某個單獨 node，而是把現在 TypeScript runtime 內隱性的狀態正式模型化。

### 4. Permission / Visibility 控制

如果你要做「deploy 策略但實現細節加密」，那權限與可見性一定要正式進入鏈上或私密 execution 邏輯。

這一層最適合對接：

- `MagicBlock PER Permission Program`

## 5.2 適合做 Hybrid，而不是純鏈上的 node

### 1. Jupiter Swap

`jupiterSwap` 不適合簡單理解成「整個搬進 Anchor」。

更正確的方式是：

- `路由計算 / quote` 仍由 off-chain builder 完成
- `策略授權 / 執行條件 / vault state 更新` 由鏈上或 PER 負責
- `最終交易提交` 由 relayer / keeper 執行

也就是：

> Jupiter swap 更適合做 hybrid adapter，而不是單純 on-chain node。

### 2. Kamino / Drift / Sanctum / Lulo

這些協議整合有些能做 CPI，有些更適合先走 SDK / tx-builder 路線。

在黑客松與短期轉型階段，建議先把它們視為：

- `strategy action adapters`
- `protocol connectors`

而不是第一天就全部重寫成純 Anchor program。

### 3. Jupiter Limit Order

這也更像 hybrid。因為下單條件、訂單建構、生命周期管理通常不會全部在你自己的 strategy program 內完成。

## 5.3 不該直接鏈上化的 node / 能力

### 1. Pyth PriceFeed polling

你現在的 `pythPriceFeed` 是 polling / monitor 型節點，這種「等待條件成立」邏輯不應直接照抄到鏈上。

正確拆法是：

- 鏈上保留 `price guard / threshold verification`
- off-chain keeper / crank 負責持續監看價格並觸發執行

### 2. Helius Webhook

這本質上就是 off-chain event ingestion，應保留在 backend / relayer 層。

### 3. Telegram Notifications

完全應留在 off-chain。

### 4. Workflow AI

AI 生成策略是 control plane 能力，不是 execution plane。

### 5. Crossmint wallet provisioning

這是錢包與帳戶供給層，應保留在 off-chain service。

## 6. 現有 11 個 node 的遷移矩陣

| 現有 Node | 未來角色 | 建議形態 |
| --- | --- | --- |
| `pythPriceFeed` | trigger / oracle watcher | Off-chain keeper + on-chain guard |
| `heliusWebhook` | event ingress | Off-chain only |
| `getBalance` | risk / predicate / guard | On-chain preferred |
| `transfer` | settlement / vault movement | On-chain preferred |
| `jupiterSwap` | swap adapter | Hybrid |
| `jupiterLimitOrder` | order adapter | Hybrid |
| `kamino` | yield adapter | Hybrid, later partial CPI |
| `driftPerp` | perp adapter | Hybrid |
| `sanctumLst` | staking/LST adapter | Hybrid |
| `luloLend` | lend adapter | Hybrid / off-chain heavy |
| `stakeSOL` | staking adapter | Hybrid |

## 7. MagicBlock 應怎麼套進你現在的架構

## 7.1 ER 應放在哪裡

`MagicBlock ER` 最適合當你新的 execution plane。

你可以把：

- strategy state
- vault state
- execution cursor
- high-frequency guard updates

delegate 到 ER 進行低延遲 execution。

這很適合你現在的產品，因為你已經有「workflow runtime」概念。ER 只是把 runtime 的一部分從 Nest memory / TS service，搬到更接近鏈上的 delegated state execution。

### 對應你現有架構

- 現在的 `WorkflowInstance` = off-chain executor
- 未來的 `ER strategy runtime` = delegated execution layer

### 什麼先搬進 ER

第一批最適合：

- strategy state transitions
- vault balance accounting
- simple guards
- execution sequencing metadata

## 7.2 PER 應放在哪裡

`PER` 不是拿來取代全部 execution，而是拿來保護：

- private strategy parameters
- thresholds
- weights
- tx messages
- logs
- internal positions

對你來說最重要的是：

> PER 讓策略可以被 deploy 與使用，但邏輯細節只有 creator / authorized actors 看得到。

這完全對應你的目標。

### 你現有產品裡最該被 PER 保護的資料

- 現在 `workflow.definition` 裡的私密參數
- future `Strategy IR`
- execution step outputs
- private balances / position state

### 不應直接公開的東西

- 完整 node graph
- threshold 數值
- trigger 條件
- 實際 route / order details
- 中間風控狀態

## 7.3 Private Payments API 應放在哪裡

如果你要在黑客松有限時間內做出有說服力的 demo，`Private Payments API` 應該被當成：

- 私密策略金庫的資產入口 / 出口
- 私密 deposit / withdraw / transfer builder

它最適合補你的資產平面，而不是直接承擔整個策略邏輯。

對你現在系統的最佳作用是：

- 先讓策略有 private vault / private treasury 體驗
- 再把真正的邏輯保護交給 PER

## 8. Umbra 應怎麼套進你現在的架構

Umbra 不應當作策略執行主框架，而應當作：

- `strategy treasury privacy layer`
- `private balances layer`
- `selective disclosure layer`

### 最適合的放法

把 Umbra 放在：

- strategy treasury
- protocol-specific private reserve
- subscriber deposit pool
- creator-only visible balance layer

### 不適合的放法

不要期待 Umbra 來保護：

- node graph
- execution logic
- strategy conditions

那些應由 `PER` 解決。

### 什麼時候接 Umbra

如果你第一版只想實現：

- deploy 策略
- 公開展示
- 隱藏邏輯

那先做 `PER` 就夠了。

如果你還要進一步隱藏：

- 策略資金規模
- 真實資產流
- treasury balance

再接 Umbra。

## 9. 對你現有資料模型的具體改造建議

你現在的 schema 已經有很好的起點，但語意要升級。

## 9.1 `workflows` 應演化成 `strategies`

不是一定要馬上 rename table，但語意上應該這樣想：

- `workflows` -> strategy templates / strategy definitions

建議新增或拆分欄位：

- `public_metadata`
- `private_definition_ref`
- `execution_mode` (`offchain` | `er` | `per`)
- `visibility_mode`
- `compiled_strategy_ir`

## 9.2 `accounts` 應演化成 `strategy deployments` / `vaults`

你現在的 `accounts.current_workflow_id` 很接近 deployment 綁定。

建議未來語意變成：

- account = strategy vault / strategy instance

可新增：

- `strategy_id`
- `deployment_status`
- `execution_endpoint`
- `private_state_account`
- `public_snapshot_account`

## 9.3 `workflow_executions` 應演化成 `strategy_runs`

這張表依然有價值，但應明確區分：

- off-chain orchestration logs
- on-chain execution references
- ER/PER session references

應新增：

- `execution_layer`
- `er_session_id`
- `per_session_id`
- `public_snapshot_hash`
- `private_state_ref`

## 10. 最適合你的轉型架構

我最推薦的是這個結構：

### 10.1 保留現有 Nest backend 當 Control Plane

保留：

- auth
- workflow AI
- strategy CRUD
- public strategy listing
- indexing
- notifications
- relayer / keeper 管理

不要把它丟掉，因為它本來就是平台層。

### 10.2 新增 Anchor Strategy Program

建立一個 Anchor program，負責：

- `StrategyRegistry`
- `StrategyVault`
- `StrategyState`
- `ExecutionCursor`
- `PublicSnapshot`

### 10.3 把現有 workflow JSON 編譯成 Strategy IR

不要直接把 UI 產生的 workflow JSON 塞給鏈上執行。

應該新增一個 compiler：

- input: 現有 `WorkflowDefinition`
- output: `CompiledStrategyIR`

這個 IR 要把：

- 可公開部分
- 私密部分
- hybrid adapter 部分

明確拆出來。

### 10.4 用 Relayer / Keeper 取代部分 Lifecycle Manager

你現在的 `WorkflowLifecycleManager` 是 polling-based workflow launcher。

未來它應演化成：

- strategy keeper
- ER session coordinator
- PER auth assistant
- swap route builder
- protocol adapter runner

## 11. 最推薦的實作順序

## 階段 1：保留現有產品外殼，先做語意升級

先不要急著寫很多鏈上程式，先把語意改正：

- workflow -> strategy
- account -> vault/deployment
- execution -> run

並新增：

- public metadata
- private definition ref
- compiled IR

## 階段 2：先挑一條最窄的策略類型

建議不要一開始就支援全部 node。

最適合的第一條策略類型：

- `price-trigger swap`
- 或 `rebalance vault`

因為這最接近你現在已有能力。

## 階段 3：只搬最關鍵狀態上鏈

第一版鏈上只做：

- strategy state
- guard state
- vault state
- public snapshot

不要一開始就要求每個 node 都變成鏈上 instruction。

## 階段 4：先接 ER，再接 PER

順序建議：

1. `ER` 先解 execution plane
2. `PER` 再解邏輯隱私

這樣風險更低，也更容易 demo。

## 階段 5：最後再接 Umbra

當你要保護 treasury / balances 時再接 Umbra，不要在一開始讓隱私資產協議把整個架構複雜化。

## 12. 黑客松最務實的 MVP

如果以黑客松交付為目標，我最建議的 MVP 是：

### MVP 題目

`Private Strategy Deploy Platform`

### MVP 功能

1. 使用現有 UI / backend 建立策略
2. 把策略編譯成 public metadata + private config
3. deploy 一個 strategy vault
4. 用 `MagicBlock PER` 保護 private config / state
5. 只公開：
   - strategy name
   - creator
   - pnl summary
   - risk level
   - status
6. owner 可看到完整執行細節
7. 非 owner 看不到邏輯與私密倉位

### 這版先不要做什麼

- 不要一開始全節點 Anchor 化
- 不要一開始全協議全支援
- 不要一開始就做完整 Umbra mixer

## 13. 最終結論

你現在這個專案其實非常適合轉型成策略 deploy 平台，因為它已經具備 3 個最重要的基礎：

- `workflow graph`
- `execution runtime`
- `account/vault abstraction`

最正確的方向不是把現有 Nest backend 丟掉，而是：

- 保留它作為 `control plane`
- 把適合的策略 state 與 guard 搬到 `Anchor`
- 用 `MagicBlock ER` 做 execution acceleration
- 用 `MagicBlock PER` 做策略邏輯加密
- 在需要時用 `Umbra` 做資產與餘額隱私

一句話總結：

> 你的現有產品不是要從 workflow bot 變成另一個完全不同的東西，而是要從「off-chain workflow engine」升級成「strategy control plane + private on-chain execution plane」。
