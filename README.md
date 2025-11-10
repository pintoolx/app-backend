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

### 4. X402PaymentNode (X402 Payment Protocol)

**🌟 Featured Node** - Enables micropayment-based API access using the x402 protocol with Solana USDC payments.

#### What is X402?

X402 is a payment protocol that enables **pay-per-use** access to APIs and content. Instead of monthly subscriptions, you pay tiny amounts (like $0.0001) for each request. This is perfect for:
- 💰 **AI/LLM APIs** - Pay per query instead of monthly fees
- 📊 **Premium Data APIs** - Access expensive data feeds only when needed
- 🔐 **Gated Content** - Unlock specific content with micropayments
- 🤖 **Machine-to-Machine Payments** - Automated payments between services

#### Payment Flow

```
Client Request → 402 Payment Required → Create Signed Transaction
    ↓                                              ↓
Content Delivered ← Transaction Confirmed ← Retry with Payment
```

1. **Initial Request**: Node requests content from target URL
2. **402 Response**: Server returns payment requirements (amount, recipient, token)
3. **Create Transaction**: Node creates Solana SPL Token transfer transaction
4. **Sign & Encode**: Transaction is signed with your keypair and base64-encoded
5. **Retry with Proof**: Request retried with `X-Payment` header containing transaction
6. **Server Validates**: Server validates transaction, submits to blockchain
7. **Content Delivered**: After confirmation, server returns the protected content

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `targetUrl` | string | `http://localhost:3001/api/x402/premium` | URL of the x402-protected endpoint |
| `network` | options | `devnet` | Solana network: `devnet` or `mainnet` |
| `keypairPath` | string | `./pay-in-usdc/client.json` | Path to wallet keypair JSON file for payment |
| `maxPaymentAmount` | string | `1.0` | Maximum USDC willing to pay (safety limit) |
| `tokenMint` | string | *(auto)* | Token mint address (defaults to USDC for network) |
| `rpcEndpoint` | string | *(auto)* | Custom RPC endpoint (uses public if empty) |
| `method` | options | `GET` | HTTP method: `GET` or `POST` |
| `requestBody` | string | `""` | JSON request body for POST requests |

#### Example Workflow Configuration

**Scenario 1: AI Query with Payment**
```json
{
  "nodes": [
    {
      "id": "aiQuery",
      "name": "Ask AI Question",
      "type": "x402Payment",
      "parameters": {
        "targetUrl": "http://localhost:3001/api/x402/query",
        "network": "devnet",
        "keypairPath": "./keypair.json",
        "maxPaymentAmount": "0.001",
        "method": "POST",
        "requestBody": "{\"query\": \"What is the current price of SOL?\"}"
      }
    }
  ]
}
```

**Scenario 2: Conditional Premium Data Access**
```json
{
  "nodes": [
    {
      "id": "priceTrigger",
      "type": "pythPriceFeed",
      "parameters": {
        "priceId": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        "targetPrice": "150",
        "condition": "above"
      }
    },
    {
      "id": "premiumData",
      "type": "x402Payment",
      "parameters": {
        "targetUrl": "https://api.example.com/premium/analysis",
        "network": "mainnet",
        "keypairPath": "./keypair.json",
        "maxPaymentAmount": "0.1"
      }
    }
  ],
  "connections": {
    "priceTrigger": {
      "main": [[{ "node": "premiumData", "type": "main", "index": 0 }]]
    }
  }
}
```

#### Server Implementation

The repository includes a complete x402 server implementation:
- **Service**: `backend/src/x402/x402.service.ts` - Payment validation and blockchain interaction
- **Controller**: `backend/src/x402/x402.controller.ts` - Example endpoints
- **Demo Endpoints**:
  - `GET /api/x402/premium` - Premium content (0.0001 USDC)
  - `POST /api/x402/query` - AI query service (0.00005 USDC)
  - `GET /api/x402/info` - Public endpoint info

#### Security Features

- ✅ **Amount Validation**: Server validates exact payment amount
- ✅ **Transaction Simulation**: Tests transaction before submission
- ✅ **Recipient Verification**: Ensures payment goes to correct account
- ✅ **Safety Limits**: Client-side maximum payment protection
- ✅ **Balance Checks**: Verifies sufficient funds before payment
- ✅ **Blockchain Confirmation**: Waits for transaction confirmation

#### Output Data

Successful execution returns:
```json
{
  "success": true,
  "operation": "x402-payment",
  "paymentRequired": true,
  "data": { /* API response data */ },
  "paymentDetails": {
    "signature": "5j7s...",
    "amountUSDC": 0.0001,
    "explorerUrl": "https://explorer.solana.com/tx/...",
    "network": "solana-devnet",
    "confirmed": true
  }
}
```

**Telegram Notifications**: ✅ Enabled - Notifies payment amount, status, and explorer link

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

### Scenario 4: AI-Powered Trading with Pay-Per-Query

```
[Price Monitor] → [X402: AI Market Analysis] → [Decision Node] → [Execute Trade]
```

Use X402 to access premium AI analysis APIs only when needed. Pay $0.0001 per query instead of monthly subscriptions. Perfect for strategies that don't need constant AI input.

### Scenario 5: Premium Data + Conditional Actions

```
[Event Trigger] → [X402: Premium Data API] → [Validate Data] → [Execute Strategy]
```

Access expensive data feeds (options data, whale alerts, sentiment analysis) only when specific conditions are met, minimizing API costs while maintaining strategy effectiveness.

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
