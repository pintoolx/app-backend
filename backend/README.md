# PinTool Backend - Web3 Workflow Automation Platform

A NestJS-based backend service for automating DeFi workflows on Solana blockchain.

## 🎯 Features

- **Wallet Signature Authentication** - Passwordless authentication using Solana wallet signatures
- **Agent API** - API-key based authentication for programmatic/agent access
- **Crossmint Custodial Wallets** - Create and manage custodial wallets via Crossmint SDK
- **Workflow Management** - Create, execute, and monitor automated DeFi workflows with lifecycle management
- **Telegram Notifications** - Real-time notifications for workflow executions (all messages in English)
- **11 Workflow Nodes**:
  - **PriceFeed Node** - Monitor token prices via Pyth Network
  - **Swap Node** - Execute token swaps via Jupiter Aggregator
  - **LimitOrder Node** - Place limit orders via Jupiter
  - **Stake Node** - Stake SOL via Jupiter
  - **Kamino Node** - Deposit/withdraw from Kamino lending vaults
  - **Lulo Node** - Lending via Lulo Finance
  - **Drift Node** - Perpetual trading via Drift Protocol
  - **Sanctum Node** - LST operations via Sanctum
  - **Transfer Node** - Native SOL/SPL token transfers
  - **Balance Node** - Query wallet token balances
  - **HeliusWebhook Node** - On-chain event triggers via Helius webhooks
- **Supabase Integration** - PostgreSQL database with Row Level Security (RLS) & migrations
- **Swagger API Docs** - Auto-generated API documentation at `/api/docs`

## 📁 Project Structure

```
backend/
├── src/
│   ├── agent/                      # Agent API (API-key auth for programmatic access)
│   ├── auth/                       # Wallet signature authentication
│   ├── crossmint/                  # Crossmint custodial wallet management
│   ├── workflows/                  # Workflow CRUD, execution & lifecycle management
│   ├── telegram/                   # Telegram Bot & notifications
│   ├── web3/                       # Solana nodes & services
│   │   ├── nodes/                  # 11 workflow nodes (see Features)
│   │   ├── services/               # Solana connection, AgentKit, Kamino, token, transaction, etc.
│   │   ├── types/                  # Web3 type definitions
│   │   └── utils/                  # Web3 utilities
│   ├── database/                   # Supabase service & schema
│   │   ├── schema/                 # SQL schema files
│   │   └── functions/              # Database functions
│   ├── common/                     # Guards, decorators, filters, interceptors
│   ├── config/                     # Configuration
│   ├── main.ts                     # Application entry
│   └── app.module.ts               # Root module
├── supabase/
│   └── migrations/                 # Supabase database migrations
├── .env.example                    # Environment variables template
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
- `CROSSMINT_SERVER_API_KEY` - Crossmint API key for custodial wallets
- `SOLANA_RPC_URL` - Solana RPC endpoint

Optional environment variables:
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (for notifications)
- `HELIUS_API_KEY` - Required for HeliusWebhookNode
- `LULO_API_KEY` - Required for LuloNode
- `SANCTUM_API_KEY` - Required for SanctumNode

### 3. Setup Database

Apply Supabase migrations from `supabase/migrations/` in order, or run the schema files from `src/database/schema/` in your Supabase SQL editor.

### 4. Start Development Server

```bash
npm run start:dev
```

Server will start on `http://localhost:3000`  
API docs available at `http://localhost:3000/api/docs`

## 📡 API Endpoints

All endpoints are prefixed with `/api`.

### Health & Root

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Welcome message & doc links |
| GET | `/api/health` | Health check |

### Authentication (`/api/auth`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/challenge` | Get signature challenge |

```bash
# Get challenge
curl -X POST http://localhost:3000/api/auth/challenge \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"7xKgF2p3VQa..."}'
```

### Agent (`/api/agent`) - API-key based access

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/agent/register` | Wallet Signature | Register agent & get API key |
| GET | `/agent/accounts` | API Key | List agent accounts |
| GET | `/agent/nodes` | None | List all available node types & parameters |
| POST | `/agent/workflows` | API Key | Create a workflow |
| POST | `/agent/wallets/init` | API Key | Create account with Crossmint wallet |
| DELETE | `/agent/wallets/:id` | API Key | Close account (withdraws assets to owner) |

API Key is sent via `X-API-Key` header.

### Crossmint Wallets (`/api/crossmint/wallets`) - Signature-based access

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/crossmint/wallets/init` | Initialize new account with Crossmint wallet |
| DELETE | `/crossmint/wallets/:id` | Delete/close an account |

### Workflows (`/api/workflows`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/workflows/active` | API Key | List active workflow instances |

### Referrals (`/api/referrals`) - Signature-based access

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/referrals/admin/codes` | Admin generates single-use referral codes for a target wallet |
| PATCH | `/referrals/admin/quotas/:walletAddress` | Admin sets lifetime quota for user-generated codes |
| POST | `/referrals/codes` | User generates own referral codes (quota-limited) |
| POST | `/referrals/redeem` | Redeem a referral code (single-use only) |
| POST | `/referrals/my-codes` | List codes created by current wallet |

### Telegram (`/api/telegram`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/telegram/webhook` | Telegram webhook (internal) |

**Telegram Bot Commands:**
```
/start - Welcome message
/link <wallet_address> - Link your wallet
/unlink - Unlink wallet
/status - Check link status
```

## 🔧 Available Workflow Nodes

| Node Type | Key | API Key Required | Description |
|-----------|-----|:----------------:|-------------|
| Pyth Price Feed | `pythPriceFeed` | ❌ | Monitor token prices |
| Jupiter Swap | `jupiterSwap` | ❌ | Token swaps |
| Jupiter Limit Order | `jupiterLimitOrder` | ❌ | Limit orders |
| SOL Stake | `stakeSOL` | ❌ | Stake SOL |
| Kamino | `kamino` | ❌ | Lending vault deposit/withdraw |
| Transfer | `transfer` | ❌ | SOL/SPL token transfers |
| Balance | `getBalance` | ❌ | Query wallet balances |
| Drift Perp | `driftPerp` | ❌ | Perpetual trading |
| Lulo Lend | `luloLend` | ✅ `LULO_API_KEY` | Lending via Lulo |
| Sanctum LST | `sanctumLst` | ✅ `SANCTUM_API_KEY` | LST operations |
| Helius Webhook | `heliusWebhook` | ✅ `HELIUS_API_KEY` | On-chain event triggers |

Query all node schemas: `GET /api/agent/nodes`

### 📘 Full Node Reference (Auto-generated)

A complete, human-readable node reference is generated at:

- `docs/NODES_REFERENCE.md`

Regenerate it anytime with:

```bash
npm run docs:nodes
```

## 🔧 Development

### Available Scripts

```bash
npm run start          # Start production server
npm run start:dev      # Start development (watch mode)
npm run start:debug    # Start with debugger
npm run start:prod     # Start production build
npm run build          # Build for production
npm run format         # Format code with Prettier
npm run lint           # Run ESLint
npm run docs:nodes     # Generate full node reference markdown
npm run test           # Run unit tests
npm run test:watch     # Run tests in watch mode
npm run test:cov       # Run tests with coverage
npm run test:e2e       # Run E2E tests
```

### Testing API with cURL

```bash
# Health check
curl http://localhost:3000/api/health

# Get available node types
curl http://localhost:3000/api/agent/nodes
```

### Referral System Notes

- Code format is fixed to `REF-` + 8 chars, uppercase alphanumeric.
- Each code is single-use (`max_uses = 1`) and remains stored after consumption.
- Global uniqueness is guaranteed by DB `UNIQUE(code)`; generation retries on collision.
- Admin authorization is role-based (`users.app_role = 'admin'`).
- User self-generation is limited by lifetime quota in `referral_user_quotas`.

## 🌐 Deployment

### Production Build

```bash
npm run build
npm run start:prod
```

### Docker

```bash
docker build -t pintool-backend .
docker run -p 3000:3000 --env-file .env pintool-backend
```

### Environment Setup

For production, set:
- `NODE_ENV=production`
- `CORS_ORIGIN` to your frontend domain(s)
- Use `TELEGRAM_WEBHOOK_URL` instead of long polling
- Use faster Solana RPC providers (Helius, QuickNode, Alchemy, etc.)

## 🔐 Security

- **Custodial Wallets**: Managed via Crossmint SDK (no private key storage)
- **Auth**: Wallet signature challenges (challenge-response)
- **Agent Auth**: API key authentication with `X-API-Key` header
- **RLS**: Row Level Security in Supabase ensures users only access their data
- **Validation**: All inputs validated using `class-validator` with whitelist & transform

## 📚 Tech Stack

- **Framework**: NestJS 10
- **Language**: TypeScript 5
- **Database**: PostgreSQL (Supabase)
- **API Docs**: Swagger / OpenAPI (`@nestjs/swagger`)
- **Blockchain**: Solana (`@solana/kit`, `@solana/web3.js`, `@solana/spl-token`)
- **Custodial Wallets**: Crossmint (`@crossmint/wallets-sdk`)
- **Agent Toolkit**: `solana-agent-kit`
- **DeFi Protocols**:
  - Jupiter Aggregator (`@jup-ag/api`)
  - Kamino Finance (`@kamino-finance/klend-sdk`)
  - Pyth Network (`@pythnetwork/hermes-client`)
- **Notifications**: Telegram Bot API (`typescript-telegram-bot-api`)
- **Authentication**: Wallet Signatures (`tweetnacl`, `bs58`)
- **Utilities**: `decimal.js`, `axios`, `rxjs`

## 🐛 Troubleshooting

### Common Issues

**1. "Supabase URL and Service Key must be provided"**
- Ensure `.env` file exists with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

**2. Telegram bot not responding**
- Check `TELEGRAM_BOT_TOKEN` is correct
- Verify bot is started: Look for "✅ Telegram bot started" in logs

**3. Workflow execution fails**
- Check Solana RPC is accessible
- Ensure account has sufficient SOL for transaction fees
- Verify Crossmint wallet is properly initialized

**4. Crossmint wallet errors**
- Check `CROSSMINT_SERVER_API_KEY` is correct
- Verify `CROSSMINT_ENVIRONMENT` matches your key (staging/production)

## 📝 Notes

- All console logs, Telegram messages, and API responses are in **English**
- Database migrations are managed via `supabase/migrations/`
- Workflow definitions stored as JSONB in PostgreSQL
- Swagger docs auto-generated at `/api/docs`

## 📄 License

MIT

---

Built with ❤️ using NestJS & Solana
