# Next Phase Task Breakdown

This document breaks the next-phase privacy plan into ready-to-start task lists.

Use it together with:

- [NEXT_PHASE_IMPLEMENTATION_PLAN.md](./NEXT_PHASE_IMPLEMENTATION_PLAN.md)
- [FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md](./FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md)

Each phase is split into small tasks that can be assigned directly to an engineer.

## Phase 1

Goal: ship follower-scoped PER auth and follower-self private-state reads.

### Core Tasks

- [ ] `P1-01` Add subscription-scoped PER token fields to the schema so a token can be tied to a specific subscription instead of only a deployment. Touch points: `backend/src/database/schema/initial-5-per.sql`, Supabase migration mirror, `per_auth_tokens` admin views.
- [ ] `P1-02` Extend the PER token repository model to read and write the new scope fields. Touch points: `backend/src/magicblock/per-auth-tokens.repository.ts`, related unit tests.
- [ ] `P1-03` Update `PerAuthGuard` so downstream handlers can distinguish deployment-wide tokens from subscription-scoped tokens. Touch points: `backend/src/magicblock/per-auth.guard.ts`, guard tests.
- [ ] `P1-04` Add follower subscription PER challenge endpoint. Touch points: `backend/src/follower-vaults/subscriptions.controller.ts`, `backend/src/follower-vaults/subscriptions.service.ts`.
- [ ] `P1-05` Add follower subscription PER verify endpoint that stores an active token scoped to the subscription. Touch points: `backend/src/follower-vaults/subscriptions.controller.ts`, `backend/src/follower-vaults/subscriptions.service.ts`, `backend/src/magicblock/magicblock-per-real.adapter.ts` if payload shape needs extension.
- [ ] `P1-06` Add `GET /deployments/:id/subscriptions/:subscriptionId/private-state` and ensure it uses subscription ownership plus token scope, not deployment-wide access. Touch points: `backend/src/follower-vaults/subscriptions.controller.ts`, `backend/src/follower-vaults/subscriptions.service.ts`.
- [ ] `P1-07` Introduce a service method that proxies follower private-state reads into PER without returning deployment-wide blobs. Touch points: `backend/src/follower-vaults/subscriptions.service.ts`, `backend/src/magicblock/magicblock.port.ts`, `backend/src/magicblock/magicblock-per-real.adapter.ts` if a dedicated endpoint is needed.
- [ ] `P1-08` Define and enforce the allowed follower-self scopes, for example `per:subscription-private-state` and `per:subscription-auth-challenge`, instead of reusing the generic deployment-level scope set. Touch points: PER adapter, token repository, guard.

### Validation Tasks

- [ ] `P1-09` Add regression tests proving a follower can read their own private state and cannot read a sibling subscription's state. Touch points: `backend/src/follower-vaults/*.spec.ts`, `backend/src/magicblock/*.spec.ts`.
- [ ] `P1-10` Add a negative test proving a deployment-level PER token cannot be replayed against the follower-self endpoint and vice versa.
- [ ] `P1-11` Add API documentation examples for the new follower PER auth flow. Touch points: controller decorators and docs.

### Done Checklist

- [ ] follower can challenge, verify, and read `private-state`
- [ ] token scope is tied to `subscriptionId`
- [ ] follower cannot enumerate sibling state

## Phase 2

Goal: replace placeholder follower vault PDAs with real on-chain accounts.

### Core Tasks

- [ ] `P2-01` Extend the on-chain adapter port with follower subscription, follower vault, and follower vault authority initialization methods. Touch points: `backend/src/onchain/onchain-adapter.port.ts`, no-op implementation, real implementation.
- [ ] `P2-02` Implement `initializeFollowerSubscription` in the real on-chain adapter using the existing Anchor instruction. Touch points: real on-chain adapter files and program client wiring.
- [ ] `P2-03` Implement `initializeFollowerVault` in the real on-chain adapter. Touch points: real on-chain adapter, Anchor instruction client.
- [ ] `P2-04` Implement `initializeFollowerVaultAuthority` in the real on-chain adapter. Touch points: real on-chain adapter, Anchor instruction client.
- [ ] `P2-05` Replace `placeholderPda()` usage in `backend/src/follower-vaults/subscriptions.service.ts` with actual adapter calls and persisted PDA results.
- [ ] `P2-06` Decide the transaction boundary for subscription provisioning: either a single orchestrated backend flow or a stepwise persisted state machine if chain writes can partially succeed. Record the decision in code comments or docs.
- [ ] `P2-07` Add a backfill strategy for existing rows that still contain placeholder PDAs so operators can distinguish legacy scaffolds from real accounts. Touch points: migration or admin reporting.
- [ ] `P2-08` Extend lifecycle transitions so `pause`, `resume`, `unsubscribe`, and `redeem` also call on-chain follower vault lifecycle instructions instead of updating only database rows. Touch points: `backend/src/follower-vaults/subscriptions.service.ts`, on-chain adapter.
- [ ] `P2-09` Upgrade `fund-intent` from a hint-only payload to a real funding instruction builder response. Touch points: `backend/src/follower-vaults/subscriptions.service.ts`, DTOs, any signing helper.
- [ ] `P2-10` Ensure admin and follower responses surface a machine-readable flag indicating whether the vault references are real or transitional. Touch points: admin privacy services, follower subscription view.

### Validation Tasks

- [ ] `P2-11` Add tests covering successful subscription provisioning with real PDA results persisted to both `strategy_subscriptions` and `follower_vaults`.
- [ ] `P2-12` Add tests covering rollback or retry behavior when one on-chain initialization step fails after earlier steps succeeded.
- [ ] `P2-13` Add a smoke-test checklist for local devnet or test validator that confirms the three expected accounts are created.

### Done Checklist

- [ ] no new rows use placeholder PDAs
- [ ] lifecycle state is consistent on-chain and off-chain
- [ ] `fund-intent` returns actionable funding data

## Phase 3

Goal: make visibility grants enforce real access rules in PER and Umbra.

### Core Tasks

- [ ] `P3-01` Define a single scope matrix mapping each `VisibilityGrantScope` to exactly which APIs and data fields it unlocks. Touch points: `backend/src/follower-vaults/follower-visibility-grants.repository.ts`, docs.
- [ ] `P3-02` Decide where grant enforcement lives for follower private-state reads: controller guard, service-level policy, or dedicated policy service. Record the choice before implementation.
- [ ] `P3-03` Introduce a reusable visibility policy evaluator that can answer `canReadPrivateState` and `canReadPrivateBalance`. Touch points: new policy service under `backend/src/follower-vaults` or `backend/src/common`.
- [ ] `P3-04` Update follower private-state reads to honor active grants and deny access when scope does not allow the requested surface.
- [ ] `P3-05` Update follower private-balance reads to honor active grants instead of ownership only. Touch points: `backend/src/follower-vaults/subscriptions.service.ts`.
- [ ] `P3-06` Implement real Umbra viewer grant support in `backend/src/umbra/umbra-real.adapter.ts` and replace the current noop behavior.
- [ ] `P3-07` Decide how PER-side grant propagation works: by group membership, by token claims, or by server-side proxy filtering. Implement one approach consistently.
- [ ] `P3-08` Extend `createGrant()` so it writes both the DB ledger row and the runtime authorization state needed for the granted surface.
- [ ] `P3-09` Extend `revokeGrant()` so it revokes both the DB ledger row and future runtime access.
- [ ] `P3-10` Add expiry handling rules so expired grants are denied consistently even before any background janitor updates row state.

### Validation Tasks

- [ ] `P3-11` Add tests showing a `vault-balance` grant cannot read `vault-state`.
- [ ] `P3-12` Add tests showing a revoked grant immediately fails on the next read attempt.
- [ ] `P3-13` Add tests showing owner self-access still works without an explicit extra grant row.
- [ ] `P3-14` Add admin tests showing grant status remains observable even when runtime propagation fails and a retry path is needed.

### Done Checklist

- [ ] grants affect real query outcomes
- [ ] revoke stops future access
- [ ] grant scope behavior is documented and test-covered

## Phase 4

Goal: evolve private cycles from sanitized allocation scaffolding into a private execution orchestration layer.

### Core Tasks

- [ ] `P4-01` Define the internal payload that represents a private strategy output for one cycle, separate from the public API DTO. Touch points: new types near `backend/src/follower-vaults/private-execution-cycles.service.ts`.
- [ ] `P4-02` Replace `notional` as the primary source of truth with a planner input that can be derived from private strategy output while still preserving idempotency.
- [ ] `P4-03` Implement real `fixed` allocation mode in `FollowerVaultAllocationsService`.
- [ ] `P4-04` Implement real `mirror` allocation mode in `FollowerVaultAllocationsService`.
- [ ] `P4-05` Add explicit skip-reason support for followers that are paused, exiting, out of policy, or over drawdown. Touch points: receipts schema if needed, cycle service, admin views.
- [ ] `P4-06` Introduce a planner step that transforms cycle strategy output into per-follower vault operation plans. Touch points: new planner service under `backend/src/follower-vaults`.
- [ ] `P4-07` Extend receipts so they can store sanitized operation metadata and skip reasons without leaking strategy internals. Touch points: `backend/src/follower-vaults/follower-execution-receipts.repository.ts`, schema if needed.
- [ ] `P4-08` Decide what marks a receipt as `planned`, `applied`, `skipped`, or `failed` in the new planner model and document the transition rules in code.
- [ ] `P4-09` Upgrade retry behavior so a retry can reuse the original private plan or explicitly regenerate a new one, rather than only cloning trigger metadata.
- [ ] `P4-10` Ensure admin cycle detail pages can display richer receipt metadata without exposing sensitive strategy content. Touch points: admin privacy service, `frontend-admin/app/(admin)/privacy/cycles/[cycleId]`.

### Validation Tasks

- [ ] `P4-11` Add unit tests for all allocation modes.
- [ ] `P4-12` Add service tests for skipped followers and partial fan-out failures.
- [ ] `P4-13` Add a regression test for retry behavior so retries do not create ambiguous receipt histories.

### Done Checklist

- [ ] all allocation modes produce real outputs
- [ ] receipts record meaningful sanitized execution results
- [ ] cycle planner emits follower vault operation plans

## Phase 5

Goal: complete the private treasury plane for transfers, exit, and settlement.

### Core Tasks

- [ ] `P5-01` Confirm the exact Umbra SDK or prover path needed to support transfer and document the minimum viable transfer feature before coding.
- [ ] `P5-02` Implement `transfer()` in `backend/src/umbra/umbra-real.adapter.ts` and define expected result fields for queue and callback signatures.
- [ ] `P5-03` Decide the treasury movement model for creator treasury, follower treasury, fee accrual, and settlement. Capture it in a short design note before wiring APIs.
- [ ] `P5-04` Extend unsubscribe flow so it creates a real settlement intent instead of only switching lifecycle state to `exiting`.
- [ ] `P5-05` Extend redeem flow so it performs real unshield or withdrawal behavior according to the chosen policy.
- [ ] `P5-06` Decide whether deployment-level Umbra identity isolation will remain shared or move toward per-deployment derived identities. Record the decision explicitly.
- [ ] `P5-07` Surface treasury settlement state in follower subscription views so users can tell whether funds are still shielded, exiting, or redeemed.
- [ ] `P5-08` Surface isolation mode in admin views so operators can distinguish follower-vault isolation from deployment-level shared identity mode.

### Validation Tasks

- [ ] `P5-09` Add tests for transfer success and failure paths.
- [ ] `P5-10` Add tests for unsubscribe plus redeem settlement state transitions.
- [ ] `P5-11` Add operator verification notes for checking that shielded, transferred, and redeemed states match expected balances.

### Done Checklist

- [ ] transfer is implemented
- [ ] exit and redeem have real treasury behavior
- [ ] isolation mode is visible to operators

## Phase 6

Goal: align admin surfaces and docs with the actual privacy posture.

### Core Tasks

- [ ] `P6-01` Update `docs/privacy/ADMIN_NATIVE_PRIVACY_BACKLOG.md` so each item is labeled as `shipped`, `partial`, or `missing` instead of leaving already-shipped APIs in backlog-only language.
- [ ] `P6-02` Add `identityIsolationMode` to the deployment privacy response model. Touch points: `backend/src/admin/privacy/admin-privacy.service.ts`, controller response typing, frontend hooks.
- [ ] `P6-03` Add `runtimeAuthorityMode` to the deployment privacy response model.
- [ ] `P6-04` Add admin warnings for placeholder PDAs, shared identity mode, unenforced grants, or degraded PER/Umbra behavior. Touch points: backend response model, `frontend-admin/app/(admin)/privacy/privacy-client.tsx`, drill-down views.
- [ ] `P6-05` Update the admin privacy page to display phase status per module instead of only `current` and `target` separation.
- [ ] `P6-06` Add a compact end-to-end operator verification checklist covering subscribe, fund, shield, PER auth, private-state read, grant, revoke, cycle, unsubscribe, and redeem.
- [ ] `P6-07` Reconcile `NEXT_PHASE_IMPLEMENTATION_PLAN.md` and this breakdown doc after Phases 1 through 5 start landing so the plan stays current.

### Validation Tasks

- [ ] `P6-08` Verify every new backend field added to deployment privacy views is consumed by `frontend-admin/lib/api-hooks.ts` and rendered somewhere visible.
- [ ] `P6-09` Verify docs no longer describe already-shipped features as missing.
- [ ] `P6-10` Verify the operator checklist matches the actual API names and current runtime model.

### Done Checklist

- [ ] admin screens and docs agree on current status
- [ ] deployment posture fields are visible
- [ ] transitional warnings are explicit

## Suggested Execution Wave

If you want to start immediately with minimal coordination overhead, use this first wave:

- engineer A: `P1-01` to `P1-08`
- engineer B: `P2-01` to `P2-05`
- engineer C: `P3-01` to `P3-05`
- engineer D: `P4-01` to `P4-06`

Then start the remaining tasks after the first architectural decisions are locked.

## Immediate Next Tickets

If you want the smallest possible kickoff set, start with these five tickets first:

- [ ] `Kickoff-1` design the `per_auth_tokens` scope extension for subscription-level access
- [ ] `Kickoff-2` add follower subscription PER auth endpoints
- [ ] `Kickoff-3` extend the on-chain adapter port for follower vault initialization
- [ ] `Kickoff-4` replace placeholder PDA creation path in `SubscriptionsService`
- [ ] `Kickoff-5` write the visibility grant scope matrix before implementing grant enforcement
