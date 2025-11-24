# API Routes Documentation

Complete API reference for the Solana Workflow Platform backend server.

## Base URL

```
http://localhost:3000/api
```

## Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

---

## 🔐 Auth Routes

Base path: `/api/auth`

### POST `/auth/challenge`

Request an authentication challenge for wallet-based login.

**Request:**
```json
{
  "walletAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "challenge": "Sign this message to authenticate with PinTool:\n\nNonce: abc123xyz\nTimestamp: 1699999999999\nWallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "expiresIn": 300
  }
}
```

**Description:**
- Generates a challenge message that the user must sign with their Solana wallet
- Challenge expires in 5 minutes (300 seconds)
- Use this challenge in the next step to verify wallet ownership

---

### POST `/auth/verify`

Verify the signed challenge and receive a JWT access token.

**Request:**
```json
{
  "walletAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "signature": "3yZe7d1AKnhtaVBS9KQXw7JjaYEPpVvXfFXv9Kfki5qc6hH9NcWY1wHpHXzSQLqZrqNcpPjxFj6KQdDh2TL8VJPC"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "walletAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  }
}
```

**Description:**
- Verifies the wallet signature against the challenge
- Issues a JWT token for authenticated API access
- Token should be used in `Authorization: Bearer <token>` header for protected endpoints
- Creates or updates user record in database

---

## 📱 Telegram Routes

Base path: `/api/telegram`

### POST `/telegram/webhook`

Internal webhook endpoint for Telegram Bot API.

**Request:** 
Telegram Update object (automatically sent by Telegram)

**Response:**
```json
{
  "ok": true
}
```

**Description:**
- Internal endpoint for receiving updates from Telegram Bot API
- Should be configured in Telegram Bot settings
- Not exposed in public API documentation
- Handles bot commands: `/start`, `/link`, `/status`, `/unlink`

**Supported Bot Commands:**
- `/start` - Start the bot and get instructions
- `/link <wallet-address>` - Link Telegram account to Solana wallet
- `/status` - Check linking status and notification settings
- `/unlink` - Unlink Telegram account from wallet

---

## 📋 Workflows Routes

Base path: `/api/workflows`

**Authentication Required:** All endpoints require JWT token

### GET `/workflows`

Get all workflows owned by the authenticated user.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "SOL Price Monitor",
      "description": "Monitor SOL price and execute trade",
      "is_active": true,
      "definition": {
        "nodes": [...],
        "connections": [...]
      },
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

**Description:**
- Returns all workflows for the authenticated user
- Workflows are filtered by `owner_wallet_address` via RLS

---

### POST `/workflows`

Create a new workflow.

**Request:**
```json
{
  "name": "SOL Price Monitor",
  "description": "Monitor SOL price and execute trade when conditions met",
  "definition": {
    "nodes": [
      {
        "id": "node-1",
        "type": "priceFeed",
        "parameters": {
          "token": "SOL",
          "network": "mainnet-beta"
        }
      },
      {
        "id": "node-2",
        "type": "jupiterSwap",
        "parameters": {
          "inputToken": "SOL",
          "outputToken": "USDC",
          "amount": 1.0
        }
      }
    ],
    "connections": [
      {
        "source": "node-1",
        "target": "node-2"
      }
    ]
  },
  "is_active": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "SOL Price Monitor",
    ...
  }
}
```

**Description:**
- Creates a new workflow with nodes and connections
- Workflow is owned by the authenticated user
- `definition` should follow the workflow schema with nodes and connections

---

### GET `/workflows/:id`

Get a specific workflow by ID.

**Parameters:**
- `id` (path) - Workflow UUID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "SOL Price Monitor",
    "description": "Monitor SOL price",
    "definition": { ... },
    ...
  }
}
```

**Description:**
- Retrieves a single workflow by its UUID
- User must own the workflow (enforced via RLS)

---

### PATCH `/workflows/:id`

Update an existing workflow.

**Parameters:**
- `id` (path) - Workflow UUID

**Request:**
```json
{
  "name": "Updated Workflow Name",
  "description": "Updated description",
  "is_active": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    ...
  }
}
```

**Description:**
- Updates workflow properties
- All fields are optional
- Can update name, description, definition, or is_active status

---

### DELETE `/workflows/:id`

Delete a workflow.

**Parameters:**
- `id` (path) - Workflow UUID

**Response:**
```json
{
  "success": true,
  "message": "Workflow deleted successfully"
}
```

**Description:**
- Permanently deletes a workflow
- Also deletes associated workflow executions and node executions (CASCADE)

---

### POST `/workflows/:id/execute`

Execute a workflow manually.

**Parameters:**
- `id` (path) - Workflow UUID

**Request:**
```json
{
  "accountId": "account-uuid",
  "triggerType": "manual"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "executionId": "987e6543-e21b-12d3-a456-426614174000",
    "status": "running",
    "startedAt": "2024-01-01T00:00:00Z"
  }
}
```

**Description:**
- Triggers manual execution of a workflow
- Creates a new workflow execution record
- Executes all nodes in the workflow sequentially
- Returns execution ID for tracking progress

---

## 💰 X402 Routes

Base path: `/api/x402`

Example endpoints demonstrating the x402 payment protocol.

### GET `/x402/premium`

Access premium content with micro-payment.

**Headers:**
- `X-Payment` (optional) - Base64-encoded payment proof

**First Request (no payment):**

**Response:**
```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": "0.1",
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana-devnet",
      "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "amount": 100,
      "recipient": "seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX",
      "recipientTokenAccount": "HyBjJjQe6q7Y8U2xkz7qCJB1s7YHrz4rUHFZnD5p8wqx"
    }
  ]
}
```

**Second Request (with payment):**

**Request Headers:**
```
X-Payment: eyJ4NDAyVmVyc2lvbiI6IjAuMSIsInNjaGVtZSI6ImV4YWN0...
```

**Response:**
```json
{
  "data": {
    "message": "Welcome to premium content!",
    "content": {
      "title": "Premium Feature Access",
      "description": "This is exclusive premium content that requires payment to access.",
      "benefits": [
        "Access to advanced features",
        "Priority support",
        "Exclusive data and insights",
        "Early access to new features"
      ],
      "timestamp": "2024-01-01T00:00:00Z"
    }
  },
  "paymentDetails": {
    "signature": "5xAbc...",
    "amount": 100,
    "amountUSDC": 0.0001,
    "recipient": "seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX",
    "explorerUrl": "https://explorer.solana.com/tx/...",
    "network": "solana-devnet",
    "confirmed": true
  }
}
```

**Description:**
- First request returns 402 with payment requirements
- Client creates transaction, signs, and encodes in X-Payment header
- Second request with payment returns protected content
- Payment is 0.0001 USDC on Solana devnet

---

### POST `/x402/query`

AI query endpoint with per-query micro-payment.

**Headers:**
- `X-Payment` (optional) - Base64-encoded payment proof

**Request:**
```json
{
  "query": "What is the current SOL price?"
}
```

**First Response (no payment):**
```http
HTTP/1.1 402 Payment Required

{
  "x402Version": "0.1",
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana-devnet",
      "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "amount": 50,
      ...
    }
  ]
}
```

**Second Response (with payment):**
```json
{
  "data": {
    "query": "What is the current SOL price?",
    "response": "Based on your query about 'What is the current SOL price?', here is the response...",
    "timestamp": "2024-01-01T00:00:00Z",
    "tokensUsed": 150
  },
  "paymentDetails": {
    "signature": "...",
    "amount": 50,
    "amountUSDC": 0.00005,
    ...
  }
}
```

**Description:**
- Pay-per-query AI endpoint
- Payment is 0.00005 USDC per query
- Simulated AI response (placeholder implementation)

---

### GET `/x402/info`

Get information about x402 payment protocol configuration.

**Response:**
```json
{
  "protocol": "x402",
  "version": "0.1",
  "network": "solana-devnet",
  "endpoints": [
    {
      "path": "/api/x402/premium",
      "description": "Premium content access",
      "priceUSDC": 0.0001
    },
    {
      "path": "/api/x402/query",
      "description": "AI query per-query payment",
      "priceUSDC": 0.00005
    }
  ],
  "paymentMethods": [
    {
      "scheme": "exact",
      "network": "solana-devnet",
      "asset": "USDC",
      "assetAddress": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    }
  ],
  "recipientWallet": "seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX"
}
```

**Description:**
- Returns configuration and pricing information
- Lists available x402-protected endpoints
- Shows supported payment methods and recipient addresses

---

## Available Workflow Nodes

The following node types are available for use in workflows:

### Web3 Nodes

1. **`priceFeed`** - Get token price from oracles
   - Parameters: `token`, `network`

2. **`jupiterSwap`** - Swap tokens using Jupiter aggregator
   - Parameters: `rpcUrl`, `keypairPath`, `inputToken`, `outputToken`, `amount`, `slippageBps`

3. **`kamino`** - Interact with Kamino vaults
   - Parameters: `operation` (deposit/withdraw), `vaultAddress`, `amount`, `keypairPath`, `network`

4. **`x402Client`** - Call x402-protected APIs with automatic payment
   - Parameters: `apiUrl`, `accountId`, `network`

### Future Nodes

- Transaction monitoring
- Webhook triggers
- Conditional logic
- Time-based triggers

---

## Error Responses

All endpoints follow a consistent error format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Common HTTP Status Codes

- `200 OK` - Request successful
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Missing or invalid authentication token
- `402 Payment Required` - Payment required (x402 endpoints)
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

---

## Rate Limiting

Currently no rate limiting is implemented. This may be added in future versions.

---

## Swagger/OpenAPI Documentation

Interactive API documentation is available at:

```
http://localhost:3000/api/docs
```

This provides a Swagger UI interface for testing API endpoints directly.
