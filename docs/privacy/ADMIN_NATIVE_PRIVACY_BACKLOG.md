# Admin Native Privacy Backlog

This backlog defines how the admin surface should evolve from the current
deployment-level privacy integration view into the follower-vault model defined
by [NATIVE_PRIVACY_IMPLEMENTATION_PLAN.md](./NATIVE_PRIVACY_IMPLEMENTATION_PLAN.md)
and [FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md](./FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md).

## Current Admin Reality

The current admin stack can already observe:

- deployment lifecycle state
- execution mode / treasury mode
- PER auth tokens
- public snapshot freshness
- ER delegation metadata
- deployment-level Umbra registration metadata

The current admin stack cannot yet observe or operate:

- follower subscription lifecycle
- follower vault lifecycle
- per-follower Umbra identity isolation
- visibility grants and revocations
- private execution cycles as first-class runtime objects
- follower-scoped PER state and allocation fan-out

## Backend API Backlog

### Phase A: Deployment Drill-Down Foundation

- keep `GET /admin/privacy/deployments/:id` as the current deployment-level live view
- add `GET /admin/privacy/deployments/:id/follower-vaults`
- add `GET /admin/privacy/deployments/:id/subscriptions`
- add `GET /admin/privacy/deployments/:id/private-cycles`
- extend deployment privacy view with explicit `identityIsolationMode` and `runtimeAuthorityMode`

### Phase B: Global Privacy Operations

- add `GET /admin/privacy/follower-vaults`
- add `GET /admin/privacy/subscriptions`
- add `GET /admin/privacy/visibility-grants`
- add `GET /admin/privacy/private-cycles`
- add `GET /admin/privacy/umbra-identities`

### Phase C: Auditability And Recovery

- add `POST /admin/privacy/visibility-grants/:id/revoke`
- add `POST /admin/privacy/follower-vaults/:id/pause`
- add `POST /admin/privacy/follower-vaults/:id/recover`
- add `GET /admin/privacy/private-cycles/:id`
- add `GET /admin/privacy/attestations`

## Frontend Hooks Backlog

### Hooks That Exist Or Are Wired Now

- `usePrivacyOverview()`
- `usePerTokens()`
- `useDeploymentDetail()`
- `useDeploymentPrivacyView()`

### Hooks To Add Next

- `useFollowerVaults()`
- `useFollowerVaultDetail()`
- `useSubscriptions()`
- `useVisibilityGrants()`
- `usePrivateExecutionCycles()`
- `useUmbraIdentityInventory()`

### Mutation Hooks To Add After Read Surfaces

- `usePauseFollowerVault()`
- `useRecoverFollowerVault()`
- `useRevokeVisibilityGrant()`
- `useRetryPrivateCycle()`

## Admin Page Backlog

### Privacy Page

- keep the current live control-plane metrics
- add blueprint tabs for follower vaults, subscriptions, visibility grants, and private cycles
- show a clear split between `implemented now` and `target architecture`
- expose Umbra isolation caveat until per-vault identities exist

### Deployments Page

- add deployment privacy drill-down using live backend data
- add target follower-vault rollout panel per deployment
- add per-deployment backlog for subscriptions, follower vaults, and private cycles

### Overview Page

- add KPIs for private runtime coverage
- add shielded vs unshielded treasury indicators
- add failed private-cycle alerts

### System Page

- add PER health, Umbra callback health, and isolation warnings
- add degraded-mode visibility for privacy subsystems

### Audit And Strategies Pages

- add visibility-grant and follower-vault audit events
- add privacy posture labels for strategies and strategy versions

## Recommended Delivery Order

1. Upgrade the privacy page to present current state and target blueprint in one place.
2. Add deployment privacy drill-down so operators can inspect a single deployment end to end.
3. Add the first follower-vault and subscription read APIs.
4. Expand overview and system once follower-vault data becomes real.
5. Add grant management and recovery operations after the runtime objects exist.
