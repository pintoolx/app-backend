---
date: 2026-05-08
type: internal Anchor program spec
program: strategy_runtime
program_id: FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF
anchor_version: 0.32.1
er_sdk_version: 0.12.0
status: live (devnet + localnet)
source: programs/programs/strategy_runtime
---

# strategy_runtime — Anchor Program Spec

Single Anchor program backing the strategy platform. Each off-chain DB
row (`strategy_versions`, `strategy_deployments`, `strategy_subscriptions`,
`follower_vaults`) gets a mirrored on-chain PDA, derived from a 16-byte
UUID so the chain can be re-indexed without Postgres.

The chain holds **commitments, authority and lifecycle metadata only**.
Treasury balances live in Umbra; private execution state lives in PER.
On-chain is the public control shell plus a replay-protected revision
counter.

---

## Program at a glance

| | Count | Detail |
|---|---|---|
| PDAs | 8 | 5 deployment-side + 3 follower-side |
| Instructions | 21 | Plus auto-injected `process_undelegation` (`#[ephemeral]`) |
| Lifecycle FSMs | 2 | Deployment (5 states) + follower vault (5 states) |
| Custody encodings | 2 | ⚠️ Not 1:1 across creator vs follower (see Enums) |
| Phase split | — | Phase 1 = creator/strategy lifecycle, Phase 2 = followers, ER block, Phase 4 = closure & emergency |

Reserved tail per account: 64 bytes (`RESERVED_ACCOUNT_BYTES`), except
`StrategyDeployment` whose tail is 32 bytes — the other 32 are carved
out as the `keeper` field without changing total account size, so
already-deployed accounts deserialise unchanged (the carved bytes were
zeroed and decode as `Pubkey::default()` until `set_keeper` runs).

---

## PDAs

### Deployment side

#### `StrategyVersion`

Immutable snapshot of a published strategy revision.

```
seeds: [b"strategy_version", strategy_id (16B), version (4B LE)]
```

| Field | Type | Note |
|---|---|---|
| `creator` | Pubkey | Author wallet |
| `strategy_id` | [u8; 16] | UUID mirroring `strategies.id` |
| `version` | u32 | Monotonic revision |
| `public_metadata_hash` | [u8; 32] | Hash of sanitised public metadata |
| `private_definition_commitment` | [u8; 32] | Commitment over the full IR |
| `registered_slot` | u64 | |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

#### `StrategyDeployment`

Binds a deployment to a `StrategyVersion`. Drives the deployment FSM.

```
seeds: [b"strategy_deployment", deployment_id (16B)]
```

| Field | Type | Note |
|---|---|---|
| `creator` | Pubkey | Sole authority for lifecycle/keeper changes |
| `strategy_version` | Pubkey | Pinned `StrategyVersion` PDA |
| `vault_authority` | Pubkey | Backwired by `initialize_vault_authority` |
| `deployment_id` | [u8; 16] | UUID mirroring `strategy_deployments.id` |
| `execution_mode` | u8 | See `ExecutionMode` |
| `lifecycle_status` | u8 | See `LifecycleStatus` |
| `deployment_nonce` | u64 | Off-chain assigned |
| `initialized_slot` | u64 | |
| `bump` | u8 | |
| `keeper` | Pubkey | `Pubkey::default()` ⇒ creator-only |
| `_reserved` | [u8; 32] | Tail (kept smaller — keeper carved out) |

Keeper rule: `is_authorized_keeper(s)` returns true iff `s == creator`,
or `keeper != Pubkey::default() && s == keeper`. Nothing silently opens
when keeper is unset, even if the signer happens to be the all-zero
pubkey (test asserts this).

`SIZE = 203` (asserted in unit tests).

#### `StrategyState`

Replay-protected pointer to the latest private-state commitment. ER
delegation attaches here.

```
seeds: [b"strategy_state", deployment]
```

| Field | Type | Note |
|---|---|---|
| `deployment` | Pubkey | |
| `lifecycle_status` | u8 | Mirrored from deployment |
| `state_revision` | u32 | Strict +1 increment per commit |
| `private_state_commitment` | [u8; 32] | |
| `last_result_code` | u32 | Free-form result code from off-chain runner |
| `last_commit_slot` | u64 | |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

#### `VaultAuthority`

Program-controlled authority for treasury custody. Phase 1 only persists
routing fields; transfer instructions land later (see Known gaps).

```
seeds: [b"vault_authority", deployment]
```

| Field | Type | Note |
|---|---|---|
| `deployment` | Pubkey | |
| `creator` | Pubkey | Mirrored from deployment |
| `custody_mode` | u8 | 0=public_self_custody, 1=program_owned, 2=private_payments_relay |
| `status` | u8 | 0=active, 1=frozen |
| `allowed_mint_config_hash` | [u8; 32] | Empty until configured |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

`SIZE = 171` (asserted; `collect_fees` uses it to compute the rent-exempt floor).

#### `PublicSnapshot`

Sanitised marketplace/leaderboard view. Strictly monotonic
`snapshot_revision`.

```
seeds: [b"public_snapshot", deployment]
```

| Field | Type | Note |
|---|---|---|
| `deployment` | Pubkey | |
| `snapshot_revision` | u32 | Strictly increasing |
| `published_slot` | u64 | |
| `status_code` | u8 | 0=running, 1=paused, 2=stopped, 3=closed |
| `risk_band` | u8 | 0=unknown, 1=low, 2=medium, 3=high |
| `pnl_summary_bps` | i32 | Signed; can be negative |
| `public_metrics_hash` | [u8; 32] | Hash over the off-chain metrics blob |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

### Follower side

#### `StrategySubscription`

One per `(deployment, follower)`. Public anchor for a follower's
enrolment. Sensitive subscription config (max capital, drawdown guard,
allocation mode) stays off-chain or in PER.

```
seeds: [b"strategy_subscription", deployment, follower]
```

| Field | Type | Note |
|---|---|---|
| `deployment` | Pubkey | |
| `follower` | Pubkey | |
| `follower_vault` | Pubkey | Backwired by `initialize_follower_vault` |
| `subscription_id` | [u8; 16] | UUID mirroring DB row |
| `lifecycle_status` | u8 | See `FollowerVaultLifecycleStatus` |
| `created_slot` | u64 | |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

#### `FollowerVault`

Public control shell for a follower's funds. Treasury balances are in
Umbra; execution state in PER. Only authority + lifecycle live here.

```
seeds: [b"follower_vault", subscription]
```

| Field | Type | Note |
|---|---|---|
| `subscription` | Pubkey | |
| `deployment` | Pubkey | Mirrored for read-side joins |
| `follower` | Pubkey | |
| `authority` | Pubkey | Backwired by `initialize_follower_vault_authority` |
| `vault_id` | [u8; 16] | UUID mirroring `follower_vaults.id` |
| `lifecycle_status` | u8 | See `FollowerVaultLifecycleStatus` |
| `custody_mode` | u8 | 0=program_owned, 1=self_custody, 2=private_payments_relay |
| `created_slot` | u64 | |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

#### `FollowerVaultAuthority`

Stable authority surface for delegate / session-key flows on a follower
vault.

```
seeds: [b"follower_vault_authority", follower_vault]
```

| Field | Type | Note |
|---|---|---|
| `follower_vault` | Pubkey | |
| `follower` | Pubkey | Mirrored from vault |
| `status` | u8 | 0=active, 1=frozen |
| `allowed_mint_config_hash` | [u8; 32] | Empty until configured |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

---

## Enums (single byte on-chain)

### `LifecycleStatus` — deployment + strategy_state

```
Draft (0) ─► Deployed (1) ─► Stopped (3) ─► Closed (4)
              │     ▲
              ▼     │
            Paused (2)
              │
              └──► Stopped (3)
```

Any other transition returns `InvalidLifecycleTransition`.
`Closed` is terminal.

### `ExecutionMode`

| Code | Variant |
|---|---|
| 0 | `Offchain` |
| 1 | `Er` |
| 2 | `Per` |

### `FollowerVaultLifecycleStatus` — subscription + follower_vault

```
PendingFunding (0) ─► Active (1) ─► Exiting (3) ─► Closed (4)
        │              │     ▲
        │              ▼     │
        │            Paused (2)
        │              │
        │              └──► Exiting (3)
        │
        └─────────────────────────────► Closed (4)
```

### Custody modes — ⚠️ two different encodings

| Code | `VaultAuthority` (creator) | `FollowerVault` (follower) |
|---|---|---|
| 0 | `public_self_custody` | `program_owned` |
| 1 | `program_owned` | `self_custody` |
| 2 | `private_payments_relay` | `private_payments_relay` |

The two custody-mode enums are **not** byte-equivalent. Off-chain code
must not assume they map 1:1.

---

## Instructions

Twenty-one explicit entrypoints in `lib.rs`, plus the SDK-injected
`process_undelegation` (auto-emitted by `#[ephemeral]` on the program
module — there is no hand-rolled wrapper to avoid IDL discriminator
collision).

### Phase 1 — Creator / strategy lifecycle

```rust
initialize_strategy_version(strategy_id, version, public_metadata_hash, private_definition_commitment)
  // creator self-signs; one StrategyVersion per (strategy_id, version).

initialize_deployment(deployment_id, execution_mode, deployment_nonce)
  // requires strategy_version.creator == creator
  // lifecycle_status = Draft; keeper = creator (rotate later via set_keeper)

initialize_vault_authority(custody_mode)
  // creator only; backwires deployment.vault_authority

initialize_strategy_state()
  // creator only; state_revision = 0

set_lifecycle_status(new_status)
  // creator only; FSM-enforced; mirrors onto strategy_state

commit_state(expected_revision, new_private_state_commitment, last_result_code)
  // signer = deployment.creator OR deployment.keeper
  // requires lifecycle_status == Deployed
  // replay protection: expected_revision == strategy_state.state_revision
  // new revision = expected_revision + 1

commit_state_and_commit(expected_revision, new_private_state_commitment, last_result_code)
  // same semantics as commit_state but inside an Ephemeral Rollups session.
  // Snapshots strategy_state back to base layer in the same tx via
  // MagicIntentBundleBuilder. The handler calls Account::exit() inside an
  // inner block before invoking the CPI so the post-mutation bytes are
  // observed (otherwise the commit would snapshot the pre-mutation
  // revision). The #[commit] macro injects magic_program + magic_context.

set_public_snapshot(expected_snapshot_revision, status_code, risk_band, pnl_summary_bps, public_metrics_hash)
  // creator only; init_if_needed (first call creates the PDA)
  // strictly monotonic: expected_snapshot_revision > current

close_deployment()
  // creator only; closes deployment + strategy_state and returns rent
  // requires lifecycle_status == Stopped
  // sibling PDAs are NOT closed here — see close_vault_authority / close_public_snapshot

close_vault_authority()
  // creator only; allowed when deployment is Stopped or Closed
  // implicitly sweeps any accrued lamports above rent-exempt to creator

close_public_snapshot()
  // creator only; allowed at any deployment lifecycle state
  // (snapshots are informational; they can be re-created later)

set_keeper(new_keeper)
  // creator only; pass Pubkey::default() to revert to creator-only mode
```

### Phase 2 — Follower vaults

```rust
initialize_follower_subscription(subscription_id)
  // follower self-signs (subscriptions are public discovery actions —
  // visibility presets and PER permission groups are the access plane)
  // requires deployment.lifecycle_status ∈ {Deployed, Paused}
  // (Paused is allowed so followers can pre-enrol and resume on reactivation)

initialize_follower_vault(vault_id, custody_mode)
  // follower only; requires subscription.follower == follower
  // backwires subscription.follower_vault
  // lifecycle starts at PendingFunding

initialize_follower_vault_authority()
  // follower only; backwires follower_vault.authority

set_follower_vault_status(new_status)
  // follower only; FSM-enforced; mirrors onto subscription

close_follower_vault()
  // follower only; closes follower_vault + authority + subscription
  // requires follower_vault.lifecycle_status == Closed
```

### MagicBlock ER

```rust
delegate_strategy_state(validator, commit_frequency_ms)
  // creator only; hands strategy_state to the ER delegation program
  // both args caller-supplied so the program does not need redeployment
  // when validators rotate or commit cadence is tuned per env
  // constraints:
  //   validator != Pubkey::default()
  //   commit_frequency_ms <= 6h (MAX_COMMIT_FREQUENCY_MS)
  //   commit_frequency_ms == 0  ⇒ SDK default

// process_undelegation  ← auto-injected by #[ephemeral]; no manual wrapper.
```

### Phase 4 — Closure & emergency controls

```rust
collect_fees()
  // creator only
  // allowed lifecycle: Deployed | Paused | Stopped (NOT Closed —
  // close_vault_authority wipes the account and returns everything)
  // requires custody_mode ∈ {1 program_owned, 2 private_payments_relay}
  // transfers (current_lamports - rent_exempt(VaultAuthority::SIZE))
  //   to creator via invoke_signed
  // errors with NoFeesToCollect if delta == 0

emergency_pause()    // creator only; Deployed -> Paused
emergency_resume()   // creator only; Paused -> Deployed
```

---

## Authority model

| Action | Required signer |
|---|---|
| Init strategy version / deployment / vault authority / strategy state | `creator` |
| Lifecycle transition, snapshot publish, fee collection, keeper rotate, emergency pause/resume, ER delegate | `deployment.creator` |
| `commit_state`, `commit_state_and_commit` | `deployment.creator` OR `deployment.keeper` |
| Follower subscription / vault / authority init, status change, close | `subscription.follower` |

The keeper carve-out is the only split-authority point. A keeper can
commit revisions but **cannot**: change lifecycle, withdraw fees,
rotate itself, delegate to ER, or do anything the follower side owns.

---

## Replay protection & monotonicity

| Account | Rule | Error |
|---|---|---|
| `strategy_state.state_revision` | `expected == current`, then `+1` | `StaleRevision` |
| `public_snapshot.snapshot_revision` | `expected > current` | `SnapshotNotMonotonic` |

`commit_state_and_commit` must call `Account::exit()` on `strategy_state`
inside a borrow-scoped block before the Magic Program CPI — otherwise
the CPI would snapshot the pre-mutation bytes. See the inner block in
`instructions/commit_state_on_er.rs::handler`.

---

## On-chain ↔ off-chain mapping

| On-chain PDA | Postgres table | Linker |
|---|---|---|
| `StrategyVersion` | `strategy_versions` | `strategy_id` UUID + `version` |
| `StrategyDeployment` | `strategy_deployments` | `deployment_id` UUID |
| `StrategySubscription` | `strategy_subscriptions` | `subscription_id` UUID |
| `FollowerVault` | `follower_vaults` | `vault_id` UUID |

Lifecycle enums are byte-for-byte equivalent across chain and DB — the
Rust `from_u8` mappings in `state/mod.rs` and
`state/follower_vault.rs` are the single source of truth.

PDA seed prefixes are `pub const` in `constants.rs` so the backend's
`pda.ts` helper re-derives without duplicating string literals.

---

## Errors (`StrategyRuntimeError`)

```
InvalidLifecycleTransition
StaleRevision
SnapshotNotMonotonic
DeploymentNotStopped
UnauthorizedCreator
InvalidExecutionMode
InvalidLifecycleCode
InvalidCustodyMode
NoFeesToCollect
FollowerVaultNotClosed
UnauthorizedFollower
SubscriptionDeploymentMismatch
InvalidDelegationBuffer
InvalidInstructionData
```

---

## Tests

Rust unit tests in `state/mod.rs` cover:

- Every valid + invalid transition for both FSMs (deployment + follower)
- `from_u8` round-trip for `LifecycleStatus`, `ExecutionMode`,
  `FollowerVaultLifecycleStatus`, `FollowerVaultCustodyMode`
- `is_authorized_keeper` (creator always allowed; default keeper not
  silently open)
- Size pins: `VaultAuthority::SIZE == 171`,
  `StrategyDeployment::SIZE == 203` — guards against silent drift
  in size-sensitive code (`collect_fees`, keeper carve-out)
- Emergency pause/resume valid + invalid sources

Integration: Mollusk SVM dev-dep (`programs/Cargo.toml`); workspace
`run-tests.sh` runs the ts-mocha suite against `tests/**/*.spec.ts`.

---

## Known gaps

1. **Custody-mode encoding asymmetry** — `VaultAuthority` and
   `FollowerVault` use different `custody_mode` byte mappings (see
   the table in Enums). IDL consumers must not conflate them.
2. **No transfer instructions yet** — both authorities only carry
   routing fields; SPL/SOL movement (deposits, fee skim from protocol
   vaults, exit flows) is still to be built. Phase 1 explicitly
   defers this.
3. **`allowed_mint_config_hash` empty** — both `VaultAuthority` and
   `FollowerVaultAuthority` carry the field but no instruction sets
   it today. Whitelist enforcement is currently off-chain.
4. **No follower-side keeper** — only the creator's deployment has a
   keeper carve-out. If automated follower exits without the
   follower's hot key are ever required, a parallel `follower_keeper`
   field would need to be added.
