# PinTool Backend - Complete Project Structure

## 📂 Directory Tree

```
backend/
├── src/
│   ├── auth/                                    # 🔐 Authentication Module
│   │   ├── dto/
│   │   │   ├── wallet-challenge.dto.ts         # Challenge request DTO
│   │   │   └── wallet-verify.dto.ts            # Signature verification DTO
│   │   ├── auth.controller.ts                  # /auth/challenge, /auth/verify
│   │   ├── auth.service.ts                     # Signature verification logic
│   │   ├── auth.module.ts                      # Auth module config
│   │   └── jwt.strategy.ts                     # Passport JWT strategy
│   │
│   ├── workflows/                               # 🔄 Workflows Module
│   │   ├── dto/                                 # (DTOs can be added as needed)
│   │   ├── workflows.controller.ts             # CRUD endpoints
│   │   ├── workflows.service.ts                # Business logic
│   │   ├── workflows.module.ts                 # Module config
│   │   └── executor.service.ts                 # Workflow execution engine
│   │
│   ├── telegram/                                # 📱 Telegram Module
│   │   ├── telegram-bot.service.ts             # Bot commands (/start, /link, etc.)
│   │   ├── telegram-notifier.service.ts        # Send notifications (English only)
│   │   ├── telegram.controller.ts              # Webhook endpoint
│   │   └── telegram.module.ts                  # Module config
│   │
│   ├── web3/                                    # ⛓️ Web3 & Blockchain Module
│   │   ├── nodes/                               # Workflow Nodes
│   │   │   ├── price-feed.node.ts              # Pyth price monitoring
│   │   │   ├── swap.node.ts                    # Jupiter swap execution
│   │   │   └── kamino.node.ts                  # Kamino vault operations
│   │   ├── services/                            # Blockchain Services
│   │   │   ├── connection.service.ts           # Solana RPC connection pool
│   │   │   ├── token.service.ts                # Token utilities
│   │   │   ├── transaction.service.ts          # TX building & sending
│   │   │   ├── price-monitor.service.ts        # Pyth price monitoring
│   │   │   ├── jupiter.service.ts              # Jupiter swap utilities
│   │   │   ├── kamino.service.ts               # Kamino client
│   │   │   └── env.service.ts                  # Environment helpers
│   │   ├── constants.ts                         # Token/vault addresses, price feed IDs
│   │   ├── workflow-types.ts                    # TypeScript interfaces
│   │   └── web3.module.ts                       # Module config
│   │
│   ├── database/                                # 🗄️ Database Module
│   │   ├── repositories/                        # (Can add repository pattern)
│   │   ├── supabase.service.ts                 # Supabase client service
│   │   └── database.module.ts                  # Global database module
│   │
│   ├── encryption/                              # 🔐 Encryption Module
│   │   ├── encryption.service.ts               # AES-256-GCM encryption
│   │   └── encryption.module.ts                # Global encryption module
│   │
│   ├── common/                                  # 🔧 Common Utilities
│   │   ├── decorators/
│   │   │   └── current-user.decorator.ts       # @CurrentUser() decorator
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts               # JWT authentication guard
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts        # Global exception handler
│   │   └── interceptors/
│   │       └── logging.interceptor.ts          # Request/response logging
│   │
│   ├── config/
│   │   └── configuration.ts                    # Environment configuration
│   │
│   ├── main.ts                                  # Application entry point
│   └── app.module.ts                            # Root module
│
├── .env.example                                 # Environment variables template
├── .gitignore                                   # Git ignore rules
├── package.json                                 # Dependencies & scripts
├── tsconfig.json                                # TypeScript configuration
├── nest-cli.json                                # NestJS CLI configuration
├── README.md                                    # Main documentation
└── PROJECT_STRUCTURE.md                         # This file

../src-legacy/                                   # Legacy code (preserved for reference)
../database/initial.sql                          # Database schema (8 tables)
../workflows/                                    # Sample workflow JSON files
```

## 📊 Module Breakdown

### 1. Auth Module (Authentication)
**Files**: 6
- Wallet signature challenge generation
- Signature verification using `tweetnacl` & `bs58`
- JWT token issuance
- User creation/update in Supabase

**API Endpoints**:
- `POST /api/auth/challenge` - Get challenge message
- `POST /api/auth/verify` - Verify signature & login

### 2. Workflows Module (Core Business Logic)
**Files**: 4
- CRUD operations for workflows
- Workflow execution orchestration
- Integration with executor engine

**API Endpoints**:
- `GET /api/workflows` - List workflows
- `POST /api/workflows` - Create workflow
- `GET /api/workflows/:id` - Get workflow
- `PATCH /api/workflows/:id` - Update workflow
- `DELETE /api/workflows/:id` - Delete workflow
- `POST /api/workflows/:id/execute` - Execute workflow

### 3. Telegram Module (Notifications)
**Files**: 4
- Bot command handling (`/start`, `/link`, `/unlink`, `/status`)
- Real-time notifications (all in English)
- Webhook support for production

**Features**:
- Workflow start/complete/error notifications
- Node execution notifications
- User wallet linking

### 4. Web3 Module (Blockchain Integration)
**Files**: 12+
- 3 workflow nodes (PriceFeed, Swap, Kamino)
- Solana connection management
- Jupiter swap integration
- Kamino vault operations
- Pyth price monitoring
- 500+ token/vault constants

### 5. Database Module (Supabase)
**Files**: 2
- Supabase client initialization
- RLS context management

**Tables** (in `../database/initial.sql`):
- `users`, `telegram_mappings`, `accounts`
- `workflows`, `workflow_executions`, `node_executions`
- `transaction_history`, `system_config`

### 6. Encryption Module (Security)
**Files**: 2
- AES-256-GCM encryption
- Private key encryption/decryption

### 7. Common Module (Shared Utilities)
**Files**: 4
- `@CurrentUser()` decorator
- JWT auth guard
- HTTP exception filter
- Logging interceptor

## 🔢 Statistics

- **Total Files Created**: ~50 files
- **Modules**: 7 (Auth, Workflows, Telegram, Web3, Database, Encryption, Common)
- **API Endpoints**: 12+ endpoints
- **Workflow Nodes**: 3 (PriceFeed, Swap, Kamino)
- **Database Tables**: 8 (from initial.sql)

## 🌟 Key Features

### ✅ All Messages in English
- Console logs: `console.log('✅ User authenticated successfully')`
- Telegram messages: `"🚀 Workflow Started"`
- API responses: `{ "success": true, "data": {...} }`
- Error messages: `"Invalid Solana wallet address"`

### ✅ Security
- AES-256-GCM encryption for private keys
- JWT authentication
- Supabase Row Level Security (RLS)
- Input validation (class-validator)

### ✅ TypeScript
- Full type safety
- Path aliases configured (`@auth/*`, `@workflows/*`, etc.)
- Modern ES2021 target

### ✅ Developer Experience
- Hot reload (`npm run start:dev`)
- Global exception handling
- Request/response logging
- Comprehensive README

## 🚀 Next Steps

1. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Setup Database**
   - Run `../database/initial.sql` in Supabase SQL Editor

4. **Start Server**
   ```bash
   npm run start:dev
   ```

5. **Test Authentication**
   ```bash
   curl -X POST http://localhost:3000/api/auth/challenge \
     -H "Content-Type: application/json" \
     -d '{"walletAddress":"YOUR_WALLET"}'
   ```

## 📝 Migration Notes

### From Legacy Code (`src-legacy/`)

| Legacy File | New Location | Status |
|-------------|--------------|--------|
| `src/nodes/PriceFeedNode.ts` | `backend/src/web3/nodes/price-feed.node.ts` | ✅ Copied |
| `src/nodes/SwapNode.ts` | `backend/src/web3/nodes/swap.node.ts` | ✅ Copied |
| `src/nodes/KaminoNode.ts` | `backend/src/web3/nodes/kamino.node.ts` | ✅ Copied |
| `src/workflow-executor.ts` | `backend/src/workflows/executor.service.ts` | ✅ Copied |
| `src/utils/constant.ts` | `backend/src/web3/constants.ts` | ✅ Copied |
| `src/utils/connection.ts` | `backend/src/web3/services/connection.service.ts` | ✅ Adapted |
| `src/utils/token.ts` | `backend/src/web3/services/token.service.ts` | ✅ Copied |
| `src/utils/tx.ts` | `backend/src/web3/services/transaction.service.ts` | ✅ Copied |
| `src/telegram-notifier.ts` | `backend/src/telegram/telegram-notifier.service.ts` | ✅ Rewritten (English) |
| `database/initial.sql` | Unchanged | ✅ Use as-is |

### What's New

- **NestJS Architecture**: Modular, scalable structure
- **Dependency Injection**: Services easily testable
- **Global Guards/Filters**: Consistent auth & error handling
- **English Messages**: All user-facing text in English
- **API-First Design**: RESTful endpoints ready for frontend
- **TypeScript Paths**: Clean imports with `@auth/*`, `@workflows/*`

## 🎯 Future Enhancements

- [ ] Implement full workflow executor integration
- [ ] Add unit tests (Jest)
- [ ] Add E2E tests
- [ ] Add Swagger/OpenAPI documentation
- [ ] Add rate limiting
- [ ] Add caching (Redis)
- [ ] Add job queue (Bull) for async execution
- [ ] Add more workflow nodes (staking, lending, etc.)
- [ ] Add WebSocket for real-time updates
- [ ] Add metrics/monitoring (Prometheus)

---

✨ Your NestJS backend is ready to use!
