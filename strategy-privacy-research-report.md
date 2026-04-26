# 使用 MagicBlock 與 Umbra 隱藏策略運作方式的研究報告

## 研究目標

你的需求可以拆成一句話：

> 讓 creator 以外的使用者知道「有這個策略、可以跟單或觀看結果」，但無法得知策略的內部規則、參數、執行細節與私密資產流向。

根據對 `magicblock-labs/docs` 與 `umbra-defi/docs` 的定向研究，這兩個 repo 解決的是不同層級的隱私問題：

- `MagicBlock PER` 比較像是「私密執行層」，重點在隱藏狀態、交易內容、執行 log 與權限存取。
- `Umbra` 比較像是「私密資產層」，重點在隱藏金額、私密餘額、匿名資產流，以及授權式揭露。

因此，如果你的核心目標是「別人看得到策略，但看不到策略怎麼做決策」，主體應該是 **MagicBlock PER**；`Umbra` 則應該作為 **策略資金與餘額隱私** 的補強層，而不是單獨拿來保護策略邏輯。

## TL;DR

- 最適合的主架構是：**公開策略展示層 + MagicBlock PER 私密策略執行層 + Umbra 私密資產層**。
- `MagicBlock PER` 可把策略的私密 state、交易 message、tx logs、餘額變化放進 TEE 保護，並用 Permission Program 決定誰能看。
- `Umbra` 可把策略資金放進 Encrypted Token Account，讓外部只能看到有限的鏈上痕跡，但看不到實際餘額或完整資產流。
- 如果只用 `Umbra`，你可以隱藏資產與部分轉帳資訊，但 **無法真正隱藏策略執行邏輯**。
- 如果只用 `MagicBlock PER`，你可以隱藏執行與狀態，但若資金仍在公開帳戶或公開結算，外部還是可能從持倉與轉帳結果反推出策略。

## 兩個 repo 各自提供什麼

## MagicBlock：適合保護策略執行邏輯

從 `MagicBlock` 文件來看，Private Ephemeral Rollups (`PER`) 的重點是把執行環境放進 Intel TDX 的 TEE 內，讓 validator 主機本身也無法查看 rollup 記憶體與 state。這個模型特別適合保護：

- 策略參數
- 策略訊號計算過程
- 內部 rebalance 規則
- 未公開持倉狀態
- 交易 message 與執行 logs
- 私密帳戶餘額與變化

相關頁面：

- [PER Overview](https://deepwiki.com/magicblock-labs/docs/3-private-ephemeral-rollups-%28per%29-on-chain-privacy)
- [PER Architecture — TEE, Authorization, and Compliance](https://deepwiki.com/magicblock-labs/docs/3.1-per-architecture-tee-authorization-and-compliance)
- [PER Access Control — Permission Program](https://deepwiki.com/magicblock-labs/docs/3.2-per-access-control-permission-program)
- [PER How-To Guides — Quickstart and Private Payments](https://deepwiki.com/magicblock-labs/docs/3.3-per-how-to-guides-quickstart-and-private-payments)

### MagicBlock 對你需求最有價值的點

1. **TEE 內私密執行**

PER 使用 Intel TDX，把執行環境與 state 包在硬體隔離區內。對你的需求來說，這代表策略核心邏輯不需要暴露在一般公開執行環境裡。

2. **Permission Program 可精細控制誰能看什麼**

MagicBlock 的 Permission Program 可為 member 指定 flag，例如：

- `AUTHORITY`
- `TX_LOGS`
- `TX_BALANCES`
- `TX_MESSAGE`
- `ACCOUNT_SIGNATURES`

這很重要，因為你的需求不是「所有人都看不到」，而是「creator 可以看、其他人不可以看」。這正是 ACL / permission group 模型能處理的場景。

3. **可把公開展示與私密執行拆開**

你可以把策略卡片、名稱、收益曲線、風險等級、訂閱狀態放在公開層，但把策略真實執行 state 放到 delegated private account 中。這樣使用者看得到「策略存在與結果」，卻看不到策略如何運作。

4. **支援即時權限變更**

文件提到 delegated account 在 PER 執行時，權限更新可即時生效。這代表你可以：

- 新增 creator 的裝置/服務帳號
- 撤銷某個 viewer 或 operator 權限
- 讓策略從私密模式切回公開模式

### MagicBlock 的限制

- 它保護的是 **執行與 state**，不是自動替你設計「公開可見但不可逆向」的產品模型。
- 如果你把太多績效細節、交易結果、持倉快照直接公開，外部仍可從輸出反推出策略。
- PER 的信任模型包含對 Intel TDX / 硬體供應鏈的信任，這不是純密碼學式的 trustless privacy。

## Umbra：適合保護策略資金與選擇性揭露

Umbra 的重點是私密資產。它把餘額存在 Encrypted Token Account (`ETA`) 中，並使用 Arcium MPC、X25519、Rescue cipher 與 Groth16 等機制處理 confidential balances 與 mixer。

相關頁面：

- [Core Concepts](https://deepwiki.com/umbra-defi/docs/1.2-core-concepts)
- [Encrypted Balances](https://deepwiki.com/umbra-defi/docs/1.2.1-encrypted-balances)
- [Querying Account State](https://deepwiki.com/umbra-defi/docs/2.5-querying-account-state)
- [Compliance and Viewing Keys](https://deepwiki.com/umbra-defi/docs/2.6-compliance-and-viewing-keys)

### Umbra 對你需求最有價值的點

1. **策略資金可放在加密餘額中**

如果策略金庫、子策略倉位或收益池使用 Umbra 的 ETA，外部無法直接從鏈上看到真實餘額。

2. **Shared Mode 很適合 creator 本地查看私密資產**

Umbra 的 Shared Mode 會同時用 Arcium key 與使用者的 X25519 public key 加密，代表 creator 可在 client 端本地解密自己的餘額，不必把資訊公開給其他人。

3. **Compliance Grants / Viewing Keys 可做選擇性揭露**

如果未來你想讓：

- auditor
- 特定投資人
- 風控服務
- 內部營運人員

在不拿到 creator 主私鑰的前提下查看部分資料，Umbra 已有 viewing grants 的概念可用。

4. **可支援「只公開成果，不公開資金細節」**

你可以公開策略淨值、收益率、某些經過聚合的統計數字，但不公開底層 ETA 真實餘額與細部金流。

### Umbra 的限制

- Umbra 主要保護的是 **餘額與轉帳隱私**，不是策略運算邏輯本身。
- 文件明確指出隱私有邊界。對 Encrypted Balances 來說，`wallet address`、`mint`、`transaction timing` 仍可能是公開訊號。
- Mixer 模式能切斷 sender/receiver link，但 deposit / withdraw amount 與 timing 仍可能暴露部分訊號。
- Compliance grant 一旦讓對方解出資料，之後 revoke 只能阻止未來再解密，不能把已經看過的資訊收回。

## 哪一層該用哪個技術

| 需求 | 最適合的方案 | 理由 |
| --- | --- | --- |
| 隱藏策略規則 / 參數 / 計算過程 | MagicBlock PER | 它保護執行環境、state、tx message、tx logs |
| 隱藏策略資金餘額 | Umbra ETA | 它保護 encrypted balances |
| 只讓 creator 看私密資訊 | MagicBlock Permission + Umbra Shared Mode | 一個管執行層權限，一個管資產層解密 |
| 讓 auditor 看部分資料 | Umbra Viewing Grants 或 MagicBlock member flags | 可授權式開放讀取權限 |
| 讓一般使用者看到策略存在、績效、風險 | 公開 metadata / snapshot account | 不應直接暴露 private state |

## 建議架構

我會建議你把系統拆成 3 層：

### 1. 公開策略展示層

這一層給一般使用者看，可以公開：

- 策略名稱
- creator 身分
- 策略簡介
- 風險等級
- 歷史績效摘要
- 訂閱價格 / 可跟單狀態
- 經過刻意降維的公開 metrics

這一層 **不要** 放：

- 原始交易訊號
- 持倉細節
- 策略參數
- 真實 rebalance 規則
- 未經處理的交易紀錄

### 2. 私密策略執行層（MagicBlock PER）

這一層放真正的策略 engine 與 state，例如：

- 參數權重
- 進出場門檻
- 倉位計算中間值
- 市場資料處理結果
- 訂單決策原因
- 交易 logs / tx messages

建議做法：

- 為每個策略建立一個 `strategy_private_state` account。
- 使用 Permission Program 建立 permission group。
- 只把 creator 與必要的 operator / backend signer 放進 group。
- creator 持有 `AUTHORITY`，必要時再給自己 `TX_LOGS`、`TX_MESSAGE`、`TX_BALANCES`。
- 一般使用者不加入 permission group。

然後把這個 state account delegate 到 PER，讓策略執行發生在 TEE 裡。

### 3. 私密資產層（Umbra）

如果策略真的要保護資產層，建議把策略金庫或策略專用資產帳戶轉成 Umbra 的 ETA：

- creator / strategy operator 使用 Shared Mode
- 一般使用者不擁有解密權
- auditor 或特定角色透過 compliance grants 取得有限可見性

這樣可以避免外部從公開 token account 直接推算策略規模與調倉節奏。

## 你真正應該怎麼做

以下是比較實務的落地順序。

### 階段 1：先定義哪些資料一定要保密

先把策略資料拆成兩類：

- `public`：名稱、介紹、風險、摘要績效、可見的總報酬區間
- `private`：規則、參數、權重、訊號來源、中間計算值、未公開倉位、交易 message、tx logs、私密餘額

這一步很重要，因為若你不先做資料分類，就很容易把 PER 裡的機密資訊又在 public API 中重新暴露出去。

### 階段 2：用 MagicBlock PER 包住策略 state 與執行

技術上你要做的是：

1. 在你的策略 program / account lifecycle 中加入 Permission Program 與 Delegation Program。
2. 建立 permission account 與 member list。
3. 把策略私密 state delegate 到 TEE validator。
4. client 或 backend signer 先做 challenge-response，拿到 `authToken`。
5. 後續私密策略操作走 PER RPC endpoint。

這一段對應的文件線索很清楚，MagicBlock 已經有：

- 建 permission
- delegate permissioned account
- auth token flow
- undelegate / commit back

你不需要自己發明整套機制。

### 階段 3：另外做一個公開 snapshot，而不是直接公開私密 state

這是整個設計最關鍵的一步。

如果你把私密策略 state 直接暴露給 UI 或 indexer，就算底層有 TEE 也沒有意義。正確做法是：

- 私密 state 在 PER 中持有完整資料
- 另外產生一個 public snapshot account 或 off-chain cached view
- 只輸出經過裁切的資訊給一般使用者

例如只輸出：

- 今天報酬率
- 七日績效
- 當前風險分數
- 是否開倉

不要輸出：

- 具體倉位比例
- 觸發訊號值
- 即時成交細節
- 原始下單參數

### 階段 4：若要保護策略資金，再接 Umbra

若你只有「不想讓別人抄策略邏輯」而不在意資金資訊，其實做到階段 3 就已經有很大效果。

但若你也不想讓人從鏈上觀察：

- 策略資金規模
- 調倉頻率
- 每次移動多少金額

那就要把策略 treasury 或部分資金操作切到 Umbra：

- 用 ETA 取代公開 ATA 作為私密資產帳戶
- creator 使用 Shared Mode 看自己的私密餘額
- 必要時對 auditor 開 compliance grant

### 階段 5：把「可見性」設計成產品能力

你的需求本質上不是單純加密，而是「分層可見性」。我建議直接在產品上定義幾種角色：

- `creator`
- `subscriber`
- `public viewer`
- `auditor`
- `operator`

然後對應到兩套機制：

- `MagicBlock member flags` 控制執行層可見性
- `Umbra grants / viewing keys` 控制資產層可見性

## 最推薦的方案

### 方案 A：MagicBlock 為主，Umbra 為輔

這是我最推薦的方案。

適用情境：

- 你最在意策略邏輯不被抄
- 同時也希望部分資金資訊不要被看到
- 願意接受 TEE trust model

做法：

- 用 MagicBlock PER 隱藏策略 state 與執行
- 用 Umbra ETA 隱藏策略資金與餘額
- 對外只暴露 public snapshot

優點：

- 最符合你的需求
- 執行邏輯與資產流都能保護
- 還能保留 selective disclosure 能力

缺點：

- 系統複雜度最高
- 權限模型要設計得很清楚
- client / backend 需要同時整合兩套隱私能力

### 方案 B：只用 MagicBlock PER

適用情境：

- 你主要是防止策略邏輯被抄
- 資金透明度不是最主要問題

做法：

- 所有策略內部 state 與執行放進 PER
- 只公開經裁切的 snapshot

優點：

- 架構比較簡單
- 對「保護策略邏輯」最直接

缺點：

- 若實際資金仍在公開 token account，別人還是可能從結果推估策略行為

### 方案 C：只用 Umbra

我不推薦把這個當主方案。

適用情境：

- 你只想保護資產與金流
- 不在意策略邏輯是否可能被觀察或推斷

缺點很明確：

- 無法完整保護策略運算邏輯
- 不能取代私密執行環境

## 重要風險與設計邊界

### 1. 輸出洩漏比執行洩漏更常見

就算策略在 PER 裡執行，如果你對外公開：

- 即時持倉
- 細粒度績效時間序列
- 每次下單結果
- 即時風險參數

外部仍可能逆向出你的策略。

### 2. Umbra 不是完全不可觀測

Umbra 已明確區分 hidden 與 public 邊界。地址、mint、時間等訊號仍可能被看到，因此它更適合保護資產內容，而不是保護整個策略存在本身。

### 3. Viewing Grants 不是可回收的秘密

一旦授權某人成功看過資料，revocation 只能阻止未來再次解密，不能讓對方忘記已取得的資訊。

### 4. PER 權限設定錯誤會直接破功

MagicBlock 文件提到若把 member list 更新成 `None`，帳戶可能會暫時變公開。這表示 ACL 更新流程一定要非常嚴謹。

### 5. 你仍需設計「公開證明」策略

如果使用者不能看策略細節，他們通常會要求看：

- 績效證明
- 資產安全性
- 是否真的有下單
- 是否存在作弊或假績效

所以你需要額外設計一套「公開但不可反推邏輯」的證明資料，例如聚合後績效、延遲揭露、區間化 exposure、經過裁切的 audit view。

## 建議的最小可行實作（MVP）

若你要先做第一版，我建議不要一開始就把所有隱私功能都做滿，而是走這個順序：

1. 先用 `MagicBlock PER` 保護策略 state 與執行。
2. 建立 `public strategy snapshot`，只暴露少量可展示資訊。
3. 先不做 Umbra mixer，僅在需要保護 treasury 時導入 `Umbra ETA Shared Mode`。
4. 等你真的有 audit / investor disclosure 需求，再加 `Umbra compliance grants`。

這樣可以先用最少複雜度解掉「策略可見但不可抄」的核心問題。

## 結論

如果你的目標是：

> creator 以外的人可以看到策略存在、可以看到結果、甚至可以使用，但不能知道策略如何運作

那最佳答案不是單用其中一個 repo，而是：

- **用 MagicBlock PER 保護策略邏輯、state、交易 message、tx logs 與權限可見性**
- **用 Umbra 保護策略金庫、私密餘額與授權式揭露**
- **另外做一層公開 snapshot，專門提供「能看但看不穿」的資料**

一句話總結：

> `MagicBlock` 負責藏住「策略怎麼做」，`Umbra` 負責藏住「策略裡有多少錢、錢怎麼流」，而你的產品層要負責決定「外界到底能看到多少結果」。
