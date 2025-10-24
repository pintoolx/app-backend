# Web3 Workflow Automation System

一个基于 Solana 的 Web3 自动化 Workflow 系统，支持价格监听、代币交换、DeFi 操作等功能。

## ✨ 特性

- 🎯 **价格触发器** - 监听代币价格，达到目标自动触发
- 💱 **Jupiter Swap** - 自动执行代币交换
- 🏦 **Kamino 集成** - 自动存入/提取 Kamino 金库
- 🔗 **可视化 Workflow** - JSON 配置，轻松串接多个操作
- 📱 **Telegram 通知** - 实时推送 workflow 执行状态
- 🛡️ **类型安全** - 完整的 TypeScript 支持
- 🧩 **模块化设计** - 易于扩展新的节点类型

## 📦 安装

```bash
npm install
```

## 🚀 快速开始

### 1. 准备钱包密钥

创建 `keypair.json` 文件（或使用现有的钱包文件）

### 2. 配置 Telegram 通知（可选）

查看 [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md) 了解如何配置 Telegram 通知。

快速设置：
```bash
# 复制配置文件
cp .env.example .env

# 编辑 .env 填入你的 Telegram Bot Token 和 Chat ID
# TELEGRAM_BOT_TOKEN=your_bot_token
# TELEGRAM_CHAT_ID=your_chat_id
# TELEGRAM_NOTIFY_ENABLED=true
```

### 3. 配置 Workflow

编辑 `workflows/price-trigger-swap.json`：

```json
{
  "nodes": [
    {
      "id": "priceFeed1",
      "name": "监听 SOL 价格",
      "type": "pythPriceFeed",
      "parameters": {
        "priceId": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        "targetPrice": "100",
        "condition": "above"
      }
    },
    {
      "id": "swap1",
      "name": "执行交换",
      "type": "jupiterSwap",
      "parameters": {
        "inputMint": "USDC_ADDRESS",
        "outputMint": "SOL_ADDRESS",
        "amount": "10"
      }
    }
  ],
  "connections": {
    "priceFeed1": {
      "main": [[{ "node": "swap1", "type": "main", "index": 0 }]]
    }
  }
}
```

### 3. 运行 Workflow

```bash
npm run workflow
```

或指定 workflow 文件：

```bash
npm run workflow ./workflows/your-workflow.json
```

## 📚 支持的节点类型

### 1. PriceFeedNode (价格监听)

监听代币价格，当达到目标价格时触发后续节点。

**参数**:
- `priceId`: Pyth 价格源 ID
- `targetPrice`: 目标价格
- `condition`: `above` | `below` | `equal`
- `timeout`: 超时时间（秒）

### 2. SwapNode (Jupiter 交换)

使用 Jupiter 聚合器执行代币交换。

**参数**:
- `inputMint`: 输入代币地址
- `outputMint`: 输出代币地址
- `amount`: 交换数量（人类可读）
- `slippageBps`: 滑点容差（基点）

**Telegram 通知**: ✅ 启用

### 3. KaminoNode (Kamino 操作)

在 Kamino 金库中存入或提取代币。

**参数**:
- `operation`: `deposit` | `withdraw`
- `vaultAddress`: 金库地址
- `amount`: 金额
- `shareAmount`: 份额（提取时使用）

**Telegram 通知**: ✅ 启用

## 📱 Telegram 通知

系统会在以下时机发送 Telegram 通知：

1. **🚀 Workflow 开始** - 工作流启动
2. **📦 节点执行** - 节点完成（仅 `telegramNotify: true` 的节点）
3. **❌ 执行失败** - 发生错误
4. **✅ Workflow 完成** - 工作流结束

详细设置请查看 [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md)

## 🎯 使用场景

### 场景 1: 自动套利

```
[价格监听] → [Swap USDC → SOL] → [Swap SOL → USDC] → [计算利润]
```

### 场景 2: 自动投资

```
[价格监听] → [买入代币] → [存入 Kamino 赚收益]
```

### 场景 3: 止损/止盈

```
[价格监听 (below 90)] → [卖出代币] → [转为稳定币]
```

## 📖 详细文档

查看 [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md) 获取完整使用指南。

## 🏗️ 项目结构

```
src/
├── nodes/              # 所有节点实现
│   ├── PriceFeedNode.ts
│   ├── SwapNode.ts
│   └── KaminoNode.ts
├── utils/              # 可复用的工具函数
│   ├── price-monitor.ts
│   ├── jupiter-swap.ts
│   └── token.ts
├── workflow-executor.ts  # Workflow 执行引擎
├── run-workflow.ts       # 运行脚本
└── web3-workflow-types.ts # 类型定义

workflows/              # Workflow 配置文件
└── price-trigger-swap.json
```

## 🔧 开发

### 添加新的节点类型

1. 创建新文件 `src/nodes/YourNode.ts`
2. 实现 `INodeType` 接口
3. 在 `src/run-workflow.ts` 中注册

```typescript
import { YourNode } from './nodes/YourNode';

executor.registerNodeType('yourNode', YourNode);
```

### 运行脚本

```bash
# 开发模式（自动重启）
npm run dev

# 类型检查
npm run type-check

# 构建
npm run build
```

## ⚠️ 注意事项

1. **测试**: 始终先在 devnet 测试
2. **密钥安全**: 不要将 `keypair.json` 提交到 Git
3. **RPC 限制**: 建议使用付费 RPC 端点
4. **金额**: 所有金额都是人类可读格式（非最小单位）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

MIT
