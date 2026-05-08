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

Single Anchor program backing the strategy platform. Off-chain DB rows
(`strategy_versions`, `strategy_deployments`, `strategy_subscriptions`,
`follower_vaults`) each get a mirrored on-chain PDA so PDAs can be derived
from 16-byte UUIDs without touching Postgres.

Encrypted/private state never lives on-chain — only commitments,
authority and lifecycle metadata. Treasury balances live in Umbra; private
execution state lives in PER. The on-chain layer is the public control
shell + replay-protected revision counter.

---

## Accounts (PDAs)

All accounts carry a trailing `_reserved: [u8; 64]` (see
`constants::RESERVED_ACCOUNT_BYTES`) for forward-compatible field
additions without a migration. `StrategyDeployment` carves a 32-byte
keeper field out of that reserved tail (so its tail is 32 bytes).

### `StrategyVersion`

Immutable record of a published strategy revision.

```
seeds: [b"strategy_version", strategy_id (16B), version (4B LE)]
```

| Field | Type | Purpose |
|---|---|---|
| `creator` | Pubkey | Wallet that authored the strategy |
| `strategy_id` | [u8; 16] | UUID mirroring DB `strategies.id` |
| `version` | u32 | Monotonic version number |
| `public_metadata_hash` | [u8; 32] | Hash of sanitised public metadata |
| `private_definition_commitment` | [u8; 32] | Commitment over the full IR |
| `registered_slot` | u64 | Slot the version was registered |
| `bump` | u8 | PDA bump |
| `_reserved` | [u8; 64] | Forward compatibility |

### `StrategyDeployment`

Binds a deployment to a specific `StrategyVersion`. Drives the lifecycle
state machine.

```
seeds: [b"strategy_deployment", deployment_id (16B)]
```

| Field | Type | Purpose |
|---|---|---|
| `creator` | Pubkey | Sole authority for lifecycle/keeper changes |
| `strategy_version` | Pubkey | Pinned `StrategyVersion` PDA |
| `vault_authority` | Pubkey | Backwired after `initialize_vault_authority` |
| `deployment_id` | [u8; 16] | UUID mirroring DB `strategy_deployments.id` |
| `execution_mode` | u8 | 0=offchain, 1=er, 2=per |
| `lifecycle_status` | u8 | See `LifecycleStatus` |
| `deployment_nonce` | u64 | Off-chain assigned nonce |
| `initialized_slot` | u64 | Slot at init |
| `bump` | u8 | PDA bump |
| `keeper` | Pubkey | Optional commit signer; `Pubkey::default()` = creator-only |
| `_reserved` | [u8; 32] | Tail (kept smaller — keeper carved out) |

`is_authorized_keeper(signer)` returns true iff `signer == creator` or
(`keeper != Pubkey::default()` and `signer == keeper`). Used by
`commit_state` / `commit_state_and_commit` so an off-chain runner can
commit revisions without holding the creator's key.

### `StrategyState`

Replay-protected pointer to the latest private-state commitment. ER
session attaches to this account.

```
seeds: [b"strategy_state", deployment]
```

| Field | Type | Purpose |
|---|---|---|
| `deployment` | Pubkey | Parent deployment |
| `lifecycle_status` | u8 | Mirror of `deployment.lifecycle_status` |
| `state_revision` | u32 | Monotonic counter (replay protection) |
| `private_state_commitment` | [u8; 32] | Latest commitment |
| `last_result_code` | u32 | Free-form result code from off-chain run |
| `last_commit_slot` | u64 | Slot of last commit |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

### `VaultAuthority`

Program-controlled authority for treasury custody. Phase 1 only persists
routing fields; transfer instructions land later.

```
seeds: [b"vault_authority", deployment]
```

| Field | Type | Purpose |
|---|---|---|
| `deployment` | Pubkey | Parent deployment |
| `creator` | Pubkey | Mirrored from deployment |
| `custody_mode` | u8 | 0=public_self_custody, 1=program_owned, 2=private_payments_relay |
| `status` | u8 | 0=active, 1=frozen |
| `allowed_mint_config_hash` | [u8; 32] | Hash of allowed-mint config (zero until configured) |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

`SIZE = 171` (asserted in unit tests — `collect_fees` uses this exact
size to compute the rent-exempt floor).

### `PublicSnapshot`

Sanitised marketplace/leaderboard view. Strictly monotonic
`snapshot_revision`.

```
seeds: [b"public_snapshot", deployment]
```

| Field | Type | Purpose |
|---|---|---|
| `deployment` | Pubkey | Parent deployment |
| `snapshot_revision` | u32 | Strictly increasing |
| `published_slot` | u64 | Slot of latest publish |
| `status_code` | u8 | 0=running, 1=paused, 2=stopped, 3=closed |
| `risk_band` | u8 | 0=unknown, 1=low, 2=medium, 3=high |
| `pnl_summary_bps` | i32 | Signed PnL in bps |
| `public_metrics_hash` | [u8; 32] | Hash over the off-chain metrics blob |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

### `StrategySubscription`

One per `(deployment, follower)` pair. Public anchor for a follower's
enrolment. Sensitive subscription config (max capital, drawdown guard,
allocation mode) stays off-chain or in PER.

```
seeds: [b"strategy_subscription", deployment, follower]
```

| Field | Type | Purpose |
|---|---|---|
| `deployment` | Pubkey | Subscribed deployment |
| `follower` | Pubkey | Follower wallet |
| `follower_vault` | Pubkey | Backwired by `initialize_follower_vault` |
| `subscription_id` | [u8; 16] | UUID mirroring DB row |
| `lifecycle_status` | u8 | See `FollowerVaultLifecycleStatus` |
| `created_slot` | u64 | |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

### `FollowerVault`

Public control shell for a follower's funds. Treasury balances are in
Umbra; execution state in PER. Only authority + lifecycle live here.

```
seeds: [b"follower_vault", subscription]
```

| Field | Type | Purpose |
|---|---|---|
| `subscription` | Pubkey | Parent subscription |
| `deployment` | Pubkey | Mirrored for read-side joins |
| `follower` | Pubkey | Follower wallet |
| `authority` | Pubkey | Backwired by `initialize_follower_vault_authority` |
| `vault_id` | [u8; 16] | UUID mirroring DB `follower_vaults.id` |
| `lifecycle_status` | u8 | See `FollowerVaultLifecycleStatus` |
| `custody_mode` | u8 | 0=program_owned, 1=self_custody, 2=private_payments_relay |
| `created_slot` | u64 | |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

### `FollowerVaultAuthority`

Stable authority surface for delegate / session-key flows on a follower
vault.

```
seeds: [b"follower_vault_authority", follower_vault]
```

| Field | Type | Purpose |
|---|---|---|
| `follower_vault` | Pubkey | Parent vault |
| `follower` | Pubkey | Mirrored from vault |
| `status` | u8 | 0=active, 1=frozen |
| `allowed_mint_config_hash` | [u8; 32] | Hash of allowed-mint config |
| `bump` | u8 | |
| `_reserved` | [u8; 64] | |

---

## Enums (single byte on-chain)

### `LifecycleStatus` (deployment + strategy_state)

| Code | Variant | Allowed transitions |
|---|---|---|
| 0 | `Draft` | → Deployed |
| 1 | `Deployed` | → Paused, Stopped |
| 2 | `Paused` | → Deployed, Stopped |
| 3 | `Stopped` | → Closed |
| 4 | `Closed` | (terminal) |

State machine enforced by `LifecycleStatus::can_transition_to`. Any
illegal transition returns `InvalidLifecycleTransition`.

### `ExecutionMode`

| Code | Variant |
|---|---|
| 0 | `Offchain` |
| 1 | `Er` |
| 2 | `Per` |

### `FollowerVaultLifecycleStatus` (subscription + follower_vault)

| Code | Variant | Allowed transitions |
|---|---|---|
| 0 | `PendingFunding` | → Active, Closed |
| 1 | `Active` | → Paused, Exiting |
| 2 | `Paused` | → Active, Exiting |
| 3 | `Exiting` | → Closed |
| 4 | `Closed` | (terminal) |

### `FollowerVaultCustodyMode`

| Code | Variant |
|---|---|
| 0 | `ProgramOwned` |
| 1 | `SelfCustody` |
| 2 | `PrivatePaymentsRelay` |

> ⚠️ Note the asymmetry with `VaultAuthority.custody_mode`, where
> `0 = public_self_custody`, `1 = program_owned`, `2 = private_payments_relay`.
> Two different custody-mode encodings live in the program — one for the
> creator's vault authority, another for follower vaults. Off-chain code
> must not assume they map 1:1.

---

## Instructions

Twenty-one entrypoints exposed in `lib.rs` plus the SDK-injected
`process_undelegation` (auto-emitted by `#[ephemeral]`).

### Phase 1 — Creator / strategy lifecycle

```rust
initialize_strategy_version(
    strategy_id: [u8; 16],
    version: u32,
    public_metadata_hash: [u8; 32],
    private_definition_commitment: [u8; 32],
)
  // Creator self-signs; one StrategyVersion per (strategy_id, version).

initialize_deployment(
    deployment_id: [u8; 16],
    execution_mode: u8,
    deployment_nonce: u64,
)
  // Requires strategy_version.creator == creator.
  // lifecycle_status starts at Draft.
  // keeper is initialised to creator (rotate later via set_keeper).

initialize_vault_authority(custody_mode: u8)
  // Creator only. Backwires deployment.vault_authority.

initialize_strategy_state()
  // Creator only. state_revision starts at 0.

set_lifecycle_status(new_status: u8)
  // Creator only. State machine enforced.
  // Mirrors lifecycle_status onto strategy_state.

commit_state(
    expected_revision: u32,
    new_private_state_commitment: [u8; 32],
    last_result_code: u32,
)
  // Signer must be deployment.creator OR deployment.keeper.
  // Requires lifecycle_status == Deployed.
  // Replay protection: expected_revision == strategy_state.state_revision.
  // New revision becomes expected_revision + 1.

commit_state_and_commit(
    expected_revision: u32,
    new_private_state_commitment: [u8; 32],
    last_result_code: u32,
)
  // Same semantics as commit_state but runs INSIDE an Ephemeral Rollups
  // session and snapshots strategy_state back to base layer in the same
  // tx via MagicIntentBundleBuilder. Account.exit() is called inside an
  // inner block so the post-mutation bytes are observed by the CPI.
  // The #[commit] macro injects magic_program + magic_context.

set_public_snapshot(
    expected_snapshot_revision: u32,
    status_code: u8,
    risk_band: u8,
    pnl_summary_bps: i32,
    public_metrics_hash: [u8; 32],
)
  // Creator only. init_if_needed (first call creates the PDA).
  // Strictly monotonic: expected_snapshot_revision > current.

close_deployment()
  // Creator only. Closes deployment + strategy_state, returning rent.
  // Requires lifecycle_status == Stopped (NOT Closed — Closed is set by
  // close_deployment itself implicitly through Anchor's `close = creator`).
  //
  // NOTE: Sibling PDAs (vault_authority, public_snapshot) are NOT closed
  // here — call close_vault_authority / close_public_snapshot to reclaim
  // their rent.

close_vault_authority()
  // Creator only. Allowed once deployment is Stopped or Closed.
  // Implicitly sweeps any accrued lamports above rent-exempt to creator.

close_public_snapshot()
  // Creator only. Snapshots are informational so this can be called at
  // any deployment lifecycle state.

set_keeper(new_keeper: Pubkey)
  // Creator only. Pass Pubkey::default() to revert to creator-only mode.
```

### Phase 2 — Follower vaults

```rust
initialize_follower_subscription(subscription_id: [u8; 16])
  // Follower self-signs (subscriptions are public discovery actions —
  // visibility presets and PER permission groups are the access plane).
  // Requires deployment.lifecycle_status in {Deployed, Paused}.
  // (Paused is allowed so followers can pre-enrol and get notified on
  // resume.)

initialize_follower_vault(vault_id: [u8; 16], custody_mode: u8)
  // Follower only. Requires subscription.follower == follower.
  // Backwires subscription.follower_vault.
  // lifecycle starts at PendingFunding.

initialize_follower_vault_authority()
  // Follower only. Backwires follower_vault.authority.

set_follower_vault_status(new_status: u8)
  // Follower only. State machine enforced (see enum table above).
  // Mirrors lifecycle_status onto subscription.

close_follower_vault()
  // Follower only. Closes follower_vault + authority + subscription.
  // Requires follower_vault.lifecycle_status == Closed.
```

### MagicBlock ER

```rust
delegate_strategy_state(validator: Pubkey, commit_frequency_ms: u32)
  // Creator only. Hands strategy_state to the Ephemeral Rollups
  // delegation program for the supplied validator.
  // Both args are caller-supplied so the program does not need to be
  // redeployed when validators rotate or commit cadence is tuned per
  // env (dev/stage/prod).
  // Constraints:
  //   validator != Pubkey::default()
  //   commit_frequency_ms <= 6h (MAX_COMMIT_FREQUENCY_MS)
  //   commit_frequency_ms == 0 falls back to the SDK default

// process_undelegation — auto-injected by #[ephemeral] on the program
// module. There is no hand-rolled wrapper (a duplicate would risk an
// IDL discriminator collision, see instructions/mod.rs comment).
```

### Phase 4 — Application closure

```rust
collect_fees()
  // Creator only.
  // Allowed lifecycle: Deployed | Paused | Stopped.
  // Refused on Closed (use close_vault_authority instead — that wipes
  // the account and transfers everything).
  // custody_mode must be 1 (program_owned) or 2 (private_payments_relay).
  // Transfers (current_lamports - rent_exempt(VaultAuthority::SIZE)) to
  // creator via invoke_signed. Errors with NoFeesToCollect if delta is 0.

emergency_pause()
  // Creator only. Deployed -> Paused.

emergency_resume()
  // Creator only. Paused -> Deployed.
```

---

## Authorisation matrix

| Action | Required signer |
|---|---|
| Strategy version / deployment / vault authority / strategy state init | `creator` |
| Lifecycle transition, snapshot publish, fee collection, keeper rotate, emergency pause/resume | `deployment.creator` |
| Commit state (`commit_state`, `commit_state_and_commit`) | `deployment.creator` OR `deployment.keeper` |
| Delegate strategy_state to ER | `deployment.creator` |
| Initialise / mutate / close follower subscription, vault, authority | `subscription.follower` (= `follower_vault.follower`) |

The keeper carve-out is the only split-authority point: it lets a
non-creator key commit state without holding any other capability
(can't change lifecycle, can't withdraw fees, can't rotate itself).

---

## Replay protection & monotonicity

| Account | Protection | Error on violation |
|---|---|---|
| `strategy_state.state_revision` | `expected_revision == current` (then +1) | `StaleRevision` |
| `public_snapshot.snapshot_revision` | strictly greater than current | `SnapshotNotMonotonic` |

`commit_state_and_commit` calls `Account::exit()` on `strategy_state`
inside a borrow-scoped block before the Magic Program CPI, so the CPI
observes the post-mutation bytes (otherwise the commit would snapshot
the pre-mutation revision).

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

## On-chain ↔ off-chain mapping

| On-chain | Off-chain (Postgres) | Linker |
|---|---|---|
| `StrategyVersion` | `strategy_versions` row | `strategy_id` UUID + `version` |
| `StrategyDeployment` | `strategy_deployments` row | `deployment_id` UUID |
| `StrategySubscription` | `strategy_subscriptions` row | `subscription_id` UUID |
| `FollowerVault` | `follower_vaults` row | `vault_id` UUID |

Lifecycle enums are kept byte-for-byte equivalent on both sides — the
Rust `from_u8` mappings in `state/mod.rs` and `state/follower_vault.rs`
are the single source of truth.

PDA seed prefixes are exposed as `pub const` in `constants.rs` so the
backend's `pda.ts` helper can re-derive without duplicating string
literals.

---

## Tests

Rust unit tests in `state/mod.rs` cover:

- Every valid + invalid lifecycle transition (deployment + follower)
- `from_u8` round-trip for `LifecycleStatus`, `ExecutionMode`,
  `FollowerVaultLifecycleStatus`, `FollowerVaultCustodyMode`
- `is_authorized_keeper` (creator always allowed; default keeper not
  silently open)
- `VaultAuthority::SIZE == 171` and `StrategyDeployment::SIZE == 203`
  asserts so size-sensitive code (`collect_fees`, keeper carve-out)
  cannot drift silently
- Emergency pause/resume valid + invalid sources

Integration: Mollusk SVM dev-dep (`programs/Cargo.toml`); workspace
`run-tests.sh` script runs the ts-mocha suite against `tests/**/*.spec.ts`.

---

## Open questions / known gaps

1. **Custody-mode encoding asymmetry** — `VaultAuthority` and
   `FollowerVault` use different `custody_mode` byte mappings.
   Worth flagging in the IDL consumer code so the two enums never get
   conflated.
2. **No transfer instructions yet** — both vault authorities only carry
   routing fields; actual SPL/SOL movement (deposits, fee skim from
   protocol vaults, exit flows) is still to be built. Phase 1 explicitly
   defers this.
3. **`allowed_mint_config_hash` empty** — both `VaultAuthority` and
   `FollowerVaultAuthority` carry the field but no instruction sets it
   today. Whitelist enforcement is currently off-chain.
4. **No follower-side keeper** — only the creator's deployment has a
   keeper carve-out. If we later need automated follower exits without
   the follower's hot key, a parallel `follower_keeper` field would be
   needed.
