# Native Privacy Implementation Plan

## 1. Goal

This plan defines how the project should evolve from "privacy primitives integrated" into a strategy platform that is privacy-native by default.

Target outcomes:

- Encrypted asset balances
- Encrypted strategy logic and private execution state
- Private strategy subscription and copy-trading execution
- Real delegated follower vaults with selective visibility sharing

The intended end state is not just "some hidden fields". It is a system where public surfaces are intentionally minimized and all sensitive strategy, balance, and follower activity is executed inside a privacy-preserving runtime.

## 2. What The Docs Actually Suggest

### MagicBlock

MagicBlock PER is the right primitive for private execution, private state, authorization, and low-latency confidential computation.

Useful primitives from the docs:

- Private Ephemeral Rollup (PER) for confidential execution inside Intel TDX-backed TEE
- Permission Program for account-level and group-level access control
- Challenge -> signed login -> bearer token flow for private state access
- Delegation / commit / undelegation lifecycle for moving state into and out of the private runtime
- Session keys for scoped delegated execution without repeated wallet prompts

Practical implication:

- Use MagicBlock PER to hide strategy parameters, execution state, private logs, private order intents, and follower allocation logic
- Do not use PER only as a read-protected dashboard feature; it must become the actual execution plane for sensitive strategy logic

### Umbra

Umbra is the right primitive for confidential balances, private treasury movement, unlinkable transfers, and selective disclosure.

Useful primitives from the docs:

- Encrypted balances
- Separate spending key and confidentiality key architecture
- Master Viewing Key (MVK) and derived viewing keys for selective disclosure
- Gasless relayer model for private flows
- Compliance-ready disclosure model for time-scoped or transaction-scoped sharing

Practical implication:

- Use Umbra as the private treasury layer for creator vaults and follower vaults
- Use Umbra viewing grants / viewing-key hierarchy for "shareable visibility"
- Do not expect Umbra alone to hide strategy logic; it hides balances and transfer graph, not the whole strategy engine

## 3. Current Repo Reality

The current repo already has useful building blocks, but it is not yet a privacy-native strategy system.

What is already true:

- Strategy deployments already separate `execution_mode` (`offchain` / `er` / `per`) and `treasury_mode` (`public` / `private_payments` / `umbra`)
- The on-chain `StrategyState` stores only a commitment and revision, which is a good privacy-friendly shape
- The on-chain `PublicSnapshot` is already modeled as a sanitized public surface
- PER auth flow is partially implemented: create group, request challenge, verify signature, read private state
- Private Payments API is integrated as unsigned transaction builder endpoints
- Umbra registration, deposit, withdraw, and encrypted-balance query are wired in

What is not yet true:

- There is no private strategy engine actually writing and executing sensitive logic inside PER
- There is no private follower orchestration model for copy trading
- `Umbra transfer` is not implemented
- `Umbra grantViewer` is not implemented
- Umbra client identity is shared at platform level, not isolated per deployment or per follower vault
- PER is currently used as an access-gated read path, not as the authoritative strategy runtime
- Private Payments is only a transaction builder, not the full private treasury system
- There is no follower vault delegation model that performs actual encrypted copy-trading execution

## 4. Gap Analysis Against Your Privacy Goals

### Goal A: Asset Balance Encryption

Status: partial.

You have Umbra registration and deposit / withdraw hooks, but not a complete private treasury model.

Missing pieces:

- Per-deployment Umbra identity isolation
- Per-follower private vault identity isolation
- Private transfer support between strategy treasury and follower vaults
- Viewer grant implementation for controlled sharing
- Treasury accounting that treats Umbra encrypted balances as the source of truth

### Goal B: Strategy Logic Encryption

Status: mostly missing.

The repo stores commitments to private definition and private state, but actual strategy logic still effectively lives outside PER.

Missing pieces:

- PER-resident encrypted execution state
- Strategy signal generation inside PER
- Private logs and decision traces inside PER
- Private order construction and follower allocation logic inside PER

### Goal C: Private Strategy + Private Subscription / Copy-Trading Execution

Status: conceptual only.

The repo has `subscriber` as a role label, but there is not yet a full private subscriber lifecycle.

Missing pieces:

- Encrypted subscription registry
- Follower enrollment and permissioning model
- Follower-specific allocation rules in PER private state
- Private execution fan-out from creator strategy to follower vaults
- Private performance reporting for each follower

### Goal D: Delegated Follower Vault With Real Copy-Trading Ability And Shareable Visibility

Status: missing.

Today there is no actual delegated vault runtime for followers that can privately mirror trades.

Missing pieces:

- Follower vault creation and delegation flow
- Session-key or scoped delegated signer model for follower execution
- Private route from strategy execution result to follower vault operation
- Per-follower selective visibility grants
- Operational model for revocation, unsubscribe, settlement, and audit

## 5. Important Design Decision

You cannot reach your target with a single privacy system.

Recommended split:

- MagicBlock PER = private execution plane
- Umbra = private treasury plane
- Public snapshot layer = intentionally reduced public discovery surface

This means the product should be designed as three planes:

- Public strategy surface
- Private strategy runtime
- Private treasury and follower vaults

## 6. Recommended End-State Architecture

### Public Surface

Public data should be limited to:

- strategy id
- creator identity or pseudonymous profile
- delayed or coarsened performance metrics
- fee model
- risk band
- subscription availability
- aggregate follower count bands if desired

Public data should not expose:

- live positions
- exact trade timing
- signal inputs
- parameter values
- follower identities
- follower vault balances
- raw private logs

### Private Strategy Runtime (MagicBlock PER)

Each deployment should have PER-private state containing:

- strategy parameters
- signal buffers
- execution cursor
- pending order intents
- risk limits
- subscriber registry or encrypted references to it
- follower allocation model
- private execution logs

PER permission groups should support at least these roles:

- creator
- operator
- subscriber
- auditor

The role should map to actual capability flags, not just a label.

Recommended visibility model:

- creator: full private state and logs
- operator: execution access, limited read
- subscriber: only self-related private outputs
- auditor: time-scoped or explicit audit visibility

### Private Treasury Plane (Umbra)

Use Umbra for:

- creator strategy treasury
- follower mirror vault treasury
- private fee accrual
- private payout / rebate / subscription settlement

Critical rule:

- Do not use one global Umbra identity for all deployments in production

Use one of these models instead:

- one Umbra identity per deployment and one per follower vault
- one Umbra identity per user plus per-deployment derived isolation domain

The first option is simpler and safer for privacy isolation.

### Copy-Trading Execution Plane

The copy-trading path should work like this:

1. Follower subscribes to a strategy.
2. Follower creates or links a dedicated follower vault.
3. Follower grants scoped delegated execution rights.
4. Follower deposits assets into a private Umbra-backed vault.
5. Strategy runtime inside PER computes creator action plus follower allocations.
6. Private execution service produces private vault operations for each follower.
7. Resulting balances remain private; follower sees only allowed views.
8. Public layer receives only sanitized aggregated metrics.

This is the key point: copy-trading should be driven by private allocation results inside PER, not by broadcasting cleartext signals to followers.

## 7. Product-Level Privacy Rules

To call the system "privacy-native", adopt these rules:

- Private state is authoritative; public state is a derived snapshot
- Strategy execution happens in PER whenever the action reveals alpha
- Treasury movement defaults to Umbra
- Subscription state is encrypted or at least PER-private
- Followers do not receive raw strategy logic
- Visibility sharing must be grant-based and revocable for future access
- Public metrics must be delayed, bucketed, or coarsened to reduce inference risk

## 8. Phased Implementation Plan

### Phase 0: Privacy Spec And Threat Model

Deliverables:

- Define exact privacy target for creator, follower, auditor, operator, and public user
- Define what metadata may still be public
- Define acceptable leakage windows for snapshots and settlements
- Decide whether followers are "blind subscribers" or "self-transparent subscribers"

Key question:

- If followers can see every exact trade immediately, they can infer strategy behavior over time. If you want stronger strategy secrecy, follower-facing data must be filtered or delayed.

### Phase 1: Fix The Current Foundations

Objective:

- Turn current integrations from demo-level primitives into correct isolation boundaries

Tasks:

- Replace platform-shared Umbra identity with per-deployment and per-follower identities
- Add explicit deployment privacy status model: `public`, `private_bootstrapping`, `private_active`, `private_degraded`
- Persist PER permission flags, not just roles
- Add encrypted follower-subscription domain model
- Define a canonical `private_state_ref` object for PER-backed strategy state blobs

Acceptance criteria:

- No private deployment shares a treasury identity with unrelated deployments
- Role grants are capability-based, not only label-based

### Phase 2: Private Treasury MVP

Objective:

- Achieve real encrypted balances for creator strategy vaults

Tasks:

- Make Umbra encrypted balances the source of truth for strategy treasury accounting
- Implement deposit / withdraw reconciliation around Umbra queue + callback lifecycle
- Implement private fee vaults
- Implement viewer grants for creator and auditor use cases
- Keep Private Payments API only as a bridge for shield / unshield flows where useful

Acceptance criteria:

- Strategy TVL is not directly readable from public token accounts
- Creator can privately inspect treasury
- Auditor can receive a bounded disclosure grant

### Phase 3: Private Strategy Runtime MVP

Objective:

- Move sensitive strategy logic into PER

Tasks:

- Introduce PER-private strategy state schema
- Move parameter storage and signal evaluation into PER
- Move private logs and execution traces into PER
- Keep on-chain `StrategyState` commitment-only
- Keep `PublicSnapshot` coarse and intentionally sanitized
- Add session-key model for scoped operator automation

Acceptance criteria:

- Strategy parameters are never served from normal backend APIs
- Raw strategy execution state is accessible only through PER auth and group membership
- Public users can discover strategy existence without reconstructing logic

### Phase 4: Private Subscription And Copy-Trading

Objective:

- Build real follower vault execution instead of placeholder subscriber roles

Tasks:

- Create `follower_vaults` domain model
- Create `strategy_subscriptions` domain model with encrypted or PER-private follower config
- Support follower vault funding into Umbra-backed balances
- Introduce scoped delegated execution rights via session keys or equivalent scoped signers
- Compute follower allocations inside PER
- Execute follower operations without revealing the creator's raw decision trace publicly
- Add unsubscribe / revoke / settlement flow

Acceptance criteria:

- A follower can subscribe and receive real mirrored execution
- Follower vault operations do not require public disclosure of strategy logic
- Public observers cannot trivially enumerate follower balances or mirror graph

### Phase 5: Selective Visibility Sharing

Objective:

- Support the "can share visibility" requirement safely

Tasks:

- Implement Umbra viewer grants using MVK-derived bounded visibility
- Add share presets: `creator-only`, `subscriber-self`, `auditor-window`, `coarse-public`
- Add PER-side role-to-view mapping for logs and state
- Add grant expiry, revocation, and audit trail

Acceptance criteria:

- Creator can share part of a strategy vault view without exposing all history
- Subscriber can see only their own private performance or vault state if intended
- Auditor can get time-scoped visibility without getting unrestricted permanent access

### Phase 6: Hardening, Security, And Operations

Objective:

- Make privacy features production-safe

Tasks:

- Add attestation verification for PER environments
- Add rollback and degraded-mode behavior when PER or Umbra callbacks fail
- Add emergency undelegation and treasury recovery procedures
- Add privacy-safe observability that avoids logging sensitive state
- Add end-to-end test matrix for creator, follower, and auditor roles

Acceptance criteria:

- Infra or callback failures do not silently push the product into public-mode behavior
- Sensitive state is never emitted into normal application logs

## 9. Recommended Data Model Additions

Add or formalize these entities:

- `strategy_private_states`
- `strategy_private_logs`
- `strategy_subscriptions`
- `follower_vaults`
- `follower_allocations`
- `visibility_grants`
- `privacy_attestations`
- `private_settlement_jobs`

Recommended fields for follower subscriptions:

- subscription id
- deployment id
- follower wallet
- follower vault id
- subscription status
- allocation mode
- max drawdown guard
- max capital allocation
- visibility preset
- per grant references
- umbra vault reference
- per member reference

## 10. What To Avoid

- Do not market Private Payments API alone as "complete native privacy"
- Do not keep follower subscription state in public relational rows without encryption or PER isolation
- Do not let public snapshots publish exact trade timing or granular PnL deltas
- Do not use a single platform Umbra signer as the long-term tenant-isolation model
- Do not expose PER private state back through regular backend APIs after decrypting server-side

## 11. Suggested Build Order

If the goal is speed with the least architectural regret, build in this order:

1. Phase 0 privacy spec
2. Phase 1 isolation fixes
3. Phase 2 private treasury MVP
4. Phase 3 private strategy runtime MVP
5. Phase 4 private copy-trading
6. Phase 5 selective visibility sharing
7. Phase 6 hardening

## 12. My Recommendation

If your real target is "natively complete privacy", the correct core architecture is:

- PER for strategy logic and follower allocation execution
- Umbra for creator and follower private balances
- Public snapshots only as delayed and sanitized outputs

In other words:

- `MagicBlock PER` should become your private brain
- `Umbra` should become your private money layer
- `copy-trading` should become a private fan-out runtime, not a public signal relay

That is the architecture that best matches your stated goal.

## 13. Chosen Follower Vault Direction

Based on the latest product decision, the preferred model is:

- follower capital enters a dedicated `PDA vault`
- the `PDA vault` is the public control shell and execution anchor
- the vault's sensitive execution state lives in `MagicBlock PER`
- the vault's sensitive balances live in `Umbra`
- public discovery remains allowed, but only through sanitized strategy and vault summaries

This means the target architecture is not "replace PDA vaults with privacy tech". It is:

- `PDA vault` for authority and deterministic on-chain ownership
- `PER` for encrypted strategy execution and allocation logic
- `Umbra` for encrypted treasury state and selective disclosure

For the concrete account model and API contract, see [FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md](./FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md).
