# System Readiness Checklist

Date: 2026-05-04

## Fixed In This Pass

- Strategy keeper now preserves deployment metadata when clearing `manual_trigger_pending`.
- Strategy runs now persist the latest deployment `state_revision` after successful offchain and ER commits.
- Public snapshot publishing now uses a monotonic revision strategy and always reports successful runs as `ok`.
- Readiness probes now treat non-2xx dependency responses as unhealthy instead of silently passing 401/404.
- On-chain `commit_state` and `commit_state_on_er` now reject commits unless the deployment lifecycle is `Deployed`.
- Admin refresh-token rotation now uses a single Postgres compare-and-swap path via `rotate_admin_refresh_token()`.
- External-service integration specs now require `RUN_EXTERNAL_INTEGRATION_TESTS=1` before they touch devnet, MagicBlock, or Umbra.
- Removed tracked admin credential artifacts (`backend/token.txt`, `backend/scripts/admin/reset-totp-quick.ts`) and kept the supported admin CLI env-driven.
- Root TypeScript build is passing again.
- Program TypeScript lint/typecheck is passing again.

## Verified Commands

- Root: `npm run build`
- Backend: `npm run build`
- Backend: `npm test -- --runInBand`
- Backend: `npm run test:e2e`
- Programs: `npm run lint`
- Programs: `npm run test:rust`
- Frontend admin: previously verified `npm run typecheck` and `npm run build`

## Remaining Risks

- Backend lint still reports existing warnings in unrelated files; there are no lint errors.
- Any credentials that were previously committed still need out-of-band rotation/revocation; removing them from the repo does not invalidate them.

## Suggested Next Review Focus

- Rotate any previously exposed Supabase/admin credentials and verify the old values are dead.
- Replace remaining live-network integration coverage with hermetic adapters or fixtures where practical.
