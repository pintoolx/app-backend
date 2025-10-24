# Web3 Workflow Automation System

A Solana-based Web3 workflow automation system supporting price monitoring, token swapping, DeFi operations, and more.

## ✨ Features

- 🎯 **Price Triggers** - Monitor token prices and auto-trigger when targets are met
- 💱 **Jupiter Swap** - Automated token swapping
- 🏦 **Kamino Integration** - Auto deposit/withdraw from Kamino vaults
- 🔗 **Visual Workflows** - JSON configuration for easy operation chaining
- 📱 **Telegram Notifications** - Real-time workflow execution updates
- 🛡️ **Type Safety** - Full TypeScript support
- 🧩 **Modular Design** - Easy to extend with new node types

## 📦 Installation

```bash
npm install
```

## 🚀 Quick Start

### 1. Prepare Wallet Keypair

Create a `keypair.json` file (or use an existing wallet file)

### 2. Configure Telegram Notifications (Optional)

See [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md) for detailed Telegram notification setup.

Quick setup:
```bash
# Copy configuration file
cp .env.example .env

# Edit .env and fill in your Telegram Bot Token and Chat ID
# TELEGRAM_BOT_TOKEN=your_bot_token
# TELEGRAM_CHAT_ID=your_chat_id
# TELEGRAM_NOTIFY_ENABLED=true
```

### 3. Configure Workflow

Edit `workflows/price-trigger-swap.json`:

```json
{
  "nodes": [
    {
      "id": "priceFeed1",
      "name": "Monitor SOL Price",
      "type": "pythPriceFeed",
      "parameters": {
        "priceId": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        "targetPrice": "100",
        "condition": "above"
      }
    },
    {
      "id": "swap1",
      "name": "Execute Swap",
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

### 4. Run Workflow

```bash
npm run workflow
```

Or specify a workflow file:

```bash
npm run workflow ./workflows/your-workflow.json
```

## 📚 Supported Node Types

### 1. PriceFeedNode (Price Monitor)

Monitors token prices and triggers subsequent nodes when target price is reached.

**Parameters**:
- `priceId`: Pyth price feed ID
- `targetPrice`: Target price to trigger
- `condition`: `above` | `below` | `equal`
- `timeout`: Timeout in seconds

**Telegram Notifications**: ✅ Enabled

### 2. SwapNode (Jupiter Swap)

Executes token swaps using Jupiter aggregator.

**Parameters**:
- `inputMint`: Input token address
- `outputMint`: Output token address
- `amount`: Amount to swap (human-readable)
- `slippageBps`: Slippage tolerance in basis points

**Telegram Notifications**: ✅ Enabled

### 3. KaminoNode (Kamino Operations)

Deposits or withdraws tokens from Kamino vaults.

**Parameters**:
- `operation`: `deposit` | `withdraw`
- `vaultAddress`: Vault address
- `amount`: Amount
- `shareAmount`: Share amount (for withdrawals)

**Telegram Notifications**: ✅ Enabled

## 📱 Telegram Notifications

The system sends Telegram notifications at the following times:

1. **🚀 Workflow Start** - When workflow begins
2. **📦 Node Execution** - When nodes complete (only nodes with `telegramNotify: true`)
3. **❌ Execution Failure** - When errors occur
4. **✅ Workflow Complete** - When workflow finishes

See [TELEGRAM_SETUP.md](./TELEGRAM_SETUP.md) for detailed setup instructions.

## 🎯 Use Cases

### Scenario 1: Automated Arbitrage

```
[Price Monitor] → [Swap USDC → SOL] → [Swap SOL → USDC] → [Calculate Profit]
```

### Scenario 2: Automated Investment

```
[Price Monitor] → [Buy Token] → [Deposit to Kamino for Yield]
```

### Scenario 3: Stop Loss/Take Profit

```
[Price Monitor (below 90)] → [Sell Token] → [Convert to Stablecoin]
```

## 📖 Documentation

See [WORKFLOW_GUIDE.md](./WORKFLOW_GUIDE.md) for the complete usage guide.

## 🏗️ Project Structure

```
src/
├── nodes/              # All node implementations
│   ├── PriceFeedNode.ts
│   ├── SwapNode.ts
│   └── KaminoNode.ts
├── utils/              # Reusable utility functions
│   ├── price-monitor.ts
│   ├── jupiter-swap.ts
│   └── token.ts
├── workflow-executor.ts  # Workflow execution engine
├── run-workflow.ts       # Run script
└── web3-workflow-types.ts # Type definitions

workflows/              # Workflow configuration files
└── price-trigger-swap.json
```

## 🔧 Development

### Adding New Node Types

1. Create a new file `src/nodes/YourNode.ts`
2. Implement the `INodeType` interface
3. Register it in `src/run-workflow.ts`

```typescript
import { YourNode } from './nodes/YourNode';

executor.registerNodeType('yourNode', YourNode);
```

### Development Scripts

```bash
# Development mode (auto-restart)
npm run dev

# Type checking
npm run type-check

# Build
npm run build
```

## ⚠️ Important Notes

1. **Testing**: Always test on devnet first
2. **Security**: Never commit `keypair.json` to Git
3. **RPC Limits**: Consider using paid RPC endpoints
4. **Amounts**: All amounts use human-readable format (not smallest units)

## 🤝 Contributing

Issues and Pull Requests are welcome!

## 📄 License

MIT
