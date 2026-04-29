-- Phase 2 follower-vault privacy: stepwise provisioning state machine.
--
-- Captures where a subscription is in its on-chain wiring journey so that the
-- create flow can be resumed after a partial failure (e.g. RPC timeout between
-- initialize_follower_vault and initialize_follower_vault_authority).
--
-- Adds:
--   - strategy_subscriptions.provisioning_state (enum-style text + CHECK)
--   - strategy_subscriptions.provisioning_error (last error message)
--   - strategy_subscriptions.lifecycle_drift (DB lifecycle != on-chain)
--   - strategy_subscriptions.subscription_pda_bump / follower_vault_pda_bump /
--     vault_authority_pda_bump (smallints, for future verify checks)
--
-- Backfill: any row whose subscription_pda still has the legacy
-- 'placeholder-' prefix is marked provisioning_state = 'legacy_placeholder'
-- so admin tooling can flag it. New rows insert with default 'db_inserted'.
--
-- Idempotent: re-running is a no-op.

ALTER TABLE public.strategy_subscriptions
  ADD COLUMN IF NOT EXISTS provisioning_state text NOT NULL DEFAULT 'db_inserted';

ALTER TABLE public.strategy_subscriptions
  ADD COLUMN IF NOT EXISTS provisioning_error text;

ALTER TABLE public.strategy_subscriptions
  ADD COLUMN IF NOT EXISTS lifecycle_drift boolean NOT NULL DEFAULT false;

ALTER TABLE public.strategy_subscriptions
  ADD COLUMN IF NOT EXISTS subscription_pda_bump smallint;

ALTER TABLE public.strategy_subscriptions
  ADD COLUMN IF NOT EXISTS follower_vault_pda_bump smallint;

ALTER TABLE public.strategy_subscriptions
  ADD COLUMN IF NOT EXISTS vault_authority_pda_bump smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'strategy_subscriptions_provisioning_state_chk'
  ) THEN
    ALTER TABLE public.strategy_subscriptions
      ADD CONSTRAINT strategy_subscriptions_provisioning_state_chk
        CHECK (provisioning_state IN (
          'db_inserted',
          'subscription_initialized',
          'vault_initialized',
          'vault_authority_initialized',
          'provisioning_complete',
          'provisioning_failed',
          'legacy_placeholder'
        ));
  END IF;
END $$;

-- Backfill: legacy rows that were created with the placeholder PDAs get the
-- 'legacy_placeholder' state so the admin UI can flag them as needing migration.
UPDATE public.strategy_subscriptions
   SET provisioning_state = 'legacy_placeholder'
 WHERE subscription_pda LIKE 'placeholder-%'
    OR follower_vault_pda LIKE 'placeholder-%'
    OR vault_authority_pda LIKE 'placeholder-%';

-- Helpful index for admin filters / resume workers.
CREATE INDEX IF NOT EXISTS strategy_subscriptions_provisioning_state_idx
  ON public.strategy_subscriptions(provisioning_state);
CREATE INDEX IF NOT EXISTS strategy_subscriptions_lifecycle_drift_idx
  ON public.strategy_subscriptions(lifecycle_drift)
  WHERE lifecycle_drift = true;

COMMENT ON COLUMN public.strategy_subscriptions.provisioning_state IS
  'Stepwise provisioning state machine. Values: db_inserted | subscription_initialized | vault_initialized | vault_authority_initialized | provisioning_complete | provisioning_failed | legacy_placeholder.';
COMMENT ON COLUMN public.strategy_subscriptions.provisioning_error IS
  'Last error message captured during provisioning. Cleared when the row reaches provisioning_complete.';
COMMENT ON COLUMN public.strategy_subscriptions.lifecycle_drift IS
  'True when DB lifecycle could not be reflected on-chain (set_follower_vault_status retry exhausted). Admins reconcile manually.';
