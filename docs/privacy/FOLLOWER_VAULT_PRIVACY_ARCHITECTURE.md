# Follower Vault Privacy Architecture

## 1. Design Decision

Chosen model:

- follower funds enter a dedicated `PDA vault`
- the `PDA vault` is the public control and authority shell
- sensitive strategy execution runs in `MagicBlock PER`
- sensitive balances and treasury visibility are handled by `Umbra`
- public discovery is allowed through delayed, coarse, and sanitized summaries

This gives the project a clear split:

- `PDA vault` = authority, determinism, public verifiability
- `PER` = encrypted strategy logic, follower allocation, private logs
- `Umbra` = encrypted balances, encrypted treasury state, selective visibility sharing

## 2. Why This Model Fits Your Goal

If follower funds only sit in a normal public PDA token account, the following still leak:

- vault identity
- exact vault balance
- subscription timing
- funding size
- mirror execution timing
- long-term strategy behavior through observed vault actions

Using a `PDA vault` alone gives custody and execution control, but not privacy.

The correct privacy-native interpretation is:

- keep the `PDA vault` as the authoritative execution container
- move sensitive vault state into `PER`
- move sensitive vault balances into `Umbra`

## 3. Public vs Private Boundaries

### Public

The following may remain public:

- strategy exists
- strategy creator exists
- follower vault exists
- subscription is active or inactive at a coarse level if product requires it
- delayed or bucketed strategy metrics
- delayed or bucketed follower count or TVL bands

### PER-Private

The following should be private inside `PER`:

- strategy parameters
- allocation formulas
- mirror sizing rules
- follower-specific limits
- rebalance decisions
- private execution logs
- order intent details
- vault-to-vault allocation outputs
- per-follower performance state

### Umbra-Private

The following should be private inside `Umbra`:

- creator treasury balances
- follower vault balances
- fee accrual balances
- private payouts and internal transfers
- selective visibility disclosures

## 4. Core Components

### 4.1 Strategy Deployment PDA

Existing deployment remains the top-level strategy runtime anchor.

Responsibilities:

- points to strategy version
- points to public snapshot
- points to private strategy state commitment
- identifies execution mode and treasury mode

### 4.2 Follower Subscription PDA

One subscription per `(deployment, follower)` pair.

Suggested seed:

- `strategy_subscription`
- `deployment_pda`
- `follower_wallet`

Suggested public fields:

- deployment
- follower wallet
- follower vault PDA
- lifecycle status
- visibility preset id
- created slot
- bump

Suggested private or PER-referenced fields:

- allocation mode
- max capital
- drawdown guard
- execution opt-ins
- self-visibility scope

### 4.3 Follower Vault PDA

This is the concrete vault shell that the follower funds.

Suggested seed:

- `follower_vault`
- `subscription_pda`

Responsibilities:

- serves as the deterministic on-chain vault handle
- owns the strategy-facing vault authority relationship
- points to PER private state ref
- points to Umbra treasury identity ref
- anchors revocation and lifecycle events

Suggested public fields:

- subscription
- deployment
- authority PDA
- custody mode
- lifecycle status
- public metrics ref
- bump

### 4.4 Follower Vault Authority PDA

Suggested seed:

- `follower_vault_authority`
- `follower_vault_pda`

Responsibilities:

- signs or delegates approved vault operations
- binds the vault to scoped execution permissions
- provides a stable authority surface for session-key or delegate execution

### 4.5 PER Private State

There are two private state domains:

- deployment-level strategy private state
- follower-level vault private state

Deployment-level private state contains:

- core strategy logic and parameters
- current signal buffers
- order construction details
- per-follower allocation outputs

Follower-level private state contains:

- follower-specific configuration
- latest mirror allocation
- private realized and unrealized performance details
- visibility entitlements
- private execution receipts

### 4.6 Umbra Treasury Identity

Each follower vault should have its own Umbra treasury identity.

Recommended model:

- one Umbra identity per follower vault

This is stronger than sharing one identity per deployment because it reduces cross-follower linkage risk.

## 5. What "Umbra Identity" Means Here

In this architecture, `Umbra identity` means the private-account identity bundle used to own and view the vault's encrypted treasury.

Operationally it includes:

- the signing identity used for Umbra-authorized operations
- the confidentiality identity used for encryption and decryption
- the registered encrypted user account
- the viewing and disclosure hierarchy used for selective sharing

Why this matters:

- if many vaults share the same Umbra identity, isolation gets weaker
- if each follower vault has its own Umbra identity, selective visibility and treasury isolation become much cleaner

## 6. Recommended Account Model

### 6.1 On-Chain Public Accounts

Suggested new accounts:

- `StrategySubscription`
- `FollowerVault`
- `FollowerVaultAuthority`
- `FollowerPublicSnapshot`

Suggested public invariants:

- no exact balance fields
- no raw allocation fields
- no raw signal fields
- only ids, lifecycle, authority, and coarse metrics refs

### 6.2 Off-Chain / PER-Private Records

Suggested private records:

- `strategy_private_state_blob`
- `follower_private_state_blob`
- `follower_allocation_plan`
- `private_execution_receipt`
- `visibility_grant_registry`

These records should be readable only via PER auth and role checks.

### 6.3 Umbra Treasury Records

Suggested treasury references:

- `umbra_identity_ref`
- `encrypted_user_account`
- `x25519_public_key`
- `mvk_ref`
- `disclosure_policy`

## 7. End-To-End Execution Flow

### Flow A: Subscribe And Create Follower Vault

1. follower chooses a public strategy from the discovery surface
2. backend creates `StrategySubscription` PDA intent
3. backend creates `FollowerVault` PDA and `FollowerVaultAuthority` PDA
4. backend provisions a dedicated Umbra identity for that follower vault
5. backend adds follower to the deployment PER permission model with subscriber-scoped visibility
6. subscription remains `pending_funding` until assets are funded and shielded

### Flow B: Fund And Shield Follower Vault

1. follower deposits assets toward the follower vault funding path
2. backend builds the funding instructions for the follower vault
3. assets are shielded into the vault's Umbra treasury domain
4. PER-private follower state marks available capital and allocation limits
5. subscription becomes `active`

### Flow C: Execute A Private Strategy Cycle

1. strategy trigger fires
2. strategy execution starts inside `PER`
3. PER evaluates private strategy logic
4. PER computes global action intent
5. PER computes follower-specific allocation outputs
6. PER writes updated deployment private state and follower private state
7. execution layer builds vault actions for each impacted follower vault
8. actions are submitted under scoped delegated authority or session permissions
9. Umbra treasury balances update privately
10. public snapshots publish only sanitized summaries

### Flow D: Follower Self-Visibility

1. follower authenticates against PER using wallet challenge flow
2. follower receives a private bearer token
3. follower reads only self-scoped private state
4. follower may optionally receive Umbra viewing capability limited to their vault

### Flow E: Audit Or Shared Visibility

1. creator creates a visibility grant
2. grant can target auditor, operator, or follower
3. grant scope can be full vault, time-scoped, or metrics-scoped
4. PER and Umbra both enforce the grant boundary
5. expired grants stop future access, while already disclosed data is not retroactively hidden

### Flow F: Unsubscribe Or Revoke

1. follower requests unsubscribe
2. pending private execution jobs settle
3. PER marks subscription `exiting`
4. private treasury can be unshielded or re-keyed based on product policy
5. session rights and visibility grants are revoked
6. subscription ends in `closed`

## 8. Execution Authority Model

The recommended authority path is:

- follower owns the subscription and initial vault approval
- `FollowerVaultAuthority PDA` is the vault-level execution authority
- scoped session keys or equivalent delegated tokens authorize repeated approved operations
- `PER` decides what should happen
- vault authority performs only pre-authorized classes of action

Important rule:

- strategy logic must not be encoded in the public authority layer
- the authority layer only executes approved outcomes from the private runtime

## 9. Visibility Model

### Creator

- full strategy private state
- full follower allocation view
- full treasury management rights

### Operator

- execution and health access
- limited private read depending on grant

### Subscriber

- only their own follower vault private state
- only their own private performance and balance views
- no direct access to other follower vaults or full strategy logic

### Auditor

- explicit and time-scoped grants only

### Public User

- only public discovery surface and sanitized snapshots

## 10. Proposed API Contract

The current repo already has deployment-level privacy endpoints such as [strategy deployment controller](file:///home/kuoba123/app-backend/backend/src/strategy-deployments/strategy-deployments.controller.ts). The missing part is follower-vault lifecycle and private execution orchestration.

The API contract below is designed to extend the existing style.

### 10.1 Public Discovery APIs

#### `GET /strategies/:id/public`

Returns:

- public strategy metadata
- public risk band
- delayed performance summary
- whether subscription is open

Must not return:

- exact follower balances
- exact current positions
- raw execution traces

### 10.2 Subscription APIs

#### `POST /deployments/:id/subscriptions`

Creates a follower subscription intent.

Request:

```json
{
  "followerWallet": "<wallet>",
  "visibilityPreset": "subscriber-self",
  "maxCapital": "1000000000",
  "allocationMode": "proportional",
  "maxDrawdownBps": 1000
}
```

Response:

```json
{
  "subscriptionId": "sub_...",
  "subscriptionPda": "...",
  "followerVaultPda": "...",
  "vaultAuthorityPda": "...",
  "status": "pending_funding"
}
```

#### `GET /deployments/:id/subscriptions/:subscriptionId`

Returns public lifecycle state for the follower subscription.

### 10.3 Funding And Shielding APIs

#### `POST /deployments/:id/subscriptions/:subscriptionId/fund-intent`

Builds the public funding path into the follower vault shell.

#### `POST /deployments/:id/subscriptions/:subscriptionId/shield`

Shields follower funds from the vault shell into the vault's Umbra treasury domain.

Request:

```json
{
  "mint": "<mint>",
  "amount": "1000000"
}
```

Response:

```json
{
  "status": "pending_callback",
  "queueSignature": "...",
  "callbackSignature": null,
  "umbraIdentityRef": "umbra_vault_..."
}
```

### 10.4 Private Visibility APIs

#### `GET /deployments/:id/subscriptions/:subscriptionId/per/auth/challenge`

Same pattern as deployment PER auth, but scoped to follower visibility.

#### `POST /deployments/:id/subscriptions/:subscriptionId/per/auth/verify`

Exchanges signature for follower-scoped PER token.

#### `GET /deployments/:id/subscriptions/:subscriptionId/private-state`

Returns follower-self private state only.

#### `GET /deployments/:id/subscriptions/:subscriptionId/private-balance`

Returns follower-self private treasury view.

### 10.5 Visibility Grant APIs

#### `POST /deployments/:id/subscriptions/:subscriptionId/visibility-grants`

Creates a bounded visibility grant.

Request:

```json
{
  "granteeWallet": "<wallet>",
  "scope": "vault-balance",
  "expiresAt": "2026-12-31T00:00:00.000Z"
}
```

Response:

```json
{
  "grantId": "grant_...",
  "status": "active",
  "scope": "vault-balance"
}
```

### 10.6 Private Execution APIs

#### `POST /deployments/:id/private-execution/cycles`

Starts a strategy cycle.

This is a creator/operator endpoint. It should not reveal the strategy action result in the response body.

Request:

```json
{
  "triggerType": "price",
  "triggerRef": "pyth:<feed>",
  "idempotencyKey": "cycle-001"
}
```

Response:

```json
{
  "cycleId": "cycle_...",
  "status": "accepted"
}
```

#### `GET /deployments/:id/private-execution/cycles/:cycleId`

Returns cycle status and sanitized execution metadata.

### 10.7 Unsubscribe And Exit APIs

#### `POST /deployments/:id/subscriptions/:subscriptionId/pause`

Pauses new mirror executions for this follower.

#### `POST /deployments/:id/subscriptions/:subscriptionId/unsubscribe`

Begins exit flow.

#### `POST /deployments/:id/subscriptions/:subscriptionId/redeem`

Unshields or withdraws follower treasury back to follower-controlled destination based on policy.

## 11. Proposed Internal Service Contract

Suggested internal service methods:

- `createFollowerSubscription()`
- `createFollowerVault()`
- `provisionFollowerUmbraIdentity()`
- `grantFollowerPerMembership()`
- `shieldFollowerFunds()`
- `executePrivateStrategyCycle()`
- `computeFollowerAllocations()`
- `applyFollowerVaultOperations()`
- `createVisibilityGrant()`
- `revokeVisibilityGrant()`
- `unsubscribeFollower()`

## 12. Data Model Additions

Suggested relational tables:

- `strategy_subscriptions`
- `follower_vaults`
- `follower_vault_umbra_identities`
- `follower_visibility_grants`
- `private_execution_cycles`
- `follower_execution_receipts`

Suggested `strategy_subscriptions` fields:

- id
- deployment_id
- follower_wallet
- subscription_pda
- follower_vault_pda
- vault_authority_pda
- status
- visibility_preset
- max_capital
- allocation_mode
- max_drawdown_bps
- per_member_ref
- umbra_identity_ref
- created_at
- updated_at

Suggested `follower_vaults` fields:

- id
- subscription_id
- deployment_id
- vault_pda
- authority_pda
- lifecycle_status
- private_state_ref
- public_snapshot_ref
- custody_mode
- created_at
- updated_at

## 13. Privacy-Safety Rules

- Never return raw strategy allocation logic in follower APIs
- Never store exact follower balances in public snapshot rows
- Never let follower private views enumerate sibling follower vaults
- Never reuse a single Umbra identity across unrelated follower vaults
- Never log private PER state in normal Nest logs

## 14. Recommended Build Order For This Architecture

1. add subscription and follower-vault data model
2. add follower vault PDA and authority PDA
3. provision one Umbra identity per follower vault
4. implement shield / unshield lifecycle for follower vault funds
5. implement follower-scoped PER private state and auth
6. implement private strategy cycle orchestration
7. implement visibility grants
8. implement unsubscribe and recovery flows

## 15. Bottom Line

Your preferred direction is viable, but only if it is interpreted correctly:

- follower funds in `PDA vault` is the right control model
- `PDA vault` alone is not enough for privacy
- the vault must execute through `PER`
- the vault treasury must live in `Umbra`

That is the version of `follower vault copy trading` that can legitimately be called privacy-native.
