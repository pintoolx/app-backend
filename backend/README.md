# PinTool Backend - Web3 Workflow Automation Platform

A NestJS-based backend service for automating DeFi workflows on Solana blockchain.
(NOT DONE YET)

## 🎯 Features

- **Wallet Signature Authentication** - Passwordless authentication using Solana wallet signatures
- **Workflow Management** - Create, execute, and monitor automated DeFi workflows
- **Telegram Notifications** - Real-time notifications for workflow executions (All messages in English)
- **3 Core Nodes**:
  - **Price Feed Node** - Monitor token prices via Pyth Network
  - **Swap Node** - Execute token swaps via Jupiter Aggregator
  - **Kamino Node** - Deposit/withdraw from Kamino lending vaults
- **Encryption** - AES-256 encryption for private key storage
- **Supabase Integration** - PostgreSQL database with Row Level Security (RLS)

## 📁 Project Structure

```
backend/
├── src/
│   ├── auth/                      # Wallet signature authentication
│   ├── workflows/                 # Workflow CRUD & execution
│   ├── telegram/                  # Telegram Bot & notifications
│   ├── web3/                      # Solana nodes & services
│   │   ├── nodes/                 # PriceFeed, Swap, Kamino nodes
│   │   └── services/              # Solana connection, Jupiter, etc.
│   ├── database/                  # Supabase service
│   ├── encryption/                # AES-256 encryption
│   ├── common/                    # Guards, decorators, filters
│   ├── config/                    # Configuration
│   ├── main.ts                    # Application entry
│   └── app.module.ts              # Root module
├── .env.example                   # Environment variables template
├── package.json
└── README.md
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:
- `SUPABASE_URL` & `SUPABASE_SERVICE_KEY` - Supabase credentials
- `JWT_SECRET` - JWT signing secret (min 32 chars)
- `ENCRYPTION_SECRET` - Encryption key for private keys (min 32 chars)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `SOLANA_RPC_URL` - Solana RPC endpoint

### 3. Setup Database

Run the SQL schema from `../database/initial.sql` in your Supabase SQL editor.

This creates 8 tables:
- `users`, `telegram_mappings`, `accounts`
- `workflows`, `workflow_executions`, `node_executions`
- `transaction_history`, `system_config`

### 4. Start Development Server

```bash
npm run start:dev
```

Server will start on `http://localhost:3000`

## 📡 API Endpoints

### Authentication (`/api/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/challenge` | Get signature challenge |

**Example:**

```bash
# 1. Get challenge
curl -X POST http://localhost:3000/api/auth/challenge \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"7xKgF2p3VQa..."}'

# 2. Sign the challenge with your wallet
# 3. Send the signature to endpoints that require wallet verification
```

### Workflows (`/api/workflows`)

All endpoints that mutate data require a signed challenge in the request body.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/workflows` | Get all workflows |
| POST | `/workflows` | Create workflow |
| GET | `/workflows/:id` | Get workflow details |
| PATCH | `/workflows/:id` | Update workflow |
| DELETE | `/workflows/:id` | Delete workflow |
| POST | `/workflows/:id/execute` | Execute workflow |

**Create Workflow Example:**

```bash
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SOL Price Monitor & Auto Swap",
    "description": "When SOL > $100, swap 10 USDC to SOL",
    "definition": {
      "nodes": [
        {
          "id": "priceFeed1",
          "name": "Monitor SOL Price",
          "type": "pythPriceFeed",
          "parameters": {
            "priceId": "SOL",
            "targetPrice": "100",
            "condition": "above"
          }
        },
        {
          "id": "swap1",
          "name": "Swap USDC to SOL",
          "type": "jupiterSwap",
          "parameters": {
            "inputToken": "USDC",
            "outputToken": "SOL",
            "amount": "10",
            "slippageBps": "50"
          }
        }
      ],
      "connections": {
        "priceFeed1": {
          "main": [[{"node": "swap1", "type": "main", "index": 0}]]
        }
      }
    }
  }'
```

### Telegram (`/api/telegram`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/telegram/webhook` | Telegram webhook (for bot) |

**Telegram Bot Commands:**

```
/start - Welcome message
/link <wallet_address> - Link your wallet
/unlink - Unlink wallet
/status - Check link status
```

**Example:**

1. Open Telegram and find your bot
2. Send `/link 7xKgF2p3VQa...`
3. Bot responds: "✅ Successfully linked!"
4. When workflows execute, you'll receive notifications:

```
🚀 Workflow Started

Name: SOL Price Monitor & Auto Swap
Execution ID: exec_xyz789
Time: 1/15/2025, 10:05:00 AM

---

✅ Node Completed

Node: Monitor SOL Price
Type: 📊 pythPriceFeed
Price: $105.5
Triggered: ✅ Yes

---

✅ Node Completed

Node: Swap USDC to SOL
Type: 🔄 jupiterSwap
Swap: 10 USDC → 0.0947 SOL
TX: 5j7s8k9...
```

## 🔧 Development

### Available Scripts

```bash
npm run start          # Start production server
npm run start:dev      # Start development (watch mode)
npm run start:debug    # Start with debugger
npm run build          # Build for production
npm run lint           # Run ESLint
npm run test           # Run unit tests
npm run test:e2e       # Run E2E tests
```

### Testing API with cURL

```bash
# Health check
curl http://localhost:3000/api/health

# Get available node types
curl http://localhost:3000/api/nodes/types
```

## 🌐 Deployment

### Production Build

```bash
npm run build
npm run start:prod
```

### Environment Setup

For production, set:
- `NODE_ENV=production`
- Use `TELEGRAM_WEBHOOK_URL` instead of long polling
- Use faster Solana RPC providers (Alchemy, Helius, etc.)

## 🔐 Security

- **Private Keys**: Encrypted with AES-256-GCM before storage
- **Auth**: Wallet signature challenges
- **RLS**: Row Level Security in Supabase ensures users only access their data
- **Validation**: All inputs validated using class-validator

## 📚 Tech Stack

- **Framework**: NestJS 10
- **Database**: PostgreSQL (Supabase)
- **Blockchain**: Solana (@solana/kit, @solana/web3.js)
- **DeFi Protocols**:
  - Jupiter Aggregator (@jup-ag/api)
  - Kamino Finance (@kamino-finance/klend-sdk)
  - Pyth Network (@pythnetwork/hermes-client)
- **Notifications**: Telegram Bot API
- **Authentication**: Wallet Signatures (tweetnacl, bs58)
- **Encryption**: Node.js Crypto (AES-256-GCM)

## 🐛 Troubleshooting

### Common Issues

**1. "Supabase URL and Service Key must be provided"**
- Ensure `.env` file exists with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

**2. "ENCRYPTION_SECRET must be at least 32 characters long"**
- Generate a secure random string: `openssl rand -base64 32`

**3. Telegram bot not responding**
- Check `TELEGRAM_BOT_TOKEN` is correct
- Verify bot is started: Look for "✅ Telegram bot started" in logs

**4. Workflow execution fails**
- Check Solana RPC is accessible
- Ensure account has sufficient SOL for transaction fees
- Verify private keys are correctly encrypted in database

## 📝 Notes

- All console logs, Telegram messages, and API responses are in **English**
- Legacy code preserved in `../src-legacy/` for reference
- Database schema in `../database/initial.sql` (8 tables with RLS)
- Workflow definitions stored as JSONB in PostgreSQL

## 🤝 Contributing

1. Create feature branch
2. Make changes
3. Test thoroughly
4. Submit pull request

## 📄 License

MIT

---

Built with ❤️ using NestJS & Solana
