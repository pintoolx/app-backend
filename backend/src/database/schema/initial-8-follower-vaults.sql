-- Native Privacy Phase 1 — Follower Vault domain model
-- Reference:
--   docs/privacy/NATIVE_PRIVACY_IMPLEMENTATION_PLAN.md §9
--   docs/privacy/FOLLOWER_VAULT_PRIVACY_ARCHITECTURE.md §10–§12
--
-- The companion versioned migration lives at
-- `supabase/migrations/20260428T0000_add_follower_vaults_schema.sql`. Keep
-- the two files in sync.
--
-- Adds the off-chain backing schema for:
--   - strategy_subscriptions       (one row per (deployment, follower))
--   - follower_vaults              (one row per subscription, holds vault PDAs)
--   - follower_vault_umbra_identities (per-vault Umbra signer identity refs;
--                                      stores PUBLIC fields + HKDF salt only —
--                                      never the secret material)
--   - follower_visibility_grants   (advisory grant ledger)
--   - private_execution_cycles     (orchestration scaffold; one row per cycle)
--   - follower_execution_receipts  (sanitized per-follower outcome of a cycle)
--
-- Anchor program PDAs for these entities arrive in a follow-up phase. Until
-- then *_pda columns hold deterministic placeholder strings produced by the
-- backend. They are nullable so Phase-2 Anchor accounts can backfill them.

-- 0. shared updated_at trigger function -------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1. follower_vault_umbra_identities ----------------------------------------
-- Stored before strategy_subscriptions to allow FK resolution when the
-- subscription row references its identity.
CREATE TABLE IF NOT EXISTS public.follower_vault_umbra_identities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  follower_vault_id uuid NOT NULL,
  signer_pubkey text NOT NULL,
  x25519_public_key text,
  encrypted_user_account text,
  -- Hex-encoded HKDF salt. The keeper master key is never persisted; the
  -- per-vault Ed25519 signer is recomputed at sign time from
  -- HKDF(keeperSecret, salt=derivation_salt, info='follower-vault-umbra-v1').
  derivation_salt text NOT NULL,
  mvk_ref text,
  registration_status text
    CHECK (registration_status IS NULL
      OR registration_status IN ('pending', 'confirmed', 'failed')),
  register_queue_signature text,
  register_callback_signature text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT follower_vault_umbra_identities_pkey PRIMARY KEY (id),
  CONSTRAINT follower_vault_umbra_identities_vault_unique UNIQUE (follower_vault_id)
);
CREATE INDEX IF NOT EXISTS follower_vault_umbra_identities_signer_idx
  ON public.follower_vault_umbra_identities(signer_pubkey);

COMMENT ON TABLE public.follower_vault_umbra_identities
  IS 'Per-follower-vault Umbra signer identity. derivation_salt + signer_pubkey are public; keeper master secret is never persisted.';
COMMENT ON COLUMN public.follower_vault_umbra_identities.derivation_salt
  IS 'Hex-encoded random salt used to derive the per-vault Ed25519 signer via HKDF(keeperSecret, salt, info=''follower-vault-umbra-v1'')';

-- 2. strategy_subscriptions -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategy_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL,
  follower_wallet text NOT NULL,
  subscription_pda text,
  follower_vault_pda text,
  vault_authority_pda text,
  status text NOT NULL DEFAULT 'pending_funding'
    CHECK (status IN ('pending_funding', 'active', 'paused', 'exiting', 'closed')),
  visibility_preset text NOT NULL DEFAULT 'subscriber-self',
  max_capital numeric,
  allocation_mode text NOT NULL DEFAULT 'proportional'
    CHECK (allocation_mode IN ('proportional', 'fixed', 'mirror')),
  max_drawdown_bps integer,
  per_member_ref text,
  umbra_identity_ref uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategy_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_subscriptions_unique UNIQUE (deployment_id, follower_wallet),
  CONSTRAINT strategy_subscriptions_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE,
  CONSTRAINT strategy_subscriptions_follower_fkey FOREIGN KEY (follower_wallet)
    REFERENCES public.users(wallet_address),
  CONSTRAINT strategy_subscriptions_umbra_identity_fkey FOREIGN KEY (umbra_identity_ref)
    REFERENCES public.follower_vault_umbra_identities(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS strategy_subscriptions_deployment_idx
  ON public.strategy_subscriptions(deployment_id);
CREATE INDEX IF NOT EXISTS strategy_subscriptions_follower_idx
  ON public.strategy_subscriptions(follower_wallet);
CREATE INDEX IF NOT EXISTS strategy_subscriptions_status_idx
  ON public.strategy_subscriptions(status);

DROP TRIGGER IF EXISTS strategy_subscriptions_set_updated_at ON public.strategy_subscriptions;
CREATE TRIGGER strategy_subscriptions_set_updated_at
  BEFORE UPDATE ON public.strategy_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. follower_vaults --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.follower_vaults (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  vault_pda text,
  authority_pda text,
  lifecycle_status text NOT NULL DEFAULT 'pending_funding'
    CHECK (lifecycle_status IN ('pending_funding', 'active', 'paused', 'exiting', 'closed')),
  private_state_ref text,
  public_snapshot_ref text,
  custody_mode text NOT NULL DEFAULT 'program_owned'
    CHECK (custody_mode IN ('program_owned', 'self_custody', 'private_payments_relay')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT follower_vaults_pkey PRIMARY KEY (id),
  CONSTRAINT follower_vaults_subscription_unique UNIQUE (subscription_id),
  CONSTRAINT follower_vaults_subscription_fkey FOREIGN KEY (subscription_id)
    REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE,
  CONSTRAINT follower_vaults_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS follower_vaults_deployment_idx
  ON public.follower_vaults(deployment_id);
CREATE INDEX IF NOT EXISTS follower_vaults_lifecycle_idx
  ON public.follower_vaults(lifecycle_status);

DROP TRIGGER IF EXISTS follower_vaults_set_updated_at ON public.follower_vaults;
CREATE TRIGGER follower_vaults_set_updated_at
  BEFORE UPDATE ON public.follower_vaults
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Now that follower_vaults exists we can wire the umbra-identity FK back.
ALTER TABLE public.follower_vault_umbra_identities
  DROP CONSTRAINT IF EXISTS follower_vault_umbra_identities_vault_fkey;
ALTER TABLE public.follower_vault_umbra_identities
  ADD CONSTRAINT follower_vault_umbra_identities_vault_fkey
  FOREIGN KEY (follower_vault_id)
  REFERENCES public.follower_vaults(id) ON DELETE CASCADE;

-- Phase-1 follower-vault privacy: tie subscription-scoped PER tokens to the
-- subscription they were issued for. The column lives in per_auth_tokens
-- (declared in initial-5-per.sql) but the FK is wired here because
-- strategy_subscriptions doesn't exist until this migration runs.
ALTER TABLE public.per_auth_tokens
  DROP CONSTRAINT IF EXISTS per_auth_tokens_subscription_fkey;
ALTER TABLE public.per_auth_tokens
  ADD CONSTRAINT per_auth_tokens_subscription_fkey
  FOREIGN KEY (subscription_id)
  REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE;

-- 4. follower_visibility_grants ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.follower_visibility_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL,
  grantee_wallet text NOT NULL,
  scope text NOT NULL
    CHECK (scope IN (
      'vault-balance',
      'vault-state',
      'metrics-window',
      'auditor-window',
      'creator-only',
      'subscriber-self',
      'coarse-public'
    )),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT follower_visibility_grants_pkey PRIMARY KEY (id),
  CONSTRAINT follower_visibility_grants_subscription_fkey FOREIGN KEY (subscription_id)
    REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS follower_visibility_grants_subscription_idx
  ON public.follower_visibility_grants(subscription_id);
CREATE INDEX IF NOT EXISTS follower_visibility_grants_grantee_idx
  ON public.follower_visibility_grants(grantee_wallet);
CREATE INDEX IF NOT EXISTS follower_visibility_grants_status_idx
  ON public.follower_visibility_grants(status);
-- Speeds up "list active-and-not-yet-expired grants for a subscription".
CREATE INDEX IF NOT EXISTS follower_visibility_grants_subscription_status_expiry_idx
  ON public.follower_visibility_grants(subscription_id, status, expires_at);

DROP TRIGGER IF EXISTS follower_visibility_grants_set_updated_at ON public.follower_visibility_grants;
CREATE TRIGGER follower_visibility_grants_set_updated_at
  BEFORE UPDATE ON public.follower_visibility_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. private_execution_cycles -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_execution_cycles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  trigger_type text NOT NULL,
  trigger_ref text,
  status text NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'running', 'completed', 'failed')),
  metrics_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  error_message text,
  CONSTRAINT private_execution_cycles_pkey PRIMARY KEY (id),
  CONSTRAINT private_execution_cycles_idempotency_unique
    UNIQUE (deployment_id, idempotency_key),
  CONSTRAINT private_execution_cycles_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS private_execution_cycles_deployment_started_idx
  ON public.private_execution_cycles(deployment_id, started_at DESC);

-- 6. follower_execution_receipts --------------------------------------------
CREATE TABLE IF NOT EXISTS public.follower_execution_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  follower_vault_id uuid NOT NULL,
  allocation_amount numeric,
  allocation_pct_bps integer,
  private_state_revision integer,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'applied', 'skipped', 'failed')),
  -- Sanitized payload only. Must NOT contain raw signal inputs, parameter
  -- values, or full trade decisions. See architecture §13.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT follower_execution_receipts_pkey PRIMARY KEY (id),
  CONSTRAINT follower_execution_receipts_cycle_fkey FOREIGN KEY (cycle_id)
    REFERENCES public.private_execution_cycles(id) ON DELETE CASCADE,
  CONSTRAINT follower_execution_receipts_subscription_fkey FOREIGN KEY (subscription_id)
    REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE,
  CONSTRAINT follower_execution_receipts_vault_fkey FOREIGN KEY (follower_vault_id)
    REFERENCES public.follower_vaults(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS follower_execution_receipts_cycle_idx
  ON public.follower_execution_receipts(cycle_id);
CREATE INDEX IF NOT EXISTS follower_execution_receipts_subscription_idx
  ON public.follower_execution_receipts(subscription_id);
