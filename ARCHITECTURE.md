# PinTool 完整系统架构总览

> 最后更新：2026-05-05
> 项目定位：基于 Solana 的 Web3 策略/工作流自动化平台，支持创作者发布策略、追随者订阅跟投、链下高频执行 + 链上状态承诺的混合架构。

---

## 一、高层架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户层 (User Layer)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Creator    │  │  Follower    │  │   Agent/API  │  │ Admin/运营   │    │
│  │  (策略创作者) │  │  (策略追随者) │  │  (程序化访问) │  │ (管理后台)   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              应用层 (Application Layer)                      │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    frontend-admin (Next.js 14+)                      │   │
│   │  · 两步式 Admin 登录 (email/password + TOTP)                        │   │
│   │  · BFF 模式：/api/admin/* → backend /admin/*                        │   │
│   │  · 国际化：en / zh-TW                                              │   │
│   │  · Playwright E2E 测试                                             │   │
│   │  · 端口：localhost:3100                                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    PinTool Backend (NestJS 10)                       │   │
│   │  · REST API + Swagger (/api/docs)                                   │   │
│   │  · 全局限流 (Throttler)                                             │   │
│   │  · 多模态认证：Wallet Signature / API Key / Supabase Bearer         │   │
│   │  · 端口：localhost:3000                                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Legacy Workflow Runner (TS CLI)                   │   │
│   │  · 独立运行：npm run workflow                                       │   │
│   │  · JSON 配置驱动，无需后端                                          │   │
│   │  · 支持 PriceFeed / Swap / Kamino / X402 等节点                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           服务层 (Service Layer)                             │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │   Auth 认证   │ │  Workflows   │ │  Strategies  │ │  Deployments │        │
│  │  · Challenge │ │  · CRUD      │ │  · 策略管理   │ │  · 部署生命周期│       │
│  │  · Login     │ │  · 执行引擎   │ │  · 权限控制   │ │  · 版本管理   │        │
│  │  · Supabase  │ │  · 生命周期   │ │  · 编译/验证  │ │  · 状态机     │        │
│  │    JWT 校验  │ │  · Telegram  │ │              │ │              │        │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │FollowerVaults│ │  Workflow-AI │ │   Referral   │ │  Crossmint   │        │
│  │  · 订阅管理   │ │  · AI 对话生成│ │  · 推荐码系统 │ │  · 托管钱包   │        │
│  │  · 资金意向   │ │    工作流     │ │  · 配额管理   │ │  · 钱包初始化 │        │
│  │  · 隐私执行   │ │  · SSE 流式  │ │  · 兑换逻辑   │ │  · 提款/关闭  │        │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │   Web3 节点   │ │   Strategy   │ │  MagicBlock  │ │    Umbra     │        │
│  │  · 11 种节点  │ │   Keeper     │ │  · ER 适配器  │ │  · 加密客户端 │        │
│  │  · Jupiter   │ │  · 执行调度   │ │  · PER 适配器 │ │  · 部署签名   │        │
│  │  · Kamino    │ │  · 状态提交   │ │  · 隐私支付   │ │  · 隐私状态   │        │
│  │  · Pyth/Drift│ │              │ │  · 委托/解委托│ │              │        │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                        │
│  │    Onchain    │ │  Telegram    │ │ Observability│                        │
│  │  · Anchor 客户端│ │  · Bot 服务  │ │  · Metrics   │                        │
│  │  · Keeper 密钥 │ │  · 通知推送  │ │  · Health    │                        │
│  │  · 链上适配器  │ │  · Webhook   │ │  · 监控      │                        │
│  └──────────────┘ └──────────────┘ └──────────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           数据层 (Data Layer)                                │
│                                                                             │
│   ┌─────────────────────────────┐   ┌─────────────────────────────────────┐ │
│   │    PostgreSQL (Supabase)     │   │   外部状态 / 缓存                    │ │
│   │  · users, accounts           │   │   · MagicBlock ER (高频执行状态)     │ │
│   │  · workflows, executions     │   │   · MagicBlock PER (TEE 逻辑)        │ │
│   │  · strategies, deployments   │   │   · Umbra (加密余额/隐私支付)        │ │
│   │  · follower_vaults, subs     │   │   · Pyth (价格预言机)                │ │
│   │  · transactions, referrals   │   │   · Helius (Webhook/索引)            │ │
│   │  · telegram_mappings         │   │   · Crossmint (托管钱包 API)         │ │
│   │  · RLS 行级安全               │   │                                     │ │
│   └─────────────────────────────┘   └─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           链上层 (On-Chain Layer)                            │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │        strategy_runtime (Anchor 0.32.1)                              │   │
│   │                                                                     │   │
│   │   PDAs:                                                             │   │
│   │   · StrategyVersion        — 策略版本承诺 (metadata_hash, definition_commitment)│   │
│   │   · StrategyDeployment ⭐   — 部署实例 (lifecycle, keeper, execution_mode)     │   │
│   │   · StrategyState          — 私有状态指针 (revision, commitment)               │   │
│   │   · VaultAuthority         — 资产托管权限壳                                      │   │
│   │   · PublicSnapshot         — 公开排行榜数据 (PnL, risk_band)                     │   │
│   │   · StrategySubscription   — 追随者订阅锚                                        │   │
│   │   · FollowerVault          — 追随者资金控制壳                                    │   │
│   │   · FollowerVaultAuthority — 追随者级权限                                        │   │
│   │                                                                     │   │
│   │   核心设计：                                                          │   │
│   │   · Anchor 是「状态机 + 委托 harness」，不是资金托管方                           │   │
│   │   · 策略逻辑和余额在链下 (MagicBlock PER / Umbra)                                │   │
│   │   · 链上只存 32-byte commitment，不存加密 blob                                   │   │
│   │   · Keeper 是独立签名者，不是创作者私钥                                          │   │
│   │   · ER 支持 sub-second 执行循环 + MagicIntentBundle 回写                         │   │
│   │                                                                     │   │
│   │   Program ID: FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF (devnet)            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │        Solana DeFi 协议集成                                          │   │
│   │   · Jupiter Aggregator — Swap / LimitOrder / Stake                  │   │
│   │   · Kamino Finance     — Lending vault deposit/withdraw             │   │
│   │   · Drift Protocol     — Perpetual trading                          │   │
│   │   · Lulo Finance       — Lending (API key 保护)                     │   │
│   │   · Sanctum            — LST operations (API key 保护)              │   │
│   │   · Pyth Network       — Price feeds                                │   │
│   │   · Orca / Raydium     — DEX (通过 AgentKit / CPI)                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、项目目录结构

```
app-backend/                          # 项目根目录
├── README.md                         # 根项目说明 (Legacy 工作流)
├── package.json                      # 根 package.json (Legacy 脚本)
├── tsconfig.json
├── .env.example
│
├── backend/                          # ⭐ NestJS 主后端
│   ├── src/
│   │   ├── app.module.ts             # 根模块 (导入 15+ 业务模块)
│   │   ├── main.ts                   # 应用入口
│   │   │
│   │   ├── auth/                     # 钱包签名认证
│   │   │   ├── auth.controller.ts    # POST /auth/challenge, /auth/login
│   │   │   ├── auth.service.ts
│   │   │   └── supabase-jwt-verifier.service.ts
│   │   │
│   │   ├── admin/                    # 管理后台 API
│   │   │   ├── auth/                 # Admin JWT 登录/验证
│   │   │   ├── users/                # 用户管理
│   │   │   ├── strategies/           # 策略审核
│   │   │   ├── deployments/          # 部署管理
│   │   │   ├── executions/           # 执行记录
│   │   │   ├── ops/                  # 运营操作
│   │   │   ├── audit/                # 审计日志
│   │   │   ├── system/               # 系统状态
│   │   │   ├── overview/             # 数据概览
│   │   │   └── privacy/              # 隐私合规
│   │   │
│   │   ├── agent/                    # Agent API (API Key 认证)
│   │   │   ├── agent.controller.ts   # /agent/register, /workflows, /wallets
│   │   │   └── agent.service.ts
│   │   │
│   │   ├── workflows/                # 旧版工作流 CRUD + 执行
│   │   │   ├── workflows.controller.ts
│   │   │   ├── workflows.service.ts
│   │   │   └── workflow-lifecycle.service.ts
│   │   │
│   │   ├── strategies/               # 策略内容管理
│   │   │   ├── strategies.controller.ts
│   │   │   ├── strategies.service.ts
│   │   │   └── strategy-permissions.service.ts
│   │   │
│   │   ├── strategy-deployments/     # 策略部署生命周期
│   │   │   ├── strategy-deployments.controller.ts
│   │   │   └── strategy-deployments.service.ts
│   │   │
│   │   ├── strategy-compiler/        # 策略 IR 编译/验证
│   │   │   └── strategy-compiler.service.ts
│   │   │
│   │   ├── strategy-keeper/          # 链下 Keeper 执行调度
│   │   │   ├── strategy-keeper.service.ts
│   │   │   └── strategy-runs.service.ts
│   │   │
│   │   ├── follower-vaults/          # 追随者订阅 + 资金库
│   │   │   ├── subscriptions.controller.ts
│   │   │   ├── subscriptions.service.ts
│   │   │   ├── my-subscriptions.controller.ts
│   │   │   ├── fund-intent-submission.service.ts
│   │   │   ├── private-execution-cycles.controller.ts
│   │   │   ├── private-execution-cycles.service.ts
│   │   │   ├── follower-vault-allocations.service.ts
│   │   │   ├── follower-vault-signer.service.ts
│   │   │   └── follower-visibility-policy.service.ts
│   │   │
│   │   ├── workflow-ai/              # AI 生成工作流 (SSE 流式)
│   │   │   ├── workflow-ai.controller.ts
│   │   │   ├── workflow-ai.service.ts
│   │   │   ├── conversation-store.service.ts
│   │   │   ├── prompt-builder.service.ts
│   │   │   └── workflow-validator.service.ts
│   │   │
│   │   ├── web3/                     # Solana Web3 节点与服务
│   │   │   ├── nodes/                # 11 种工作流节点实现
│   │   │   ├── services/             # AgentKit, Kamino, Jupiter, Token, Tx
│   │   │   ├── types/                # Web3 类型定义
│   │   │   └── utils/                # 工具函数
│   │   │
│   │   ├── crossmint/                # Crossmint 托管钱包
│   │   │   ├── crossmint.controller.ts
│   │   │   └── crossmint.service.ts
│   │   │
│   │   ├── referral/                 # 推荐码系统
│   │   │   ├── referral.controller.ts
│   │   │   ├── referral.service.ts
│   │   │   └── referral-code-generator.service.ts
│   │   │
│   │   ├── telegram/                 # Telegram Bot + 通知
│   │   │   ├── telegram.controller.ts
│   │   │   ├── telegram-bot.service.ts
│   │   │   └── telegram-notifier.service.ts
│   │   │
│   │   ├── onchain/                  # Anchor 链上交互
│   │   │   ├── anchor-client.service.ts
│   │   │   ├── anchor-onchain-adapter.service.ts
│   │   │   ├── noop-onchain-adapter.service.ts
│   │   │   └── keeper-keypair.service.ts
│   │   │
│   │   ├── magicblock/               # MagicBlock ER/PER/隐私支付
│   │   │   ├── magicblock-client.service.ts
│   │   │   ├── magicblock-per-client.service.ts
│   │   │   ├── magicblock-private-payments-client.service.ts
│   │   │   └── magicblock-noop.service.ts
│   │   │
│   │   ├── umbra/                    # Umbra 加密基础设施
│   │   │   ├── umbra-client.service.ts
│   │   │   ├── umbra-deployment-signer.service.ts
│   │   │   └── umbra-noop.service.ts
│   │   │
│   │   ├── database/                 # Supabase 数据库服务
│   │   │   ├── supabase.service.ts
│   │   │   ├── schema/               # SQL schema 文件
│   │   │   └── functions/            # 数据库函数
│   │   │
│   │   ├── config/                   # 运行时配置
│   │   │   ├── runtime-config.module.ts
│   │   │   └── runtime-config.service.ts
│   │   │
│   │   ├── common/                   # 通用设施
│   │   │   ├── guards/               # 路由守卫
│   │   │   ├── filters/              # 异常过滤器
│   │   │   ├── interceptors/         # 拦截器
│   │   │   └── decorators/           # 装饰器
│   │   │
│   │   ├── health/                   # 健康检查
│   │   └── observability/            # 指标监控
│   │
│   ├── supabase/migrations/          # 数据库迁移文件
│   ├── package.json
│   └── .env.example
│
├── frontend-admin/                   # ⭐ Next.js 14 管理后台
│   ├── app/                          # App Router
│   ├── components/
│   ├── lib/
│   ├── messages/                     # next-intl 翻译文件 (en, zh-TW)
│   ├── tests/                        # Playwright E2E
│   ├── package.json
│   └── .env.example
│
├── programs/                         # ⭐ Anchor 链上程序
│   ├── Anchor.toml
│   ├── Cargo.toml                    # Workspace
│   ├── programs/
│   │   └── strategy_runtime/         # Rust 程序源码
│   │       ├── Cargo.toml
│   │       └── src/
│   │           ├── lib.rs            # 入口 + IX 路由
│   │           ├── constants.rs      # PDA seeds
│   │           ├── errors.rs         # 自定义错误码
│   │           ├── state/            # 7 个 Account 结构体
│   │           └── instructions/     # 20+ 指令处理器
│   └── tests/
│       └── strategy_runtime.spec.ts  # ts-mocha 集成测试
│
├── database/
│   └── initial.sql                   # 核心表结构参考 (users, workflows, accounts...)
│
├── docs/
│   └── NODES_REFERENCE.md            # 11 种工作流节点完整参考文档
│
├── workflows/                        # Legacy 工作流 JSON 配置示例
│   └── price-trigger-swap.json
│
├── src-legacy/                       # Legacy 独立工作流引擎 (TS CLI)
│   ├── nodes/                        # PriceFeedNode, SwapNode, KaminoNode...
│   ├── utils/                        # price-monitor, jupiter-swap, token
│   ├── workflow-executor.ts          # 执行引擎
│   ├── run-workflow.ts               # CLI 入口
│   └── web3-workflow-types.ts        # 类型定义
│
└── .agents/skills/                   # AI Agent Skills
    ├── solana-dev/                   # Solana 开发技能
    ├── supabase/                     # Supabase 技能
    ├── magicblock/                   # MagicBlock ER 技能
    └── ...
```

---

## 三、核心模块详解

### 3.1 认证体系 (Auth)

| 认证方式 | 适用场景 | 机制 |
|---------|---------|------|
| **Wallet Signature** | 普通用户登录 | 后端发 challenge → 用户签名 → 后端验签 → 返回 Supabase JWT |
| **API Key** | Agent/程序化访问 | `X-API-Key` header，用于 `/agent/*` 端点 |
| **Supabase Bearer** | 前端用户请求 | `Authorization: Bearer <token>`，Supabase JWT 验证 |
| **Admin JWT** | 管理后台 | 独立 JWT secret，HTTP-only cookie 存储 |

### 3.2 策略生命周期 (Strategy Lifecycle)

```
创作者端:
  策略草稿 → 发布版本 (StrategyVersion) → 部署 (StrategyDeployment)
  
部署状态机:
  Draft ──▶ Deployed ──▶ Paused ──▶ Deployed
                  │            │
                  ▼            ▼
                Stopped ────────
                  │
                  ▼
                Closed

追随者端:
  PendingFunding ──▶ Active ──▶ Paused ──▶ Active
        │               │          │
        │               ▼          ▼
        │            Exiting ────────
        │               │
        ▼               ▼
       Closed        Closed
```

### 3.3 执行模式 (Execution Modes)

| 模式 | 说明 | 技术栈 |
|-----|------|--------|
| **Off-chain** | 传统后端执行 | NestJS + Solana RPC |
| **ER** (Ephemeral Rollups) | 高频 sub-second 循环 | MagicBlock ER + 委托状态 |
| **PER** (Persistent ER) | TEE 内策略逻辑 | MagicBlock PER + 权限组 |

### 3.4 资金托管模式 (Custody Modes)

| 模式 | 值 | 说明 |
|-----|---|------|
| **Program Owned** | 0 | 程序 PDA 托管，追随者通过链下 wrapper 签名存取 |
| **Self Custody** | 1 | 追随者自持密钥 |
| **Private Payments Relay** | 2 | Umbra 加密余额 + 隐私支付中继 |

### 3.5 工作流节点 (11 种)

| 节点 | Key | 需要 API Key | 功能 |
|-----|-----|:----------:|------|
| Pyth Price Feed | `pythPriceFeed` | ❌ | 价格监控触发 |
| Jupiter Swap | `jupiterSwap` | ❌ | 代币兑换 |
| Jupiter Limit Order | `jupiterLimitOrder` | ❌ | 限价单 |
| SOL Stake | `stakeSOL` | ❌ | SOL 质押 |
| Kamino | `kamino` | ❌ | 借贷金库存取 |
| Transfer | `transfer` | ❌ | SOL/SPL 转账 |
| Balance | `getBalance` | ❌ | 查询余额 |
| Drift Perp | `driftPerp` | ❌ | 永续合约交易 |
| Lulo Lend | `luloLend` | ✅ | Lulo 借贷 |
| Sanctum LST | `sanctumLst` | ✅ | LST 操作 |
| Helius Webhook | `heliusWebhook` | ✅ | 链上事件触发 |

---

## 四、数据库核心表

```sql
users                      -- 用户 (钱包地址为主键, RLS)
accounts                   -- 账户 (Crossmint 托管钱包, 加密私钥)
workflows                  -- 工作流定义 (JSONB)
workflow_executions        -- 工作流执行记录
node_executions            -- 节点执行明细
transaction_history        -- 交易历史 (swap/deposit/withdraw/...)
telegram_mappings          -- Telegram 绑定关系
referral_codes             -- 推荐码 (REF-XXXXXXXX, 单次使用)
referral_user_quotas       -- 用户推荐码配额
-- + strategies, strategy_deployments, follower_vaults 等 (由后端 ORM/迁移管理)
```

---

## 五、链上程序 (Anchor)

### Account PDAs

| Account | Seeds | 用途 |
|---------|-------|------|
| `StrategyVersion` | `["strategy_version", strategy_id, version]` | 策略版本承诺 |
| `StrategyDeployment` | `["strategy_deployment", deployment_id]` | 部署实例 + 生命周期 |
| `StrategyState` | `["strategy_state", deployment]` | 状态指针 + revision |
| `VaultAuthority` | `["vault_authority", deployment]` | 资产权限壳 |
| `PublicSnapshot` | `["public_snapshot", deployment]` | 公开排行榜数据 |
| `StrategySubscription` | `["strategy_subscription", deployment, follower]` | 追随者订阅 |
| `FollowerVault` | `["follower_vault", subscription]` | 追随者资金壳 |
| `FollowerVaultAuthority` | `["follower_vault_authority", follower_vault]` | 追随者权限 |

### 关键设计决策

1. **Anchor 不做资金托管** — 只存 commitment hash 和生命周期状态
2. **Keeper 是独立签名者** — `StrategyDeployment.keeper` 字段，创作者可轮换
3. **ER 高频执行** — `delegate_strategy_state` 委托到 ER，`commit_state_and_commit` 回写 base layer
4. **前向兼容** — 每个 Account 都有 `_reserved` tail，支持无迁移升级

---

## 六、技术栈

| 层级 | 技术 |
|-----|------|
| 前端 | Next.js 14, React, TypeScript, Tailwind CSS, shadcn/ui, next-intl, Playwright |
| 后端 | NestJS 10, TypeScript 5, Swagger/OpenAPI, Throttler |
| 数据库 | PostgreSQL (Supabase), Row Level Security |
| 区块链 | Solana, Anchor 0.32.1, `@solana/kit`, `@solana/web3.js` |
| DeFi 协议 | Jupiter, Kamino, Drift, Pyth, Orca, Raydium, Lulo, Sanctum |
| 基础设施 | MagicBlock ER/PER, Umbra (加密), Crossmint (托管钱包) |
| 通知 | Telegram Bot API |
| 测试 | ts-mocha (链上), Jest (后端 E2E), Playwright (前端) |

---

## 七、部署与运行

### 本地开发

```bash
# 1. 启动后端 (port 3000)
cd backend
npm install
npm run start:dev

# 2. 启动前端 (port 3100)
cd frontend-admin
npm install
npm run dev

# 3. 运行 Legacy 工作流 (CLI)
npm run workflow ./workflows/your-workflow.json
```

### 链上程序 (Devnet)

```bash
cd programs
anchor build
anchor deploy --provider.cluster devnet
```

---

## 八、演进路线 (v1 → v5)

| 版本 | 重点 | 链上改动 |
|-----|------|---------|
| **v1** (当前) | 策略发布 + 部署 + 追随者订阅 | StrategyVersion / Deployment / State / Subscription / FollowerVault |
| **v2** | 金库推荐 (Vault Recommendations) | 新的 `execution_mode` 变体 |
| **v3** | 信号流 (Signal Feeds) | 新增 `SignalRecord` PDA + `emit_signal` IX |
| **v4** | Alpha 线程 (Alpha Threads) | `ThreadVersion` + Arweave/SHDW `content_uri` |
| **v5** | 组合包 (Bundles) | `BundleDeployment` + 收益拆分路由 |

---

## 九、安全要点

1. **私钥不落地** — Crossmint 托管钱包，后端只存加密后的密钥
2. **RLS 隔离** — Supabase 行级安全确保用户只能访问自己的数据
3. **Keeper 分离** — 创作者私钥 ≠ Keeper 私钥，降低单点风险
4. **生命周期强制** — Anchor 状态机禁止非法状态转换
5. **Revision 防重放** — `expected_revision` 必须匹配当前值才能提交
6. **全局限流** — 默认 60 秒 120 请求

---

*本文档基于代码库 HEAD 状态整理，核心 spec 参考 `2026-05-02-pintool-strategy-runtime-spec.md`。*
