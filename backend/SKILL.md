---
name: pintool
description: PinTool is a Web3 workflow automation platform on Solana. Use this skill when the user wants to create automated DeFi workflows (price monitoring, token swaps, lending, staking, transfers) using custodial Crossmint wallets. Requires a Solana wallet for registration.
---

# PinTool Agent API

Automate DeFi workflows on Solana via PinTool's REST API.

**Base URL:** `https://api.pintool.xyz/api`

## Quick Start

```
1. POST /api/auth/challenge     → Get challenge message
2. Sign the challenge with your Solana wallet private key
3. POST /api/agent/register     → Get API key (one-time)
4. Use X-API-Key header for all subsequent requests
```

## Authentication

### Step 1: Get Challenge

```
POST /api/auth/challenge
Content-Type: application/json

{"walletAddress": "<YOUR_SOLANA_WALLET_ADDRESS>"}
```

Response:
```json
{"success": true, "data": {"challenge": "Sign this message to authenticate with PinTool:\n\nNonce: abc123\nTimestamp: 1699999999999\nWallet: <address>", "expiresIn": 300}}
```

### Step 2: Sign & Register

Sign the challenge string with your Solana wallet's private key using Ed25519 (`nacl.sign.detached`), then base58-encode the signature.

```
POST /api/agent/register
Content-Type: application/json

{"walletAddress": "<YOUR_WALLET>", "signature": "<BASE58_SIGNATURE>"}
```

Response:
```json
{"success": true, "data": {"apiKey": "pt_live_xxxxxxxxxxxx...", "walletAddress": "<YOUR_WALLET>"}}
```

**Save the API key.** It is only shown once. To rotate, call register again (old key is revoked).

### Step 3: Use API Key

All subsequent requests require:
```
X-API-Key: pt_live_xxxxxxxxxxxx...
```

## Endpoints

### Accounts

#### List Accounts
```
GET /api/agent/accounts
X-API-Key: <key>
```

#### Create Account (with Crossmint custodial wallet)
```
POST /api/agent/wallets/init
X-API-Key: <key>
Content-Type: application/json

{"accountName": "My Trading Bot"}
```

Response:
```json
{"success": true, "data": {"id": "<uuid>", "name": "My Trading Bot", "crossmint_wallet_address": "<solana_address>", "crossmint_wallet_locator": "..."}}
```

#### Close Account (auto-withdraws all assets to your wallet)
```
DELETE /api/agent/wallets/<account_id>
X-API-Key: <key>
```

### Workflows

#### Create Workflow
```
POST /api/agent/workflows
X-API-Key: <key>
Content-Type: application/json

{
  "name": "SOL Price Monitor & Swap",
  "description": "When SOL > $200, swap 10 USDC to SOL",
  "definition": {
    "nodes": [
      {
        "id": "price1",
        "name": "Monitor SOL Price",
        "type": "pythPriceFeed",
        "parameters": {"priceId": "SOL", "targetPrice": "200", "condition": "above"}
      },
      {
        "id": "swap1",
        "name": "Swap USDC to SOL",
        "type": "jupiterSwap",
        "parameters": {"inputToken": "USDC", "outputToken": "SOL", "amount": "10", "slippageBps": "50"}
      }
    ],
    "connections": {
      "price1": {"main": [[{"node": "swap1", "type": "main", "index": 0}]]}
    }
  }
}
```

#### Execute Workflow
```
POST /api/agent/workflows/<workflow_id>/execute
X-API-Key: <key>
Content-Type: application/json

{"accountId": "<account_id>"}
```

#### Check Execution Status
```
GET /api/agent/workflows/<workflow_id>/executions/<execution_id>
X-API-Key: <key>
```

## Available Node Types

| Type | Description | Key Parameters |
|------|-------------|----------------|
| `pythPriceFeed` | Monitor token price via Pyth | `priceId`, `targetPrice`, `condition` (above/below) |
| `jupiterSwap` | Swap tokens via Jupiter | `inputToken`, `outputToken`, `amount`, `slippageBps` |
| `jupiterLimitOrder` | Limit order via Jupiter | `inputToken`, `outputToken`, `amount`, `targetPrice` |
| `kamino` | Deposit/withdraw from Kamino vaults | `operation` (deposit/withdraw), `vault`, `amount` |
| `transfer` | Transfer SOL or SPL tokens | `recipient`, `token`, `amount`, `accountId` |
| `getBalance` | Query wallet balance | `token`, `condition`, `threshold` |
| `stakeSOL` | Stake SOL | `amount`, `validator` |
| `luloLend` | Lend via Lulo | `token`, `amount`, `operation` |
| `driftPerp` | Perpetuals on Drift | `market`, `side`, `amount`, `leverage` |
| `sanctumLst` | Liquid staking via Sanctum | `operation`, `amount` |
| `heliusWebhook` | Listen for on-chain events | `webhookUrl`, `transactionTypes` |

## Supported Tokens

SOL, USDC, JITOSOL, mSOL, bSOL, jupSOL, INF, hSOL, stSOL

## Workflow Definition Format

```json
{
  "nodes": [
    {"id": "string", "name": "string", "type": "<node_type>", "parameters": {}, "telegramNotify": true}
  ],
  "connections": {
    "<source_node_id>": {
      "main": [[{"node": "<target_node_id>", "type": "main", "index": 0}]]
    }
  }
}
```

Nodes execute sequentially following the connection graph. Each node's output is passed as input to the next node.

## Error Format

All errors return:
```json
{"success": false, "error": {"code": "ERROR_TYPE", "message": "description", "timestamp": "ISO8601"}}
```

## Rate Limits

API key requests are not rate-limited by default. Abuse will result in key revocation.
