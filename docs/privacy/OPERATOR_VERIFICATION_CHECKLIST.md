# Operator Verification Checklist — Follower Vault Privacy

End-to-end smoke test that exercises every Phase 1–5 code path. Run after a
deploy or before a release cut. Each step lists the expected response shape
so operators can detect regressions without grep-ing logs.

Pre-reqs:
- Deployment ID `<DEPLOY>` exists and the keeper key has loaded.
- `STRATEGY_RUNTIME_PROGRAM_ID` is set if you want Anchor adapter (otherwise
  the Noop adapter computes real PDAs from the IDL fallback address).
- Two wallets:
  - `OWNER` — deployment creator
  - `FOLLOWER` — subscriber

## 1. Subscribe & provision (Phase 2)

```bash
curl -X POST $API/deployments/<DEPLOY>/subscriptions \
  -H "Authorization: Bearer $FOLLOWER_JWT" \
  -d '{"maxCapital":"1000000000","allocationMode":"proportional"}'
```

Expect:
- `data.subscriptionPda`, `data.followerVaultPda`, `data.vaultAuthorityPda`
  are real base58 PDAs (no `placeholder-` prefix).
- `data.provisioningState === 'provisioning_complete'` on the happy path
  (or one of the intermediate states if a step failed).
- `data.lifecycleDrift === false`.

## 2. Resume after partial failure (Phase 2)

If `provisioningState !== 'provisioning_complete'`:

```bash
curl -X POST $API/deployments/<DEPLOY>/subscriptions/<SUB>/resume-provisioning \
  -H "Authorization: Bearer $FOLLOWER_JWT"
```

Expect:
- `data.provisioningState === 'provisioning_complete'`.
- `data.provisioningError === null`.

## 3. Fund intent (Phase 2)

```bash
curl -X POST $API/deployments/<DEPLOY>/subscriptions/<SUB>/fund-intent \
  -H "Authorization: Bearer $FOLLOWER_JWT" \
  -d '{"mint":"So11111111111111111111111111111111111111112","amount":"100000000"}'
```

Expect:
- `data.instruction.instructionBase64` is non-null.
- `data.action === 'transfer-to-follower-vault'`.

## 4. Shield (Phase 1)

```bash
curl -X POST $API/deployments/<DEPLOY>/subscriptions/<SUB>/shield \
  -H "Authorization: Bearer $FOLLOWER_JWT" \
  -d '{"mint":"...","amount":"100000000"}'
```

Expect: status `pending` or `confirmed`. Subscription transitions to `active`.

## 5. PER auth flow (Phase 1)

```bash
curl $API/deployments/<DEPLOY>/subscriptions/<SUB>/per/auth/challenge \
  -H "Authorization: Bearer $FOLLOWER_JWT"
# capture data.challenge

curl -X POST $API/deployments/<DEPLOY>/subscriptions/<SUB>/per/auth/verify \
  -H "Authorization: Bearer $FOLLOWER_JWT" \
  -d "{\"challenge\":\"<challenge>\"}"
# capture data.authToken
```

Expect: 30s challenge, 10min token. Both honour ±5s clock skew.

## 6. Read private state (Phase 1 + Phase 3)

```bash
curl $API/deployments/<DEPLOY>/subscriptions/<SUB>/private-state \
  -H "Authorization: Bearer $FOLLOWER_JWT" \
  -H "X-PER-Token: <authToken>"
```

Expect: `data.accessReason === 'owner'` for the follower itself.

Negative test: try to use a token issued for a *different* subscription;
expect HTTP 401 with `Deployment-scope PER token cannot access subscription
state` or `PER token is not scoped to this subscription`.

## 7. Visibility grant (Phase 3)

```bash
# Owner grants vault-balance scope to a third wallet:
curl -X POST $API/deployments/<DEPLOY>/subscriptions/<SUB>/visibility-grants \
  -H "Authorization: Bearer $FOLLOWER_JWT" \
  -d '{"granteeWallet":"<THIRD>","scope":"vault-balance"}'
```

Then call `/private-balance` from `<THIRD>` JWT and expect
`data.accessReason === 'grant'`. Trying `/private-state` from the same
wallet must return 401 (the grant covers `vault-balance`, not
`vault-state`).

## 8. Revoke grant (Phase 3)

```bash
curl -X DELETE $API/deployments/<DEPLOY>/subscriptions/<SUB>/visibility-grants/<G>
# Re-run the same /private-balance call — expect 401 immediately.
```

## 9. Cycle (Phase 4)

```bash
curl -X POST $API/deployments/<DEPLOY>/cycles \
  -H "Authorization: Bearer $OWNER_JWT" \
  -d '{"triggerType":"manual","idempotencyKey":"smoke-1","notional":"500000000"}'
```

Expect: `data.cycle.status` is `completed` (no failures), `partial` (some
followers failed but at least one applied), or `failed` (all failures).
Receipt rows include `payload.allocationMode`. With strategy provider
wired, expect `payload.strategyVersion` and possibly `payload.skipReason`.

## 10. Unsubscribe + redeem (Phase 5)

```bash
curl -X POST $API/deployments/<DEPLOY>/subscriptions/<SUB>/unsubscribe
curl -X POST $API/deployments/<DEPLOY>/subscriptions/<SUB>/redeem
```

Expect:
- Subscription status transitions: `active → exiting → closed`.
- `vault.lifecycleStatus` mirrors on-chain (or `lifecycleDrift = true` if
  retries were exhausted).
- Active subscription-scoped PER tokens are revoked when entering
  `exiting`/`closed`.
- A row in `treasury_settlement_intents` is created (once that wiring
  lands; tracked under Phase 5 spike).

## 11. Admin overview (Phase 6)

```bash
curl $API/admin/privacy/overview -H "Authorization: Bearer $ADMIN_JWT"
```

Expect counts to reflect the smoke run:
- `subscriptions.byStatus` shifts.
- `privateCycles.last24h` includes the cycle from step 9.
- `visibilityGrants` shows the grant + its revoke.

## Failure-mode rehearsal

- **Lifecycle drift**: temporarily break `STRATEGY_RUNTIME_PROGRAM_ID`,
  call `/pause`, expect `data.lifecycleDrift === true` after 3 retries.
- **Resume after step 2**: kill the process between
  `subscription_initialized` and `vault_initialized`, restart, call
  `/resume-provisioning`, expect completion.
- **Replan**: re-issue the same `idempotencyKey` with `replan: true`
  (if you've added the parameter to the cycle controller); expect
  superseded receipts and a new applied set.
