# 黑客松重點研究：Umbra SDK 與 MagicBlock ER / PER / Private Payments API

## 研究目的

這份報告聚焦在黑客松真正需要回答的問題：

1. `Umbra SDK` 到底適合拿來做什麼？
2. `MagicBlock ER`、`PER`、`Private Payments API` 的差異是什麼？
3. 如果黑客松 tracks 明確希望使用這些技術，哪一條路最適合在有限時間內做出能 demo、能說故事、能打分的作品？

這次研究只針對關鍵主題頁面做定向查詢，沒有直接整包抓完整 docs。

## TL;DR

- `Umbra SDK` 最適合做「私密資產、加密餘額、匿名轉帳、可授權揭露」類型產品。
- `MagicBlock ER` 最適合做「高頻互動、低延遲狀態更新、遊戲化 / 即時交易 / 自動化策略」類型產品。
- `MagicBlock PER` 最適合做「私密執行、私密狀態、權限化可視性、隱藏邏輯」類型產品。
- `MagicBlock Private Payments API` 最適合黑客松快速交付，因為它直接把很多 PER 裡的 token flow 包成高階 API。
- 若你要做「策略可見但邏輯不可見」，最強組合仍然是：`PER + Public Snapshot`，若還要把資金層也隱藏，再加 `Umbra`。
- 若你要在黑客松有限時間內衝 demo，最務實的優先順序通常是：
  1. `Private Payments API`
  2. `ER + Magic Router`
  3. `Umbra SDK`
  4. `完整自建 PER 程式整合`

## 一張表先看懂

| 技術 | 核心能力 | 最適合黑客松題目 | 實作門檻 | Demo 效果 |
| --- | --- | --- | --- | --- |
| `Umbra SDK` | 加密餘額、匿名轉帳、viewing grants | 私密支付、隱私金庫、匿名轉帳、隱私 DeFi | 中高 | 強 |
| `MagicBlock ER` | 低延遲執行、delegated state、router routing | 即時互動 app、遊戲、策略模擬、快速鏈上狀態 | 中 | 很強 |
| `MagicBlock PER` | TEE 私密執行、ACL、私密 state | 私密策略、密封邏輯、私有狀態協作 | 高 | 非常強 |
| `Private Payments API` | 高階私密 token flow API | 私密錢包、私密轉帳、私密付款 demo | 中低 | 很強 |

## 1. Umbra SDK 研究重點

相關研究頁面：

- [Umbra Quickstart](https://deepwiki.com/umbra-defi/docs/1.1-getting-started-%28quickstart%29)
- [Client Initialization and Wallet Adapters](https://deepwiki.com/umbra-defi/docs/2.1-client-initialization-and-wallet-adapters)
- [Registration](https://deepwiki.com/umbra-defi/docs/2.2-registration)
- [Deposits and Withdrawals](https://deepwiki.com/umbra-defi/docs/2.3-deposits-and-withdrawals)

## Umbra SDK 是什麼

Umbra SDK 是一套以 TypeScript 為主的開發套件，讓你在 Solana 上做兩件核心事情：

- `Encrypted Balances`：把餘額存在加密帳戶中
- `Mixer / UTXO`：讓轉帳圖譜難以追蹤

它的模型不是單純把某個欄位加密，而是整個協議層都圍繞：

- `EncryptedUserAccount` PDA
- `EncryptedTokenAccount` PDA
- X25519 key registration
- Master seed / viewing key hierarchy
- Arcium MPC callback flow

也就是說，它比較像一個「完整隱私資產協議 SDK」，不是單一 utility library。

## Umbra SDK 的開發流程

### 1. 建 client

入口是 `IUmbraClient`，透過 `getUmbraClient` 建立。必備配置包括：

- `signer`
- `network`
- `rpcUrl`
- `rpcSubscriptionsUrl`
- `indexerApiEndpoint`（做 mixer / UTXO 時很重要）

這層最值得注意的是：

- 它不是傳統 class，而是 factory-based client
- 可插入 `masterSeedStorage`、`transactionForwarder`、`accountInfoProvider`
- commitment 採 per-call model，不是 global commitment

### 2. 做 registration

Umbra registration 是多階段且 idempotent：

1. 建 `EncryptedUserAccount`
2. 註冊 X25519 key，啟用 confidential mode
3. 註冊 user commitment，啟用 anonymous mode

黑客松角度來看，這是非常重要的判斷點：

- 如果你只做私密餘額，不一定需要一步做到 anonymous mode
- 若你要做 mixer / truly anonymous transfer，ZK proof 這段就不能省

### 3. 做 shielding / unshielding

Umbra deposit / withdraw 採雙指令模型：

1. queue instruction
2. MPC network callback

所以在產品體驗上，這代表：

- 不是單筆同步完成的傳統 transfer
- 你需要 UI 告訴使用者有 `queueSignature` 和 `callbackSignature`
- 你需要處理 callback status 與中間等待狀態

### 4. 若要做匿名轉帳，再進 mixer

Mixer 路線會再增加：

- 建 UTXO
- 掃描 indexer
- 透過 relayer claim
- 產生 Groth16 proof

這會讓作品非常亮眼，但也明顯增加整合複雜度。

## Umbra SDK 最適合的黑客松作品

### 方案 A：私密金庫 / Private Treasury

最適合的 MVP。

可以做：

- DAO 私密金庫 dashboard
- fund / treasury 私密餘額視圖
- creator-only 可見的資產狀態
- 授權 auditor 檢視局部資產資訊

為什麼適合：

- 不一定要上 mixer
- 只做 confidential balances 就已經很有故事
- 可直接對應「privacy + DeFi + enterprise compliance」敘事

### 方案 B：私密支付 / Private Payroll / Private Commerce

可以做：

- 私密薪資發放
- 私密會員付款
- 私密供應商結算

這條路如果只用 Umbra 也說得通，但若搭配 MagicBlock Private Payments API，會更容易把整體體驗講完整。

### 方案 C：匿名捐款 / 隱私轉帳

如果黑客松評審偏隱私與 cypherpunk 方向，Mixer 會非常吸睛。

但這條路的風險是：

- 需要更多 proof / indexer / relayer 整合
- demo flow 要處理更多等待與掃描細節

## Umbra SDK 的優點

- TypeScript first，對前端或全端隊伍友善
- registration 是 idempotent，適合 hackathon demo 反覆測試
- 支援 viewing grants / compliance 模型，故事完整
- Shared mode 讓 owner 可以本地解密自己的餘額，這對 UX 很重要

## Umbra SDK 的難點

- 不只是「呼叫 API」，你其實是在接一套完整密碼協議
- anonymous mode 需要 ZK proof 與更多基礎設施
- queue / callback 模型增加 UI 與狀態管理複雜度
- 若你產品主題其實是「隱藏邏輯」，Umbra 並不是最好主角

## 2. MagicBlock ER 研究重點

相關研究頁面：

- [ER Core Architecture](https://deepwiki.com/magicblock-labs/docs/2-ephemeral-rollups-%28er%29-core-architecture)
- [Delegation Lifecycle and Transaction Routing](https://deepwiki.com/magicblock-labs/docs/2.1-delegation-lifecycle-and-transaction-routing)
- [ER API Reference](https://deepwiki.com/magicblock-labs/docs/2.6-er-api-reference)
- [Magic Router SDK](https://deepwiki.com/magicblock-labs/docs/5.1-magic-router-sdk)

## ER 是什麼

ER 的核心不是隱私，而是：

- 把特定 account 從 Solana base layer 臨時委派出去
- 在低延遲、高吞吐環境裡執行
- 最後再 commit 回 base layer

核心流程是：

1. `Delegate`
2. `Execute`
3. `Commit`
4. `Undelegate`

這個模型非常適合：

- 即時互動
- 高頻狀態更新
- 遊戲、交易、模擬、即時策略

## ER 對黑客松的價值

ER 最有價值的地方是它讓你可以講出一個很清楚的故事：

> 我們沒有脫離 Solana，但把高頻互動層搬到更快的 execution layer，最後仍然回到 Solana settlement。

這對 hackathon 非常加分，因為評審會同時看到：

- 技術深度
- UX 改善
- 可組合性
- 對 Solana 生態的正面敘事

## Magic Router 為什麼重要

Magic Router 是 ER 真的能用起來的關鍵。因為 base layer 與 ER 的 blockhash progression 不同，如果你還用一般 Solana transaction 流程，很容易失敗。

Magic Router SDK 幫你處理：

- 路由判斷
- blockhash 來源
- delegated account 對應的 validator
- transaction preparation / sending

它的 routing 規則非常重要：

- 全部 writable accounts 都 delegated -> 送 ER
- 全部 writable accounts 都 undelegated -> 送 Solana
- 混合 delegated / undelegated writable accounts -> 失敗

這條規則直接影響你的產品資料模型設計。

## ER 最適合的黑客松作品

### 方案 A：即時策略模擬器

可以做：

- ultra-low-latency rebalance simulator
- on-chain paper trading arena
- 可視化策略對戰

這類作品不一定主打 privacy，但會很適合展示 ER 的低延遲特性。

### 方案 B：遊戲化交易 / 競技型應用

例如：

- speed-based market game
- 即時 prediction / bidding state machine
- 需要大量狀態更新的競技 app

### 方案 C：策略引擎的公開執行層

如果你有一個需要高頻更新但不一定要隱私的策略系統，ER 可以當公開 execution layer，而私密版本再升級成 PER。

## ER 的優點

- 故事好講，demo 體感強
- 跟現有 Solana tooling 相容度高
- Magic Router SDK 明顯降低整合成本
- 對需要頻繁 state transition 的作品很適合

## ER 的難點

- 你必須清楚管理 delegated vs undelegated account 邊界
- undelegation callback 與 lifecycle 不是零成本理解
- 若你的需求其實是 privacy，ER 本身不夠

## 3. MagicBlock PER 研究重點

相關研究頁面：

- [PER Architecture — TEE, Authorization, and Compliance](https://deepwiki.com/magicblock-labs/docs/3.1-per-architecture-tee-authorization-and-compliance)
- [PER Access Control — Permission Program](https://deepwiki.com/magicblock-labs/docs/3.2-per-access-control-permission-program)
- [PER How-To Guides — Quickstart and Private Payments](https://deepwiki.com/magicblock-labs/docs/3.3-per-how-to-guides-quickstart-and-private-payments)

## PER 是什麼

PER 可以看成是 ER 的私密版本：

- 執行還是在 ephemeral rollup 思路下進行
- 但 runtime 被包進 Intel TDX TEE
- 並且用 Permission Program 做細粒度權限管理

所以 PER 的關鍵價值是：

- state 不公開
- tx logs 不公開
- tx message 不公開
- balances 不公開給未授權者
- 只有有權限的人能查、能讀、能操作

## PER 的權限模型為什麼特別適合策略類產品

PER 的 Permission Program 支援多種 member flags，例如：

- `AUTHORITY`
- `TX_LOGS`
- `TX_BALANCES`
- `TX_MESSAGE`
- `ACCOUNT_SIGNATURES`

這比單純「加密 / 不加密」更產品化。你可以做出這種權限分層：

- creator 可看完整策略狀態
- operator 可執行但不能看全部細節
- public viewer 只能看經裁切後的 snapshot
- auditor 可看 logs 或 balances 但不能改參數

這種模型很適合黑客松，因為它能支撐一個很成熟的產品故事。

## PER 的授權流程

PER client 不是直接連上去就能讀，還要做：

1. attestation

2. challenge

3. signer 簽名 challenge

4. 拿到 `authToken`

5. 帶 token 呼叫 TEE RPC

這個流程很重要，因為它是 PER 與普通私有 API 最大的不同點之一：

- 不是伺服器自己說自己是對的
- 而是 client 需要驗證 TEE integrity，再取得 access token

## PER 最適合的黑客松作品

### 方案 A：私密交易策略 / Secret Strategy Vault

這是你目前需求最直接的對應。

可以做：

- 策略 marketplace
- creator-only 可見的 signal engine
- subscriber 只能看績效不能看邏輯
- 私密 vault / portfolio manager

### 方案 B：密封競價 / Sealed-bid 機制

PER 很適合：

- sealed bid auction
- private order intent matching
- confidential negotiation flows

### 方案 C：角色化隱私協作系統

例如：

- 團隊多角色投資決策系統
- 私密風控面板
- 僅授權者可查看的 on-chain execution room

## PER 的優點

- 對「隱藏邏輯」非常強
- 權限模型完整，產品故事成熟
- 可同時滿足 privacy、compliance、selective disclosure 敘事
- 若 demo 做得好，評審會明顯感受到技術難度

## PER 的難點

- 明顯比單純用 API builder 複雜
- 你要理解 Permission Program + Delegation Program + TEE auth flow
- 如果你只有幾天時間，從零把完整 PER integration 做好是有風險的

## 4. Private Payments API 研究重點

相關研究頁面：

- [PER and Private Payments API Reference](https://deepwiki.com/magicblock-labs/docs/3.4-per-and-private-payments-api-reference)
- [PER How-To Guides — Quickstart and Private Payments](https://deepwiki.com/magicblock-labs/docs/3.3-per-how-to-guides-quickstart-and-private-payments)

## Private Payments API 是什麼

Private Payments API 本質上是 MagicBlock 在 `PER + private SPL flow` 上提供的高階 API 層。

它暴露的核心 endpoint 很清楚：

- `POST /deposit`
- `POST /transfer`
- `POST /withdraw`
- `GET /balance`
- `GET /private-balance`
- `POST /initialize-mint`

而且 transaction endpoint 會回傳 `base64` unsigned transaction，這對黑客松特別友善，因為你可以很快把：

- server side builder
- wallet signing
- transaction broadcast

串成完整 demo。

## 它為什麼很適合黑客松

因為它讓你不用一開始就從最底層自己處理所有 SPL / permission / ephemeral ATA 細節。

你還是站在 PER 上，但開發體驗已經更接近產品 API，而不是 protocol internals。

它同時保留了很強的敘事價值：

- private transfer
- private deposit
- private withdraw
- private balance query

對評審來說，非常容易懂，也非常容易 demo。

## Private Payments API 需要理解的底層概念

雖然它是高階 API，但仍有一些核心概念不能忽略：

- `Global Vault`
- `Ephemeral ATA`
- permission creation / delegation
- mint initialization
- private / base balance distinction

也就是說，它不是完全黑盒。你仍然要知道資產在 base layer 與 ephemeral layer 怎麼移動，才能設計正確 UI 與資料模型。

## Private Payments API 最適合的黑客松作品

### 方案 A：私密錢包

最直觀。

可以做：

- private send / receive wallet
- public balance vs private balance 雙視圖
- selective reveal demo

### 方案 B：私密收款 / Commerce

可以做：

- 商家私密收款
- 會員制 private checkout
- creator private tip / subscription paywall

### 方案 C：私密策略金庫前端

如果你想做策略題目，但 PER 整合太重，可以先用 Private Payments API 做：

- creator 把資金存進私密池
- viewer 看到的是 public snapshot
- owner 看到的是 private-balance

這樣已經足以做出「策略 / vault / private treasury」的第一版故事。

## 5. 技術比較：黑客松到底該選哪條路

## 如果你的目標是最快做出強 demo

首選：`Private Payments API`

理由：

- 概念直觀
- demo 明確
- 可快速做前端
- 有 privacy 敘事
- 不必一開始就從最底層 SDK / CPI 打起

## 如果你的目標是做低延遲互動型作品

首選：`ER + Magic Router SDK`

理由：

- 可以明確展示 latency / routing / delegated execution
- 適合遊戲、即時策略、互動型 app

## 如果你的目標是做「邏輯不可見」的高技術作品

首選：`PER`

理由：

- 真正解「私密執行」
- 適合策略、密封邏輯、permissioned visibility

## 如果你的目標是做最純的隱私資產產品

首選：`Umbra SDK`

理由：

- 真正有 encrypted balances、mixer、viewing grants
- 隱私敘事完整

## 6. 對你目前方向的實際建議

如果你現在還是想做「策略可見，但運作方式不可見」，我會這樣建議：

### 最佳技術排序

1. `MagicBlock PER`
2. `MagicBlock Private Payments API`
3. `Umbra SDK`
4. `MagicBlock ER`

這個排序不是依照技術厲害程度，而是依照你這個題目本身的吻合度。

### 為什麼這樣排

- `PER` 最能藏住策略邏輯
- `Private Payments API` 最能快速做出策略金庫 / 私密資金層 demo
- `Umbra SDK` 可把資金層隱私再補強，但不是保護策略邏輯的核心
- `ER` 比較偏效能與 execution，而不是邏輯隱私

## 我最推薦的黑客松方案

### 方案 1：Private Strategy Vault

技術組合：

- `PER` 保護策略 state
- `Private Payments API` 保護資金存取
- `public snapshot` 提供外部可見績效

評審聽得懂的版本：

> 一個策略 vault，所有人都能看到績效與風險，但只有 creator 能看實際邏輯與私密持倉。

### 方案 2：Private Treasury Copilot

技術組合：

- `Private Payments API`
- `Umbra SDK`

評審聽得懂的版本：

> 一個私密金庫與付款系統，企業或 DAO 可隱藏資產與支付流，但仍保留授權揭露能力。

### 方案 3：Realtime Private Trading Room

技術組合：

- `ER` 做即時 execution
- `PER` 做私密 mode
- optional `Umbra` 做資產隱私

這個方案最帥，但也是最重。

## 7. 風險評估

## 最容易翻車的點

### 1. 一次整合太多層

如果你同時想把：

- ER
- PER
- Private Payments API
- Umbra mixer

全部做滿，黑客松時間很容易不夠。

### 2. 把 privacy 問題想成只有加密

真正困難的是：

- 哪些資料公開
- 哪些資料私密
- 誰能看哪一層
- UI 怎麼呈現 queue / callback / auth token / delegated state

### 3. 忽略 UX

這幾套技術都不是單步同步成功模型。若 UI 沒把：

- waiting state
- callback state
- private vs public balance
- authorization flow

講清楚，demo 會很混亂。

## 8. 我對黑客松路線的最終建議

若你要的是一個最有勝率的路線，我會建議：

### 勝率最高路線

`Private Payments API + 小範圍 PER 敘事`

原因：

- 能很快做出可展示功能
- 有很強的 privacy 敘事
- 不需要一開始就做完整底層整合
- 之後還能擴充成策略 vault 或私密策略 app

### 技術最亮眼路線

`PER + Public Strategy Snapshot`

原因：

- 最符合你目前主題
- 「可見但不可抄」這個故事很有辨識度
- 能明確使用 MagicBlock 的私密 execution 能力

### 最純隱私金融路線

`Umbra SDK`

原因：

- 最貼近 encrypted balances / anonymous transfer / compliance grant
- 對 privacy-native judges 很有吸引力

## 結論

如果用一句話總結這次研究：

- `Umbra SDK` 是隱私資產協議工具箱
- `MagicBlock ER` 是高性能執行層
- `MagicBlock PER` 是私密執行層
- `Private Payments API` 是最適合黑客松快速交付的私密支付產品面 API

如果你的作品主題繼續圍繞「策略、可見性、不可抄襲、私密資金」，那最合理的選擇是：

> 用 `PER` 保護邏輯，用 `Private Payments API` 加速資金層 demo，必要時再用 `Umbra SDK` 補強資產隱私。
