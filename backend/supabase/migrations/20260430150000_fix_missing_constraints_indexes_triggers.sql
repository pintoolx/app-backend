-- Fix missing constraints, indexes, and triggers from strategy platform migrations
-- This migration is idempotent and safe to re-run.

-- 0. Ensure shared trigger function exists ----------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1. strategies indexes & trigger -------------------------------------------
CREATE INDEX IF NOT EXISTS strategies_creator_idx ON public.strategies(creator_wallet_address);
CREATE INDEX IF NOT EXISTS strategies_visibility_idx ON public.strategies(visibility_mode);
DROP TRIGGER IF EXISTS strategies_set_updated_at ON public.strategies;
CREATE TRIGGER strategies_set_updated_at
  BEFORE UPDATE ON public.strategies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. strategy_versions unique constraint ------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strategy_versions_unique'
  ) THEN
    ALTER TABLE public.strategy_versions ADD CONSTRAINT strategy_versions_unique UNIQUE (strategy_id, version);
  END IF;
END $$;

-- 3. strategy_deployments indexes & trigger ---------------------------------
CREATE INDEX IF NOT EXISTS strategy_deployments_strategy_idx ON public.strategy_deployments(strategy_id);
CREATE INDEX IF NOT EXISTS strategy_deployments_creator_idx ON public.strategy_deployments(creator_wallet_address);
CREATE INDEX IF NOT EXISTS strategy_deployments_lifecycle_idx ON public.strategy_deployments(lifecycle_status);
DROP TRIGGER IF EXISTS strategy_deployments_set_updated_at ON public.strategy_deployments;
CREATE TRIGGER strategy_deployments_set_updated_at
  BEFORE UPDATE ON public.strategy_deployments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. strategy_permissions unique constraint & trigger -----------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strategy_permissions_unique'
  ) THEN
    ALTER TABLE public.strategy_permissions ADD CONSTRAINT strategy_permissions_unique UNIQUE (deployment_id, member_wallet, role);
  END IF;
END $$;
DROP TRIGGER IF EXISTS strategy_permissions_set_updated_at ON public.strategy_permissions;
CREATE TRIGGER strategy_permissions_set_updated_at
  BEFORE UPDATE ON public.strategy_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. strategy_public_snapshots unique constraint & index --------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strategy_public_snapshots_unique'
  ) THEN
    ALTER TABLE public.strategy_public_snapshots ADD CONSTRAINT strategy_public_snapshots_unique UNIQUE (deployment_id, snapshot_revision);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS strategy_public_snapshots_deployment_idx ON public.strategy_public_snapshots(deployment_id);

-- 6. strategy_runs indexes --------------------------------------------------
CREATE INDEX IF NOT EXISTS strategy_runs_deployment_idx ON public.strategy_runs(deployment_id);
CREATE INDEX IF NOT EXISTS strategy_runs_status_idx ON public.strategy_runs(status);

-- 7. strategy_treasury_grants index -----------------------------------------
CREATE INDEX IF NOT EXISTS strategy_treasury_grants_grantee_idx ON public.strategy_treasury_grants(grantee_wallet);

-- 8. strategy_per_groups index ----------------------------------------------
CREATE INDEX IF NOT EXISTS strategy_per_groups_creator_idx ON public.strategy_per_groups(creator_wallet);

-- 9. per_auth_tokens missing CHECK constraint & indexes ---------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'per_auth_tokens_subscription_scope_chk'
  ) THEN
    ALTER TABLE public.per_auth_tokens ADD CONSTRAINT per_auth_tokens_subscription_scope_chk
      CHECK (
        (scope_kind = 'deployment' AND subscription_id IS NULL)
        OR
        (scope_kind = 'subscription' AND subscription_id IS NOT NULL)
      );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS per_auth_tokens_deployment_idx ON public.per_auth_tokens(deployment_id);
CREATE INDEX IF NOT EXISTS per_auth_tokens_wallet_idx ON public.per_auth_tokens(wallet);
CREATE INDEX IF NOT EXISTS per_auth_tokens_status_idx ON public.per_auth_tokens(status);
CREATE INDEX IF NOT EXISTS per_auth_tokens_subscription_idx ON public.per_auth_tokens(deployment_id, subscription_id) WHERE subscription_id IS NOT NULL;

-- 10. follower_vault_umbra_identities unique & index ------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'follower_vault_umbra_identities_vault_unique'
  ) THEN
    ALTER TABLE public.follower_vault_umbra_identities ADD CONSTRAINT follower_vault_umbra_identities_vault_unique UNIQUE (follower_vault_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS follower_vault_umbra_identities_signer_idx ON public.follower_vault_umbra_identities(signer_pubkey);

-- 11. strategy_subscriptions unique & indexes & trigger ---------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strategy_subscriptions_unique'
  ) THEN
    ALTER TABLE public.strategy_subscriptions ADD CONSTRAINT strategy_subscriptions_unique UNIQUE (deployment_id, follower_wallet);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS strategy_subscriptions_deployment_idx ON public.strategy_subscriptions(deployment_id);
CREATE INDEX IF NOT EXISTS strategy_subscriptions_follower_idx ON public.strategy_subscriptions(follower_wallet);
CREATE INDEX IF NOT EXISTS strategy_subscriptions_status_idx ON public.strategy_subscriptions(status);
CREATE INDEX IF NOT EXISTS strategy_subscriptions_provisioning_state_idx ON public.strategy_subscriptions(provisioning_state);
CREATE INDEX IF NOT EXISTS strategy_subscriptions_lifecycle_drift_idx ON public.strategy_subscriptions(lifecycle_drift) WHERE lifecycle_drift = true;
DROP TRIGGER IF EXISTS strategy_subscriptions_set_updated_at ON public.strategy_subscriptions;
CREATE TRIGGER strategy_subscriptions_set_updated_at
  BEFORE UPDATE ON public.strategy_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 12. follower_vaults unique & indexes & trigger ----------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'follower_vaults_subscription_unique'
  ) THEN
    ALTER TABLE public.follower_vaults ADD CONSTRAINT follower_vaults_subscription_unique UNIQUE (subscription_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS follower_vaults_deployment_idx ON public.follower_vaults(deployment_id);
CREATE INDEX IF NOT EXISTS follower_vaults_lifecycle_idx ON public.follower_vaults(lifecycle_status);
DROP TRIGGER IF EXISTS follower_vaults_set_updated_at ON public.follower_vaults;
CREATE TRIGGER follower_vaults_set_updated_at
  BEFORE UPDATE ON public.follower_vaults
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 13. follower_visibility_grants indexes & trigger --------------------------
CREATE INDEX IF NOT EXISTS follower_visibility_grants_subscription_idx ON public.follower_visibility_grants(subscription_id);
CREATE INDEX IF NOT EXISTS follower_visibility_grants_grantee_idx ON public.follower_visibility_grants(grantee_wallet);
CREATE INDEX IF NOT EXISTS follower_visibility_grants_status_idx ON public.follower_visibility_grants(status);
CREATE INDEX IF NOT EXISTS follower_visibility_grants_subscription_status_expiry_idx ON public.follower_visibility_grants(subscription_id, status, expires_at);
DROP TRIGGER IF EXISTS follower_visibility_grants_set_updated_at ON public.follower_visibility_grants;
CREATE TRIGGER follower_visibility_grants_set_updated_at
  BEFORE UPDATE ON public.follower_visibility_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 14. private_execution_cycles unique & index -------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'private_execution_cycles_idempotency_unique'
  ) THEN
    ALTER TABLE public.private_execution_cycles ADD CONSTRAINT private_execution_cycles_idempotency_unique UNIQUE (deployment_id, idempotency_key);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS private_execution_cycles_deployment_started_idx ON public.private_execution_cycles(deployment_id, started_at DESC);

-- 15. follower_execution_receipts indexes -----------------------------------
CREATE INDEX IF NOT EXISTS follower_execution_receipts_cycle_idx ON public.follower_execution_receipts(cycle_id);
CREATE INDEX IF NOT EXISTS follower_execution_receipts_subscription_idx ON public.follower_execution_receipts(subscription_id);

-- 16. follower_visibility_grant_events indexes ------------------------------
CREATE INDEX IF NOT EXISTS follower_visibility_grant_events_grant_idx ON public.follower_visibility_grant_events(grant_id);
CREATE INDEX IF NOT EXISTS follower_visibility_grant_events_subscription_idx ON public.follower_visibility_grant_events(subscription_id);
CREATE INDEX IF NOT EXISTS follower_visibility_grant_events_created_idx ON public.follower_visibility_grant_events(created_at DESC);

-- 17. treasury_settlement_intents indexes & trigger -------------------------
CREATE INDEX IF NOT EXISTS treasury_settlement_intents_subscription_idx ON public.treasury_settlement_intents(subscription_id);
CREATE INDEX IF NOT EXISTS treasury_settlement_intents_status_idx ON public.treasury_settlement_intents(status);
CREATE INDEX IF NOT EXISTS treasury_settlement_intents_pending_age_idx ON public.treasury_settlement_intents(created_at) WHERE status IN ('created', 'intent-queued', 'claim-queued', 'stuck');
DROP TRIGGER IF EXISTS treasury_settlement_intents_set_updated_at ON public.treasury_settlement_intents;
CREATE TRIGGER treasury_settlement_intents_set_updated_at
  BEFORE UPDATE ON public.treasury_settlement_intents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 18. admin_ops indexes -----------------------------------------------------
CREATE INDEX IF NOT EXISTS banned_wallets_banned_by_idx ON public.banned_wallets(banned_by);
CREATE INDEX IF NOT EXISTS banned_wallets_expires_at_idx ON public.banned_wallets(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_users_status_idx ON public.admin_users(status);

-- 19. Ensure admin_audit_logs_id_seq exists (referenced by schema) ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'admin_audit_logs_id_seq'
  ) THEN
    CREATE SEQUENCE public.admin_audit_logs_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
    ALTER SEQUENCE public.admin_audit_logs_id_seq OWNED BY public.admin_audit_logs.id;
    ALTER TABLE public.admin_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.admin_audit_logs_id_seq'::regclass);
  END IF;
END $$;
