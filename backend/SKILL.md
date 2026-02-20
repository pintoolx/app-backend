---
name: pintool
description: "Automates DeFi workflows on Solana via PinTool REST API — price monitoring, token swaps, lending, staking, and transfers using Crossmint custodial wallets. Use when building or executing automated on-chain strategies on Solana."
---

# PinTool Agent API

Automate DeFi workflows on Solana through a REST API. Agents authenticate with a Solana wallet signature, create workflow definitions (DAG of on-chain operations), then assign them to custodial accounts for automatic execution.

## Capabilities

- Register and authenticate with a Solana wallet to obtain an API key
- Create workflow definitions composed of connectable DeFi node types
- Provision Crossmint MPC custodial wallets for isolated execution
- Automatic workflow execution via backend lifecycle polling (no manual trigger)
- Close accounts with automatic asset withdrawal back to the owner wallet

## Workflow

```
1. POST /api/auth/challenge        → Get challenge message
2. Sign challenge with Solana wallet (Ed25519 + base58)
3. POST /api/agent/register        → Get API key (shown once, re-register to rotate)
4. POST /api/agent/workflows       → Create workflow definition → get workflow_id
5. POST /api/agent/wallets/init    → Create account with workflowId → auto-executes
```

All requests after step 3 require the `X-API-Key` header.

### API Key Storage

The API key is **only shown once** upon registration. You must persist it immediately.

- **Environment variable** (recommended for production): Store as `PINTOOL_API_KEY` in `.env` or a secrets manager (e.g., AWS Secrets Manager, Vault, Doppler).
- **JSON file** (recommended for local/agent use): Store in a local JSON config file (e.g., `~/.pintool/credentials.json`), and add the file to `.gitignore`.
- **Never** hard-code the key in source code or commit it to version control.
- **Lost key?** Re-call `POST /api/agent/register` with a new wallet signature. This rotates the key — the previous key is invalidated.

```bash
# .env
PINTOOL_API_KEY=pt_live_...
```

```jsonc
// ~/.pintool/credentials.json
{
  "apiKey": "pt_live_..."
}
```

```typescript
// Load from env or JSON file
const apiKey = process.env.PINTOOL_API_KEY
  ?? JSON.parse(fs.readFileSync('~/.pintool/credentials.json', 'utf-8')).apiKey;
if (!apiKey) throw new Error('Missing PINTOOL_API_KEY');
```

> **Tip:** Before creating a workflow, call `GET /api/agent/nodes` to discover all available node types and their exact parameter schemas.

## API Reference

**Base URL:** `https://pintool-api.zeabur.app/api`

### Authentication

#### Get Challenge

```http
POST /api/auth/challenge
Content-Type: application/json

{"walletAddress": "<SOLANA_ADDRESS>"}
```

Returns a challenge string valid for 5 minutes.

#### Register Agent

Sign the challenge with Ed25519 (`nacl.sign.detached`), base58-encode the signature.

```http
POST /api/agent/register
Content-Type: application/json

{"walletAddress": "<SOLANA_ADDRESS>", "signature": "<BASE58_SIGNATURE>"}
```

Returns `{"apiKey": "pt_live_..."}`. Save it — only shown once. Re-registering rotates the key.

### Node Discovery

#### List Available Nodes

Returns all registered node types with their parameter schemas. Call this before creating workflows to get the exact parameters each node accepts.

```http
GET /api/agent/nodes
```

Returns:

```json
{
  "success": true,
  "data": [
    {
      "type": "jupiterSwap",
      "displayName": "Jupiter Swap",
      "description": "Swap tokens using Jupiter aggregator with Crossmint custodial wallet",
      "group": ["swap"],
      "inputs": ["main"],
      "outputs": ["main"],
      "isTrigger": false,
      "telegramNotify": true,
      "parameters": [
        {"name": "inputToken", "type": "string", "default": "USDC", "description": "..."},
        {"name": "outputToken", "type": "string", "default": "SOL", "description": "..."},
        {"name": "amount", "type": "string", "default": "auto", "description": "..."},
        {"name": "slippageBps", "type": "string", "default": "50", "description": "..."}
      ]
    }
  ]
}
```

### Workflows

#### Create Workflow

```http
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

#### Execution Model

Workflows are **not triggered manually**. Execution is automatic:

1. Create a workflow → get `workflow_id`
2. Create an account with `workflowId` → lifecycle manager starts execution immediately
3. Backend polls every 60s, re-launches workflows for active accounts after completion

Execution records are persisted in the `workflow_executions` table.

### Accounts

#### List Accounts

```http
GET /api/agent/accounts
X-API-Key: <key>
```

#### Create Account

Creates a Crossmint MPC custodial wallet and optionally assigns a workflow.

```http
POST /api/agent/wallets/init
X-API-Key: <key>
Content-Type: application/json

{"accountName": "My Trading Bot", "workflowId": "<workflow_id>"}
```

- `accountName` (required): Display name for the account.
- `workflowId` (optional): Workflow to auto-execute. Omit to create an idle account.

#### Close Account

Withdraws all assets (SPL tokens + SOL) back to the owner wallet, then soft-deletes.

```http
DELETE /api/agent/wallets/<account_id>
X-API-Key: <key>
```

## Node Types

Call `GET /api/agent/nodes` to get the full list of available node types with their exact parameter schemas. This endpoint is always in sync with the codebase and should be the source of truth when building workflow definitions.

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

Nodes execute as a DAG following the connection graph. Each node's output is passed as input to connected downstream nodes. Set `telegramNotify: true` on a node to receive Telegram notifications for that step.

## Supported Tokens

SOL, USDC, JITOSOL, mSOL, bSOL, jupSOL, INF, hSOL, stSOL

## Error Format

```json
{"success": false, "error": {"code": "ERROR_TYPE", "message": "description", "timestamp": "ISO8601"}}
```
