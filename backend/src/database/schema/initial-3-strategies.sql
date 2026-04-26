-- Strategy Platform Migration (Phase 1 - Track B)
-- Reference: backend/docs/STRATEGY_PLATFORM_DEV_SPEC.md
--
-- This migration introduces the dedicated strategy data model that replaces
-- the workflow-table-as-strategy shortcut. Legacy workflow tables stay intact
-- for backwards compatibility (dual-track strategy).

-- 1. strategies: top-level creator-authored strategy package
CREATE TABLE IF NOT EXISTS public.strategies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  creator_wallet_address text NOT NULL,
  source_workflow_id uuid,
  name text NOT NULL,
  description text,
  visibility_mode text NOT NULL DEFAULT 'private'
    CHECK (visibility_mode IN ('private', 'public')),
  lifecycle_state text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft', 'published', 'archived')),
  current_version integer NOT NULL DEFAULT 0,
  public_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  compiled_ir jsonb,
  private_definition_ref text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategies_pkey PRIMARY KEY (id),
  CONSTRAINT strategies_creator_fkey FOREIGN KEY (creator_wallet_address)
    REFERENCES public.users(wallet_address),
  CONSTRAINT strategies_source_workflow_fkey FOREIGN KEY (source_workflow_id)
    REFERENCES public.workflows(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS strategies_creator_idx
  ON public.strategies(creator_wallet_address);
CREATE INDEX IF NOT EXISTS strategies_visibility_idx
  ON public.strategies(visibility_mode);

-- 2. strategy_versions: append-only published versions of a strategy
CREATE TABLE IF NOT EXISTS public.strategy_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL,
  version integer NOT NULL,
  public_metadata_hash text NOT NULL,
  private_definition_commitment text NOT NULL,
  compiled_ir jsonb NOT NULL,
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'deprecated')),
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategy_versions_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_versions_unique UNIQUE (strategy_id, version),
  CONSTRAINT strategy_versions_strategy_fkey FOREIGN KEY (strategy_id)
    REFERENCES public.strategies(id) ON DELETE CASCADE
);

-- 3. strategy_deployments: concrete deploy instance bound to a vault/account
CREATE TABLE IF NOT EXISTS public.strategy_deployments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  strategy_id uuid NOT NULL,
  strategy_version_id uuid,
  creator_wallet_address text NOT NULL,
  account_id uuid,
  execution_mode text NOT NULL DEFAULT 'offchain'
    CHECK (execution_mode IN ('offchain', 'er', 'per')),
  treasury_mode text NOT NULL DEFAULT 'public'
    CHECK (treasury_mode IN ('public', 'private_payments', 'umbra')),
  lifecycle_status text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN ('draft', 'deployed', 'paused', 'stopped', 'closed')),
  state_revision integer NOT NULL DEFAULT 0,
  private_state_account text,
  public_snapshot_account text,
  er_session_id text,
  per_session_id text,
  umbra_user_account text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategy_deployments_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_deployments_strategy_fkey FOREIGN KEY (strategy_id)
    REFERENCES public.strategies(id) ON DELETE CASCADE,
  CONSTRAINT strategy_deployments_strategy_version_fkey FOREIGN KEY (strategy_version_id)
    REFERENCES public.strategy_versions(id) ON DELETE SET NULL,
  CONSTRAINT strategy_deployments_creator_fkey FOREIGN KEY (creator_wallet_address)
    REFERENCES public.users(wallet_address),
  CONSTRAINT strategy_deployments_account_fkey FOREIGN KEY (account_id)
    REFERENCES public.accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS strategy_deployments_strategy_idx
  ON public.strategy_deployments(strategy_id);
CREATE INDEX IF NOT EXISTS strategy_deployments_creator_idx
  ON public.strategy_deployments(creator_wallet_address);
CREATE INDEX IF NOT EXISTS strategy_deployments_lifecycle_idx
  ON public.strategy_deployments(lifecycle_status);

-- 4. strategy_permissions: role/flag grants for non-creator viewers/operators
CREATE TABLE IF NOT EXISTS public.strategy_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL,
  member_wallet text NOT NULL,
  role text NOT NULL
    CHECK (role IN ('creator', 'operator', 'viewer', 'subscriber', 'auditor')),
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategy_permissions_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_permissions_unique UNIQUE (deployment_id, member_wallet, role),
  CONSTRAINT strategy_permissions_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE
);

-- 5. strategy_public_snapshots: monotonic public-facing summary for discovery
CREATE TABLE IF NOT EXISTS public.strategy_public_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL,
  snapshot_revision integer NOT NULL,
  status text NOT NULL,
  pnl_summary_bps numeric,
  risk_band text,
  public_metrics_hash text,
  public_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_slot bigint,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategy_public_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_public_snapshots_unique UNIQUE (deployment_id, snapshot_revision),
  CONSTRAINT strategy_public_snapshots_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE
);

-- 6. strategy_runs: each execution attempt of a deployment
CREATE TABLE IF NOT EXISTS public.strategy_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL,
  strategy_version_id uuid,
  execution_layer text NOT NULL DEFAULT 'offchain'
    CHECK (execution_layer IN ('offchain', 'er', 'per')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  public_outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  private_state_ref text,
  er_session_id text,
  per_session_id text,
  workflow_execution_id uuid,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  error_message text,
  CONSTRAINT strategy_runs_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_runs_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE,
  CONSTRAINT strategy_runs_version_fkey FOREIGN KEY (strategy_version_id)
    REFERENCES public.strategy_versions(id) ON DELETE SET NULL,
  CONSTRAINT strategy_runs_workflow_execution_fkey FOREIGN KEY (workflow_execution_id)
    REFERENCES public.workflow_executions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS strategy_runs_deployment_idx
  ON public.strategy_runs(deployment_id);
CREATE INDEX IF NOT EXISTS strategy_runs_status_idx
  ON public.strategy_runs(status);

-- 7. strategy_treasury_grants: selective disclosure / viewer grants for treasury
CREATE TABLE IF NOT EXISTS public.strategy_treasury_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL,
  grantee_wallet text NOT NULL,
  grant_type text NOT NULL
    CHECK (grant_type IN ('umbra_view_key', 'per_member_flag', 'compliance_audit')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategy_treasury_grants_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_treasury_grants_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS strategy_treasury_grants_grantee_idx
  ON public.strategy_treasury_grants(grantee_wallet);
