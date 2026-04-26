# Strategy Platform — Dev Runbook

This runbook covers the day-to-day workflow for the strategy-platform stack
delivered in Weeks 1-6 of the workflow → strategy migration. It is the canonical
"how do I run this locally / on devnet?" reference; the conceptual spec lives
in `STRATEGY_PLATFORM_DEV_SPEC.md`.

## 1. Quickstart (local development)

```bash
# 1. Install dependencies
yarn install            # repo root (workflows, anchor)
cd backend && yarn install

# 2. Apply schema migrations (in order)
psql "$SUPABASE_DB_URL" -f src/database/schema/initial-1.sql
psql "$SUPABASE_DB_URL" -f src/database/schema/initial-2-auth-challenges.sql
psql "$SUPABASE_DB_URL" -f src/database/schema/initial-3-strategies.sql
psql "$SUPABASE_DB_URL" -f src/database/schema/initial-4-privacy.sql
psql "$SUPABASE_DB_URL" -f src/database/schema/initial-5-per.sql

# 3. Build the Anchor program (only when programs/ changes)
cd ../programs && anchor build
cd ../backend && npm run idl:sync   # mirrors target/idl/ -> backend/src/onchain/anchor/

# 4. Start the backend
npm run start:dev
# -> http://localhost:3000/api
# -> http://localhost:3000/api/docs   (Swagger)
# -> http://localhost:3000/metrics    (Prometheus exposition)
```

When the backend boots it prints an **adapter matrix**:

```
[StrategyPlatform] === adapter matrix ===
  onchain : noop
  er      : noop
  per     : noop
  pp      : noop
  umbra   : noop
======================
```

In dev all five being `noop` is expected — see §3 for how to flip individual
adapters into real mode.

## 2. Health, metrics, logs

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health/live` | Process is alive. No dependency exercise. |
| `GET /api/health/ready` | Probes DB + Solana RPC + ER + PER + PP + Umbra. Real-mode only — Noop adapters report `status: "skipped"`. |
| `GET /metrics` | Prometheus exposition. Includes `http_requests_total`, `http_request_duration_seconds`, `adapter_calls_total`, `adapter_call_duration_seconds`, plus default node metrics. |

Set `LOG_FORMAT=json` to emit JSON-line structured logs (recommended in
production / k8s / Loki). Every request gets an `X-Request-Id` correlation
header (echoed back in responses and propagated to error payloads).

## 3. Adapter matrix — env switching

| Adapter | Env var(s) → real | Noop fallback |
| --- | --- | --- |
| `onchain` | `STRATEGY_RUNTIME_PROGRAM_ID` + `STRATEGY_RUNTIME_KEEPER_SECRET` | Yes |
| `er`      | `MAGICBLOCK_ROUTER_URL` (optional `MAGICBLOCK_ER_RPC_URL`) | Yes |
| `per`     | `MAGICBLOCK_PER_ENDPOINT` (optional `MAGICBLOCK_PER_API_KEY`) | Yes |
| `pp`      | `MAGICBLOCK_PP_ENDPOINT` (optional `MAGICBLOCK_PP_API_KEY`) | Yes |
| `umbra`   | `UMBRA_MASTER_SEED` (optional `UMBRA_QUEUE_URL`, `UMBRA_INDEXER_URL`) | Yes |

Each adapter switches independently; you can run with `onchain=real` and
everything else still in noop, etc.

> Production guard: when `NODE_ENV=production`, the platform **refuses to
> boot** if any adapter is still in `noop`. To bypass for staging or canary,
> set `STRATEGY_ALLOW_NOOP_IN_PROD=true`.

## 4. Common errors & fixes

### 4.1 `Anchor strategy_runtime program not initialised`

Either the program id is wrong, or the keeper secret is missing. Check:

```bash
echo "$STRATEGY_RUNTIME_PROGRAM_ID"      # must be base58
echo "$STRATEGY_RUNTIME_KEEPER_SECRET"   # base58 secret OR JSON byte array
```

### 4.2 `idl:check` fails in CI

The IDL artifact in `programs/target/idl/strategy_runtime.json` differs from
`backend/src/onchain/anchor/strategy_runtime.json`. Run `npm run idl:sync`
locally and commit the result. The script normalizes JSON whitespace so cosmetic
diffs do not cause drift.

### 4.3 `PER auth token not found / expired / revoked` (401)

- Token expired (default TTL: 30 min — `PER_AUTH_TOKEN_TTL_MIN`).
- Deployment was closed: tokens are revoked on close.
- Wrong deployment: tokens are pinned to the deployment that issued them.

To get a fresh token:

```bash
# 1. Request challenge
curl "http://localhost:3000/api/deployments/$ID/per/auth/challenge?wallet=$WALLET"
# -> { data: { challenge, expiresAt } }

# 2. Sign the base58-decoded nonce with your wallet's ed25519 key, base58-encode

# 3. Verify
curl -X POST "http://localhost:3000/api/deployments/$ID/per/auth/verify" \
  -H 'Content-Type: application/json' \
  -d "{\"wallet\":\"$WALLET\",\"challenge\":\"$CHAL\",\"signature\":\"$SIG\"}"
# -> { data: { authToken, expiresAt } }
```

### 4.4 `MAGICBLOCK_PER_ENDPOINT not set` (when calling /per endpoints)

You hit a real-only endpoint while in noop mode. Either set the env var or use
the dev-friendly endpoints (challenge/verify still work in noop).

### 4.5 Throttle 429s during local development

Defaults: 120 req/min/IP. Override per environment via the `ThrottlerModule`
config in `app.module.ts` if you need to load-test.

## 5. Environment matrix (recommended setups)

### 5.1 Local hackathon dev (everything in-process)

```env
NODE_ENV=development
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_KEY=local
JWT_SECRET=devsecret
SOLANA_RPC_URL=https://api.devnet.solana.com
# All adapters stay noop unless you want to test a specific integration.
```

### 5.2 Devnet integration

```env
NODE_ENV=development
STRATEGY_RUNTIME_PROGRAM_ID=<deployed program id>
STRATEGY_RUNTIME_KEEPER_SECRET=<base58 secret>
SOLANA_RPC_URL=https://api.devnet.solana.com
MAGICBLOCK_ROUTER_URL=https://devnet-router.magicblock.app
MAGICBLOCK_PER_ENDPOINT=https://devnet-per.magicblock.app
MAGICBLOCK_PP_ENDPOINT=https://devnet-pp.magicblock.app
UMBRA_MASTER_SEED=<seed>
UMBRA_QUEUE_URL=https://devnet-queue.umbra.app
UMBRA_INDEXER_URL=https://devnet-indexer.umbra.app
```

### 5.3 Production

Same as 5.2 but `NODE_ENV=production`, `LOG_FORMAT=json`, no
`STRATEGY_ALLOW_NOOP_IN_PROD` (so missing integrations cause boot failure).

## 6. Running the e2e smoke

```bash
# Requires a running Supabase (local docker or remote) reachable through
# SUPABASE_URL + SUPABASE_SERVICE_KEY. Without them the suite skips.
STRATEGY_E2E=1 \
SUPABASE_URL=http://localhost:54321 \
SUPABASE_SERVICE_KEY=local \
JWT_SECRET=devsecret \
npm run test:e2e:strategy
```

Coverage:

1. Strategy create + publish
2. Deployment create with `executionMode=per` (PER auto-bootstrap)
3. PER challenge → verify (real ed25519 round-trip)
4. PER private-state read with bearer token
5. Private Payments balance schema
6. Lifecycle close → token revocation
7. `/api/health/live` and `/metrics` exposition

## 7. Useful scripts

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | Hot-reload Nest on file changes. |
| `npm run build` | Production build (`dist/`). |
| `npm run test` | Unit + integration tests. |
| `npm run test:cov` | Tests with coverage report. |
| `npm run test:e2e` | All e2e suites in `test/`. |
| `npm run test:e2e:strategy` | Strategy platform smoke only. |
| `npm run idl:sync` | Mirror `programs/target/idl/...` → backend. |
| `npm run idl:check` | CI guard: fails on IDL drift. |
| `npm run lint` | Lint with auto-fix. |

## 8. References

- `STRATEGY_PLATFORM_DEV_SPEC.md` — design and IR spec.
- `MIGRATION_REPORT.md` — historical context for the workflow → strategy
  transition.
- `programs/programs/strategy_runtime/` — Anchor program source.
