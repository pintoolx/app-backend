# Next Phase Privacy Implementation Plan

This document turns the current privacy gap analysis into a concrete next-phase implementation plan.

It is intended to sit on top of:

- [NATIVE_PRIVACY_IMPLEMENTATION_PLAN.md](./NATIVE_PRIVACY_IMPLEMENTATION_PLAN.md)
- [FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md](./FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md)
- [ADMIN_NATIVE_PRIVACY_BACKLOG.md](./ADMIN_NATIVE_PRIVACY_BACKLOG.md)
- [NEXT_PHASE_TASK_BREAKDOWN.md](./NEXT_PHASE_TASK_BREAKDOWN.md)

The goal of this plan is not to redesign the system again.
The goal is to move the repo from:

- deployment-level privacy integration
- follower-vault phase-1 scaffolding
- admin observability with partial runtime objects

to:

- real follower-scoped privacy boundaries
- real follower vault authority shells
- real grant enforcement
- private execution orchestration that is closer to the privacy-native target

## 1. Current Baseline

The repo already has meaningful progress:

- deployment-level Umbra, PER, and Private Payments integration exists
- follower subscription, follower vault, Umbra identity, grant, and private-cycle tables exist
- admin privacy APIs and UI tabs for follower-vault observability already exist
- follower vault private balance reads already use per-vault Umbra identities
- private execution cycle scaffolding already computes sanitized allocations and writes follower payloads into PER
- Anchor instructions for follower subscription / follower vault / follower vault authority already exist

The next phase should therefore focus on closing the remaining authority and runtime gaps instead of redoing the data model.

## 2. Primary Gaps To Close

The missing pieces are concentrated in six areas:

1. follower-scoped PER auth and private-state read paths are still missing
2. backend subscription provisioning still uses placeholder PDAs instead of real on-chain accounts
3. visibility grants are persisted but not enforced in PER or Umbra
4. private execution cycles are still allocation scaffolds, not a true private runtime fan-out
5. treasury flows are incomplete because Umbra transfer and exit flows are not fully implemented
6. admin/docs still mix "planned" and "already shipped" surfaces

## 3. Delivery Principles

Use these principles while implementing the next phase:

- prefer finishing one privacy boundary end to end before widening scope
- avoid adding more blueprint-only surfaces before the existing ones become authoritative
- preserve the current sanitized-payload rule for admin and follower views
- do not expose sibling follower state through convenience APIs
- treat PER as the private read/write authority whenever sensitive follower state is involved
- treat Umbra as the private treasury authority whenever follower balances are involved

## 4. Phase 1: Follower-Scoped Private Visibility

### Objective

Make it possible for a follower to authenticate into PER with subscription scope and read only their own private state.

### Why This Comes First

The architecture already assumes a subscriber can see self-scoped private outputs. Without this, follower privacy is incomplete even if the rest of the follower-vault model exists.

### Deliverables

- add `GET /deployments/:id/subscriptions/:subscriptionId/per/auth/challenge`
- add `POST /deployments/:id/subscriptions/:subscriptionId/per/auth/verify`
- add `GET /deployments/:id/subscriptions/:subscriptionId/private-state`
- add subscription-scoped token validation in the PER auth layer
- add ownership checks that bind the authenticated wallet to the subscription row

### Backend Work

- extend `backend/src/follower-vaults/subscriptions.controller.ts`
- extend `backend/src/follower-vaults/subscriptions.service.ts`
- extend the PER token model so it can distinguish deployment-scope and subscription-scope access
- add a follower-private-state service path that proxies into PER without exposing deployment-wide private state

### Acceptance Criteria

- a follower can obtain a PER token scoped to their subscription
- a follower can read only their own private state
- a follower cannot read sibling follower state
- a follower cannot use a subscription token to access deployment-wide private state

## 5. Phase 2: Replace Placeholder PDAs With Real On-Chain Follower Vault Accounts

### Objective

Replace synthetic PDA placeholders with real Anchor-backed subscription, follower vault, and vault authority accounts.

### Why This Comes Second

The repo already has the data model and the on-chain instructions. The missing layer is backend wiring. Until this lands, the follower-vault model is still only partially real.

### Deliverables

- backend create-subscription flow invokes on-chain initialization
- real subscription PDA is stored in `strategy_subscriptions.subscription_pda`
- real follower vault PDA is stored in `strategy_subscriptions.follower_vault_pda` and `follower_vaults.vault_pda`
- real follower vault authority PDA is stored in `strategy_subscriptions.vault_authority_pda` and `follower_vaults.authority_pda`
- lifecycle transitions are reflected both off-chain and on-chain

### Backend Work

- remove `placeholderPda()` usage from `backend/src/follower-vaults/subscriptions.service.ts`
- integrate the Anchor instructions for:
  - follower subscription initialization
  - follower vault initialization
  - follower vault authority initialization
  - follower vault lifecycle changes
- upgrade `fund-intent` from a hint-only response to a real instruction builder response

### On-Chain Work

- validate the instruction contracts already defined in `programs/programs/strategy_runtime/src/instructions`
- ensure the authority and lifecycle model used by backend matches the Anchor account invariants

### Acceptance Criteria

- no new follower subscription uses placeholder PDAs
- admin and follower APIs return real PDA values
- pause / resume / unsubscribe / redeem update the on-chain lifecycle as well as the database row
- drill-down views can correlate the DB rows with the on-chain accounts

## 6. Phase 3: Make Visibility Grants Actually Enforce Access

### Objective

Turn visibility grants from an audit ledger into an effective access-control mechanism.

### Why This Matters

The current system records grants, but grant creation does not yet change what PER or Umbra will reveal. That means selective disclosure is modeled, not enforced.

### Deliverables

- define a grant scope matrix for PER and Umbra
- enforce grant scope on follower private-state reads
- enforce grant scope on follower private-balance reads
- implement real Umbra viewer grant behavior
- implement grant revoke behavior across both the DB ledger and runtime systems

### Backend Work

- extend `backend/src/follower-vaults/subscriptions.service.ts`
- implement actual `grantViewer` behavior in `backend/src/umbra/umbra-real.adapter.ts`
- add PER-side access filtering or role/group synchronization for granted readers
- make revoke operations propagate to runtime systems rather than only mutating DB rows

### Suggested Scope Matrix

- `vault-balance`: read private balance only
- `vault-state`: read follower private state only
- `metrics-window`: read bounded historical metrics only
- `auditor-window`: read time-scoped audit surface only
- `subscriber-self`: owner-only follower view

### Acceptance Criteria

- a grant changes what a grantee can actually query
- a revoked grant immediately stops future access
- follower self-view still remains the default owner path
- sibling follower state remains unenumerable without an explicit grant model that allows it

## 7. Phase 4: Upgrade Private Cycles From Scaffold To Runtime Orchestration

### Objective

Move private execution cycles from a sanitized allocation scaffold toward a real private execution pipeline.

### Current Limitation

Today the cycle service mainly consumes a caller-provided `notional`, computes proportional allocations, stores sanitized receipts, and attempts PER fan-out. This is useful, but it is not yet the architecture's private strategy runtime.

### Deliverables

- support `fixed` and `mirror` allocation modes in addition to `proportional`
- replace caller-supplied allocation input as the main source of truth with strategy-private outputs
- persist richer follower execution receipts while preserving sanitized public/admin payloads
- build vault operation plans from the private cycle result
- track skip reasons for paused, exiting, or otherwise ineligible followers

### Backend Work

- extend `backend/src/follower-vaults/follower-vault-allocations.service.ts`
- extend `backend/src/follower-vaults/private-execution-cycles.service.ts`
- add a planner layer that turns private strategy output into follower vault operations
- preserve idempotency but make retry logic operate on the private plan model instead of only replaying trigger metadata

### Acceptance Criteria

- all supported allocation modes produce meaningful outputs
- cycle results come from private strategy outputs, not only external `notional`
- the system emits follower-specific vault operation plans
- sanitized receipts remain safe for admin display

## 8. Phase 5: Complete The Treasury Plane

### Objective

Close the treasury gaps so follower-vault copy trading is not limited to register / shield / withdraw only.

### Deliverables

- implement Umbra transfer support
- define creator treasury to follower treasury flow boundaries
- define fee accrual and payout behavior for private treasuries
- implement unsubscribe / redeem settlement behavior against real treasury state
- make deployment-level identity isolation explicit instead of implicit

### Backend Work

- implement `transfer()` in `backend/src/umbra/umbra-real.adapter.ts`
- wire real exit and settlement behavior into follower unsubscribe / redeem flows
- add explicit identity-isolation reporting for deployment treasuries vs follower-vault treasuries

### Acceptance Criteria

- private treasury transfer paths are supported
- unsubscribe and redeem correspond to real treasury settlement behavior
- the system can describe which assets are still shielded and which have exited
- deployment and follower isolation modes are visible to operators

## 9. Phase 6: Align Admin Surfaces And Documentation With Reality

### Objective

Bring the docs and admin status model back in sync with the actual implementation.

### Why This Matters

Some privacy docs still describe already-shipped phase-1 surfaces as backlog, while a few true gaps are not highlighted clearly enough. This makes planning and operator understanding harder than it needs to be.

### Deliverables

- update `ADMIN_NATIVE_PRIVACY_BACKLOG.md` to separate shipped, partial, and missing items
- add `identityIsolationMode` to deployment privacy views
- add `runtimeAuthorityMode` to deployment privacy views
- surface warnings for shared deployment identities, placeholder PDAs, and unenforced grants where applicable
- add a small operator checklist for end-to-end privacy verification

### Frontend Work

- refine the privacy page to mark each area as `shipped`, `partial`, or `next`
- surface stronger deployment drill-down warnings
- keep the current tab structure, but make it reflect actual phase status instead of static backlog language

### Acceptance Criteria

- docs and admin UI agree on what is already implemented
- deployment drill-down shows actual isolation/runtime posture
- operators can tell whether a deployment is still using transitional privacy behavior

## 10. Recommended Execution Order

Implement the next phase in this order:

1. Phase 1: follower-scoped private visibility
2. Phase 2: real on-chain follower vault wiring
3. Phase 3: visibility grant enforcement
4. Phase 4: private cycle orchestration
5. Phase 5: treasury completeness
6. Phase 6: admin and docs alignment

This order is intentional:

- follower privacy boundaries should exist before more runtime complexity is added
- real PDA wiring should happen before building more features on placeholder account references
- grant enforcement should happen before presenting selective disclosure as a finished feature
- runtime orchestration should happen before optimizing admin posture reporting

## 11. Definition Of Done

The next phase is complete when all of the following are true:

1. followers authenticate into PER with subscription scope and can read only self-scoped private state
2. follower subscriptions, vaults, and vault authorities use real on-chain PDAs instead of placeholders
3. visibility grants change real access behavior in PER and Umbra, and revocation stops future access
4. private cycles produce real follower vault operation plans rather than only allocation receipts
5. treasury flows support transfer, exit, and settlement behavior consistently
6. admin surfaces and docs accurately describe the actual privacy posture of each deployment

## 12. Suggested Work Breakdown For The Team

If multiple contributors work in parallel, split the effort this way:

- track A: follower PER auth and private-state visibility
- track B: Anchor wiring and backend PDA provisioning
- track C: grant enforcement across PER and Umbra
- track D: private cycle planner and allocation engine upgrades
- track E: treasury completion and settlement flows
- track F: admin/doc alignment after the runtime pieces stabilize

This split keeps the critical path clear while minimizing rework.
