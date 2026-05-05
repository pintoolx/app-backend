---
date: 2026-05-02
type: internal Anchor program spec
project: pintool
related:
  - 2026-04-27-pintool-anchor-spec.md (original spec — superseded)
  - 2026-04-27-frontier-weekly-update.md (ship list)
  - 2026-04-27-pintool-substack-roadmap.md (v1-v5 content roadmap)
status: implemented (matches `programs/programs/strategy_runtime` HEAD)
program_id: FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF
anchor_version: 0.32.1
ephemeral_rollups_sdk: 0.12.0
deadline: Frontier 2026-05-11
---

# PinTool — Strategy Runtime Anchor Spec (as-built)

> **Note vs the 2026-04-27 spec.** The earlier doc described an Anchor program
> that was the *sole* fund custodian (workflow blob + vault PDA + execute_*
> instructions). The shipped runtime is fundamentally different: Anchor is a
> **state machine + delegation harness** for an off-chain runner; sensitive
> strategy logic and balances live in MagicBlock PER / Umbra. This spec
> reflects what is actually deployed.

## Design principles

1. **Anchor is the public state machine, not the custodian.** The program
   stores commitment hashes (`public_metadata_hash`, `private_definition_commitment`,
   `private_state_commitment`), lifecycle status, and authority pubkeys.
   Strategy IR and follower balances are NOT on-chain.
2. **Hash-commitment > encrypted blob.** Strategy bodies are sealed off-chain
   (Postgres + PER); on-chain we only store 32-byte commitments. This keeps
   transactions small, decouples encryption choice (Umbra / Arcium / TEE) from
   the program, and dodges a 4 KB blob update flow.
3. **Keeper is a first-class signer, not the creator's keypair.** Each
   `StrategyDeployment` has a `keeper: Pubkey` field. The platform off-chain
   runner signs with its own key; the creator never has to share private keys.
4. **MagicBlock ER is the high-frequency execution surface.** The
   `strategy_state` PDA is delegated to an ER validator; `commit_state_on_er`
   appends a revision inside the rollup and snapshots back to the base layer
   in a single tx via `MagicIntentBundleBuilder`.
5. **Follower vaults are public *control* shells, not balance ledgers.** The
   `FollowerVault` PDA only carries authority + lifecycle metadata. Real
   balances live in Umbra (encrypted) or in private-payments relay accounts.
6. **Forward compatibility via reserved bytes.** Every account has a
   `_reserved` tail so we can add fields without an account migration. The
   `keeper` field on `StrategyDeployment` was carved out of this tail.

---

## Accounts (PDAs)

### `StrategyVersion`

Immutable per-version record of a creator's strategy. Holds public/private
commitment hashes so any `StrategyDeployment` can prove it references a
canonical revision.

```
seeds: ["strategy_version", strategy_id: [u8; 16], version: u32 (le)]
```

| Field | Type | Purpose |
|---|---|---|
| `creator` | `Pubkey` | wallet that authored the version |
| `strategy_id` | `[u8; 16]` | UUID mirror of `strategies.id` (off-chain DB) |
| `version` | `u32` | monotonic version number |
| `public_metadata_hash` | `[u8; 32]` | hash over sanitised metadata |
| `private_definition_commitment` | `[u8; 32]` | commitment over private IR |
| `registered_slot` | `u64` | slot at publish |
| `bump` | `u8` | PDA bump |
| `_reserved` | `[u8; 64]` | growth space |

### `StrategyDeployment` ⭐

Live deployment of a `StrategyVersion`. Acts as the **routing hub** for state,
public snapshot, vault authority, and follower subscriptions.

```
seeds: ["strategy_deployment", deployment_id: [u8; 16]]
```

| Field | Type | Purpose |
|---|---|---|
| `creator` | `Pubkey` | governance authority (rotates lifecycle, set_keeper) |
| `strategy_version` | `Pubkey` | parent `StrategyVersion` |
| `vault_authority` | `Pubkey` | back-reference to `VaultAuthority` PDA |
| `deployment_id` | `[u8; 16]` | UUID mirror of `strategy_deployments.id` |
| `execution_mode` | `u8` | 0=offchain, 1=er, 2=per |
| `lifecycle_status` | `u8` | 0=Draft … 4=Closed (state machine) |
| `deployment_nonce` | `u64` | client-chosen disambiguator |
| `initialized_slot` | `u64` | slot at init |
| `bump` | `u8` | |
| **`keeper`** | **`Pubkey`** | **off-chain runner authorised to commit state. Defaults to `creator`. `Pubkey::default()` ⇒ creator-only.** |
| `_reserved` | `[u8; 32]` | growth space (was 64; 32 bytes carved for `keeper`) |

Total size: 203 bytes (unchanged across the keeper carve-out).

### `StrategyState`

Private-state pointer with replay-protected, monotonically increasing
revision. Mutated by `commit_state` (offchain mode) or `commit_state_on_er`
(ER mode).

```
seeds: ["strategy_state", deployment: Pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `deployment` | `Pubkey` | parent deployment |
| `lifecycle_status` | `u8` | mirror of `deployment.lifecycle_status` |
| `state_revision` | `u32` | replay protection counter |
| `private_state_commitment` | `[u8; 32]` | latest commitment |
| `last_result_code` | `u32` | last keeper-reported status |
| `last_commit_slot` | `u64` | |
| `bump` | `u8` | |
| `_reserved` | `[u8; 64]` | |

### `VaultAuthority`

PDA that owns deployment-scoped custodial assets when `custody_mode != 0`
(self_custody). Phase-1 only persists routing metadata; collected fees flow
through this account's lamport balance.

```
seeds: ["vault_authority", deployment: Pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `deployment` | `Pubkey` | parent |
| `creator` | `Pubkey` | mirror of deployment.creator (for fast lookup) |
| `custody_mode` | `u8` | 0=public_self_custody, 1=program_owned, 2=private_payments_relay |
| `status` | `u8` | 0=active, 1=frozen |
| `allowed_mint_config_hash` | `[u8; 32]` | hash over allow-list |
| `bump` | `u8` | |
| `_reserved` | `[u8; 64]` | |

Size: 171 bytes.

### `PublicSnapshot`

Sanitised view for marketplace / leaderboard. Optional — only created when
the creator first calls `set_public_snapshot`.

```
seeds: ["public_snapshot", deployment: Pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `deployment` | `Pubkey` | parent |
| `snapshot_revision` | `u32` | strictly monotonic |
| `published_slot` | `u64` | |
| `status_code` | `u8` | mirrors a subset of LifecycleStatus |
| `risk_band` | `u8` | 0=unknown, 1=low, 2=medium, 3=high |
| `pnl_summary_bps` | `i32` | signed |
| `public_metrics_hash` | `[u8; 32]` | hash over off-chain metrics blob |
| `bump` | `u8` | |
| `_reserved` | `[u8; 64]` | |

### `StrategySubscription`

Public anchor for a follower's enrolment in a deployment. Carries authority
+ lifecycle facts only — sensitive sub config (max capital, drawdown guard)
stays off-chain.

```
seeds: ["strategy_subscription", deployment: Pubkey, follower: Pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `deployment` | `Pubkey` | parent |
| `follower` | `Pubkey` | self-signing follower wallet |
| `follower_vault` | `Pubkey` | back-reference, set by `initialize_follower_vault` |
| `subscription_id` | `[u8; 16]` | UUID mirror |
| `lifecycle_status` | `u8` | 0=PendingFunding … 4=Closed |
| `created_slot` | `u64` | |
| `bump` | `u8` | |
| `_reserved` | `[u8; 64]` | |

### `FollowerVault`

Per-subscription public control shell. Treasury balances live elsewhere
(Umbra / private payments relay).

```
seeds: ["follower_vault", subscription: Pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `subscription` | `Pubkey` | parent |
| `deployment` | `Pubkey` | denormalised |
| `follower` | `Pubkey` | owner |
| `authority` | `Pubkey` | back-reference to `FollowerVaultAuthority` |
| `vault_id` | `[u8; 16]` | UUID mirror |
| `lifecycle_status` | `u8` | mirrors `StrategySubscription.lifecycle_status` |
| `custody_mode` | `u8` | 0=program_owned, 1=self_custody, 2=private_payments_relay |
| `created_slot` | `u64` | |
| `bump` | `u8` | |
| `_reserved` | `[u8; 64]` | |

### `FollowerVaultAuthority`

Stable execution surface for scoped session-key / delegate flows on the
follower side. Symmetric to `VaultAuthority` but per-follower.

```
seeds: ["follower_vault_authority", follower_vault: Pubkey]
```

| Field | Type | Purpose |
|---|---|---|
| `follower_vault` | `Pubkey` | parent |
| `follower` | `Pubkey` | owner |
| `status` | `u8` | 0=active, 1=frozen |
| `allowed_mint_config_hash` | `[u8; 32]` | |
| `bump` | `u8` | |
| `_reserved` | `[u8; 64]` | |

---

## Lifecycle state machines

### Deployment

```
  Draft ──▶ Deployed ──▶ Paused ──▶ Deployed
                  │            │
                  ▼            ▼
                Stopped ────────
                  │
                  ▼
                Closed
```

`Draft → Deployed` happens via `set_lifecycle_status`. Emergency tools:
`emergency_pause` (Deployed → Paused) and `emergency_resume` (Paused →
Deployed) are the only paths a creator should hit at runtime.

### Follower vault / subscription (mirrored)

```
  PendingFunding ─▶ Active ─▶ Paused ─▶ Active
        │              │          │
        │              ▼          ▼
        │           Exiting ────────
        │              │
        ▼              ▼
       Closed       Closed
```

`set_follower_vault_status` writes both the vault and the subscription's
`lifecycle_status` atomically, so off-chain readers can use either as the
source of truth.

---

## Instructions

### Creator-facing (governance)

```rust
initialize_strategy_version(
    strategy_id: [u8; 16],
    version: u32,
    public_metadata_hash: [u8; 32],
    private_definition_commitment: [u8; 32],
)
  → StrategyVersion

initialize_deployment(
    deployment_id: [u8; 16],
    execution_mode: u8,
    deployment_nonce: u64,
)
  → StrategyDeployment
  // keeper defaults to creator

initialize_vault_authority(custody_mode: u8)
  → VaultAuthority

initialize_strategy_state()
  → StrategyState  // revision = 0

set_lifecycle_status(new_status: u8)
  // Draft→Deployed, Deployed→{Paused,Stopped}, Paused→{Deployed,Stopped}, Stopped→Closed

emergency_pause()       // Deployed → Paused
emergency_resume()      // Paused → Deployed

set_keeper(new_keeper: Pubkey)
  // Pubkey::default() reverts to creator-only

set_public_snapshot(
    expected_snapshot_revision: u32,   // strictly > current
    status_code: u8,
    risk_band: u8,
    pnl_summary_bps: i32,
    public_metrics_hash: [u8; 32],
)
  // init_if_needed; rejects non-monotonic revisions

collect_fees()
  // Sweep VaultAuthority lamports above rent-exempt to creator.
  // Rejected if lifecycle ∈ {Draft, Closed} or custody_mode ∉ {1,2}.

close_deployment()              // closes deployment + strategy_state (lifecycle must be Stopped)
close_vault_authority()         // closes vault_authority    (lifecycle must be Stopped|Closed)
close_public_snapshot()         // closes public_snapshot    (any lifecycle)
```

> **`expected_revision` semantics.** All revision-mutating instructions take
> `expected_revision: u32` = the **current** on-chain revision the caller
> observed. The handler asserts equality (replay protection) and writes
> `current + 1`. The name is preserved across the IDL even though
> `current_revision` would read more naturally — renaming is a breaking
> change for every backend client.

### Keeper / commit instructions (creator OR keeper signs)

```rust
commit_state(
    expected_revision: u32,
    new_private_state_commitment: [u8; 32],
    last_result_code: u32,
)
  // base-layer-only commit. Lifecycle must be Deployed|Paused|Stopped.

commit_state_and_commit(  // a.k.a. commit_state_on_er
    expected_revision: u32,
    new_private_state_commitment: [u8; 32],
    last_result_code: u32,
)
  // Inside an ER session: bump revision + Account::exit() + MagicIntentBundleBuilder
  // CPI to snapshot back to the base layer in the same tx.

delegate_strategy_state(
    validator: Pubkey,           // ER validator pubkey (caller-supplied)
    commit_frequency_ms: u32,    // 0 = SDK default; capped at 6h
)
  // #[delegate] macro CPI to delegation program; only the creator may delegate.

// Undelegation is auto-injected by #[ephemeral] on the program module —
// `process_undelegation` + `InitializeAfterUndelegation` are generated by
// the macro. No hand-rolled wrapper is shipped.
```

### Follower-facing

```rust
initialize_follower_subscription(subscription_id: [u8; 16])
  → StrategySubscription
  // Rejected if deployment.lifecycle_status ∉ {Deployed, Paused}.

initialize_follower_vault(vault_id: [u8; 16], custody_mode: u8)
  → FollowerVault
  // Backwires subscription.follower_vault.

initialize_follower_vault_authority()
  → FollowerVaultAuthority
  // Backwires follower_vault.authority.

set_follower_vault_status(new_status: u8)
  // PendingFunding→{Active,Closed}, Active→{Paused,Exiting},
  // Paused→{Active,Exiting}, Exiting→Closed.
  // Writes both follower_vault and subscription atomically.

close_follower_vault()
  // Closes follower_vault + authority + subscription in one tx.
  // Vault lifecycle must be Closed.
```

### Note on absent instructions vs the 2026-04-27 spec

The original spec listed `execute_swap` / `execute_deposit` /
`execute_withdraw` / `execute_condition` / `execute_split` and a
`NodeRegistry` admin surface. **None are implemented and none are planned
for this Anchor program.** Execution lives off-chain in:

- `backend/src/magicblock/magicblock-er-real.adapter.ts` (sub-second loops in ER)
- `backend/src/magicblock/magicblock-per-real.adapter.ts` (logic in TEE)
- `backend/src/magicblock/magicblock-private-payments-real.adapter.ts` (encrypted balances)

The on-chain trust boundary is therefore: *Anchor enforces lifecycle +
keeper authority + revision monotonicity*; *MagicBlock ER/PER + Umbra
enforces value-flow correctness.*

---

## Trust mode mapping (for follower clients)

| Mode | Vault `custody_mode` | Who holds keys | Notes |
|---|---|---|---|
| 1. Self-custody | `1` (`self_custody`) | follower | `FollowerVaultAuthority.status` may freeze |
| 2. Program-owned | `0` (`program_owned`) | program PDA | follower signs deposit/withdraw via off-chain wrappers |
| 3. Private-payments relay | `2` (`private_payments_relay`) | Umbra relay | balances encrypted; on-chain account is just a routing handle |

In all three modes, *Anchor* only signs PDA-derived authority for state
mutations. Real value transfers happen off-chain (Umbra deposits, ER session
intents).

---

## Encryption substrate

The original spec proposed an `encrypted_blob` + `substrate: u8` enum on
`WorkflowPolicy`. The shipped design **does not store an encrypted blob
on-chain at all** — it stores a 32-byte commitment (`private_definition_commitment`)
and the actual ciphertext lives in PER / Umbra. This means:

- Substrate selection is a backend concern; the program is oblivious.
- Rotating encryption schemes does not require an on-chain migration.
- A subscriber's "decryption grant" is not an on-chain field; it's issued
  off-chain by the PER permission group that reflects an active
  `StrategySubscription`.

---

## Compute unit budget (measured on devnet)

| Instruction | Approx. CU | Notes |
|---|---|---|
| `initialize_deployment` | ~30k | one PDA init |
| `initialize_strategy_state` | ~25k | one PDA init |
| `initialize_vault_authority` | ~25k | one PDA init |
| `initialize_follower_subscription` | ~30k | + lifecycle gate |
| `initialize_follower_vault` | ~30k | + backwire |
| `commit_state` | ~15k | pure account write |
| `commit_state_and_commit` | ~80k | + Magic Program CPI |
| `delegate_strategy_state` | ~120k | delegation program CPI |
| `collect_fees` | ~15k | system_program transfer |
| `close_*` | ~20k each | rent reclamation |

All numbers exclude priority fee. Multi-PDA flows (init_deployment +
init_state + init_vault_authority) typically batch into one tx ~80k CU.

---

## Security properties (as enforced)

1. **Only the creator (or its keeper) can mutate state.** All
   `commit_state*` and lifecycle ix gate on
   `StrategyDeployment::is_authorized_keeper`.
2. **Revisions are monotonically increasing.** `expected_revision == current`
   then `current+1` writeback. `state_revision: u32::MAX` cannot wrap
   (`checked_add`).
3. **Lifecycle transitions are state-machine enforced** at the Rust level
   (`LifecycleStatus::can_transition_to`).
4. **Followers cannot subscribe to dead deployments.**
   `initialize_follower_subscription` rejects unless lifecycle ∈
   {Deployed, Paused}.
5. **Snapshot revisions are strictly monotonic** — `set_public_snapshot`
   rejects equal-or-lower revisions.
6. **Closure is gated.** `close_deployment` requires `Stopped`;
   `close_vault_authority` requires `Stopped|Closed`; `close_follower_vault`
   requires the vault's `Closed` status.
7. **No fee can leak from a dead deployment.** `collect_fees` rejects
   `Draft` and `Closed` lifecycles; `Closed` deployments must use
   `close_vault_authority` (which transfers the entire balance and removes
   the account).
8. **Keeper rotation is creator-gated.** `set_keeper` requires `creator ==
   signer`. `Pubkey::default()` reverts to creator-only.

### What Anchor does NOT enforce (intentionally)

- Per-call lamport caps (`max_per_call_lamports` from the old spec).
- Whitelisted protocol CPI (Jupiter / Kamino / Orca). Those are enforced
  at the off-chain runner (PER permission groups + execution adapter
  guards).
- Subscription expiry / proration. Subscriptions live until explicit
  lifecycle transition.
- Subscriber refunds on cancellation. Done off-chain by the
  private-payments relay.

---

## Failure modes

| Situation | Result |
|---|---|
| Wrong `expected_revision` | `StaleRevision` |
| Snapshot revision not strictly greater | `SnapshotNotMonotonic` |
| Non-creator/non-keeper signs commit | `UnauthorizedCreator` |
| Follower mismatch on follower-side ix | `UnauthorizedFollower` |
| Subscription bound to a different deployment | `SubscriptionDeploymentMismatch` |
| Lifecycle transition not in state-machine table | `InvalidLifecycleTransition` |
| Unknown enum byte (custody_mode / lifecycle / mode) | `Invalid*Code` |
| `delegate_strategy_state(validator=0, …)` | `InvalidInstructionData` |
| `delegate_strategy_state(commit_frequency_ms > 6h)` | `InvalidInstructionData` |
| `collect_fees` with no surplus | `NoFeesToCollect` |
| Closure of non-stopped deployment | `DeploymentNotStopped` |
| `close_follower_vault` while not closed | `FollowerVaultNotClosed` |
| Undelegate buffer not owned by delegation program | `InvalidDelegationBuffer` |

---

## v1 → v5 evolution

| Version | On-chain change |
|---|---|
| **v1 (this doc)** | StrategyVersion / Deployment / State / Subscription / FollowerVault — current ship list. |
| v2 vault recommendations | new `RecommendationDeployment` variant of `StrategyDeployment.execution_mode`, no new account schema |
| v3 signal feeds | new `SignalRecord` PDA + `emit_signal` ix; reuses `StrategyVersion` for authoring |
| v4 alpha threads | `ThreadVersion` + Arweave/SHDW `content_uri` field; no execute path |
| v5 bundles | `BundleDeployment` + revenue-split router ix that CPIs to multiple `StrategyDeployment`s |

The `_reserved` tail on each account leaves room to add fields (e.g. a
`platform_fee_bps`) without an account migration.

---

## Open questions

1. **Should `keeper` be allowed to call lifecycle transitions** (currently
   only creator can `pause` / `resume` / `stop`)? Trade-off: easier ops vs.
   keeper compromise blast radius.
2. **Per-deployment fee split.** Currently all `collect_fees` lamports go to
   `creator`. Adding a platform fee will need a new field carved from
   `_reserved`.
3. **`set_public_snapshot` write rate.** No CU budget concern, but if
   keepers update it every minute the on-chain log noise is non-trivial.
   Consider hash-only updates (skip if `public_metrics_hash` unchanged).
4. **ER validator allow-list.** `delegate_strategy_state(validator)` is now
   caller-supplied. Should an admin-managed `ValidatorRegistry` PDA gate
   which validator pubkeys are accepted? Currently any creator can delegate
   to any validator.
5. **Multi-token follower vault.** Off-chain holds the balances, so this is
   moot at the program level — but UX needs a clear ATA-derivation contract.

---

## Architecture diagram (text)

```diagram
╭───────────────╮         ╭───────────────╮
│   Creator     │         │   Follower    │
╰───────┬───────╯         ╰───────┬───────╯
        │                         │
        │ publish / lifecycle     │ subscribe / set_status
        ▼                         ▼
╭───────────────────────────────────────────╮
│           strategy_runtime  (Anchor)       │
│  StrategyVersion ─▶ Deployment ─▶ State    │
│         │              │            │      │
│         │              ▼            │      │
│         │         VaultAuthority    │      │
│         │              │            │      │
│         ▼              ▼            ▼      │
│     PublicSnapshot   collect_fees  commit_*│
│                                            │
│  Subscription ─▶ FollowerVault ─▶ Authority│
╰───────┬───────────────────────────┬────────╯
        │                           │
        │ delegate (commit_freq,    │ commit results
        │           validator)      │
        ▼                           ▲
╭──────────────────────╮   ╭────────────────────╮
│   MagicBlock ER      │   │  MagicBlock PER    │
│  · sub-second loops  │   │  · TEE strategy IR │
│  · MagicIntentBundle │   │  · permission grps │
╰──────────────────────╯   ╰────────────────────╯
        │                           │
        ▼                           ▼
╭──────────────────────────────────────────────╮
│  Whitelisted DeFi (Pyth · Orca · Kamino …)  │
│  (CPI'd by ER session, NOT by Anchor)        │
╰──────────────────────────────────────────────╯
        ▲
        │  encrypted balances + private payments
        │
╭──────────────────────╮
│        Umbra         │
╰──────────────────────╯
```

Key arrow semantics:
1. `Creator → Anchor`: publish version / init deployment / set lifecycle / set_keeper
2. `Follower → Anchor`: initialize_follower_subscription / set_follower_vault_status / close_follower_vault
3. `Anchor → ER`: `delegate_strategy_state(validator, commit_frequency_ms)`
4. `ER → Anchor`: `commit_state_and_commit` writes the new revision back to base layer
5. `Anchor → DeFi`: nothing direct. CPI lives in the ER session.

---

## Appendix: change log vs 2026-04-27 spec

| Area | 2026-04-27 spec | 2026-05-02 (this doc) |
|---|---|---|
| Custody | "Anchor is the only fund manager" | Off-chain (Umbra/PER); Anchor holds commitments |
| `WorkflowPolicy` 4 KB blob | yes | replaced by 32-byte `private_definition_commitment` |
| `Subscription.executor` + `decryption_grant` | yes | absent — handled by PER permission groups |
| Subscription expiry / proration | yes | absent |
| `execute_swap` / `execute_*` | yes | not implemented (off-chain) |
| `NodeRegistry` admin layer | yes | not implemented (off-chain runner whitelist) |
| `CreatorProfile` aggregate | yes | absent — backend DB only |
| Keeper signer | implicit (executor) | explicit `keeper` field + `set_keeper` ix |
| ER validator | n/a | `delegate_strategy_state(validator, commit_frequency_ms)` |
| Closure | one ix | `close_deployment` + `close_vault_authority` + `close_public_snapshot` |
| `collect_fees` | n/a | gated to lifecycle ∈ {Deployed, Paused, Stopped} |
| `initialize_follower_subscription` | n/a | gated to lifecycle ∈ {Deployed, Paused} |
| `commit_state_on_er` borrow handling | n/a | scoped block + `Account::exit()` before CPI |
| Manual undelegate wrapper | n/a | deleted; macro auto-injects `process_undelegation` |
