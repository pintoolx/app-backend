-- Phase 1 follower-vault privacy: subscription-scoped PER tokens.
--
-- Mirrors the changes in
--   backend/src/database/schema/initial-5-per.sql (per_auth_tokens columns)
--   backend/src/database/schema/initial-8-follower-vaults.sql (FK wiring)
--
-- Adds:
--   - per_auth_tokens.scope_kind  ('deployment' | 'subscription')
--   - per_auth_tokens.subscription_id  (FK to strategy_subscriptions)
--   - composite index for fast lookups of subscription-scoped tokens
--   - CHECK constraint enforcing scope_kind / subscription_id consistency
--
-- All existing rows default to scope_kind = 'deployment' so legacy tokens
-- keep their behaviour. Idempotent: re-running is a no-op.

ALTER TABLE public.per_auth_tokens
  ADD COLUMN IF NOT EXISTS scope_kind text NOT NULL DEFAULT 'deployment';

ALTER TABLE public.per_auth_tokens
  ADD COLUMN IF NOT EXISTS subscription_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'per_auth_tokens_scope_kind_chk'
  ) THEN
    ALTER TABLE public.per_auth_tokens
      ADD CONSTRAINT per_auth_tokens_scope_kind_chk
        CHECK (scope_kind IN ('deployment', 'subscription'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'per_auth_tokens_subscription_scope_chk'
  ) THEN
    ALTER TABLE public.per_auth_tokens
      ADD CONSTRAINT per_auth_tokens_subscription_scope_chk
        CHECK (
          (scope_kind = 'deployment' AND subscription_id IS NULL)
          OR
          (scope_kind = 'subscription' AND subscription_id IS NOT NULL)
        );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'per_auth_tokens_subscription_fkey'
  ) THEN
    ALTER TABLE public.per_auth_tokens
      ADD CONSTRAINT per_auth_tokens_subscription_fkey
        FOREIGN KEY (subscription_id)
        REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS per_auth_tokens_subscription_idx
  ON public.per_auth_tokens(deployment_id, subscription_id)
  WHERE subscription_id IS NOT NULL;

COMMENT ON COLUMN public.per_auth_tokens.scope_kind IS
  'PER token scope: ''deployment'' for creator/operator/auditor access; ''subscription'' for follower-self private-state reads.';
COMMENT ON COLUMN public.per_auth_tokens.subscription_id IS
  'FK to strategy_subscriptions for subscription-scoped tokens. NULL when scope_kind = ''deployment''.';
