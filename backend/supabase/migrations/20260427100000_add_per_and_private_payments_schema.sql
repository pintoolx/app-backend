-- Strategy Platform Phase 3 - PER & Private Payments tables
-- Creates strategy_per_groups and per_auth_tokens before follower-vault FK wiring.

-- 1. strategy_per_groups: one row per deployment that uses PER
CREATE TABLE IF NOT EXISTS public.strategy_per_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL,
  group_id text NOT NULL,
  creator_wallet text NOT NULL,
  members jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategy_per_groups_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_per_groups_deployment_unique UNIQUE (deployment_id),
  CONSTRAINT strategy_per_groups_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS strategy_per_groups_creator_idx
  ON public.strategy_per_groups(creator_wallet);

-- 2. per_auth_tokens: server-issued PER access tokens
CREATE TABLE IF NOT EXISTS public.per_auth_tokens (
  token text NOT NULL,
  deployment_id uuid NOT NULL,
  wallet text NOT NULL,
  group_id text,
  scope_kind text NOT NULL DEFAULT 'deployment'
    CHECK (scope_kind IN ('deployment', 'subscription')),
  subscription_id uuid,
  status text NOT NULL DEFAULT 'challenge'
    CHECK (status IN ('challenge', 'active', 'revoked')),
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  CONSTRAINT per_auth_tokens_pkey PRIMARY KEY (token),
  CONSTRAINT per_auth_tokens_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE,
  CONSTRAINT per_auth_tokens_subscription_scope_chk
    CHECK (
      (scope_kind = 'deployment' AND subscription_id IS NULL)
      OR
      (scope_kind = 'subscription' AND subscription_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS per_auth_tokens_deployment_idx
  ON public.per_auth_tokens(deployment_id);
CREATE INDEX IF NOT EXISTS per_auth_tokens_wallet_idx
  ON public.per_auth_tokens(wallet);
CREATE INDEX IF NOT EXISTS per_auth_tokens_status_idx
  ON public.per_auth_tokens(status);
CREATE INDEX IF NOT EXISTS per_auth_tokens_subscription_idx
  ON public.per_auth_tokens(deployment_id, subscription_id)
  WHERE subscription_id IS NOT NULL;

-- 3. strategy_deployments columns for endpoint tracking
ALTER TABLE public.strategy_deployments
  ADD COLUMN IF NOT EXISTS per_endpoint_url text,
  ADD COLUMN IF NOT EXISTS pp_session_id text,
  ADD COLUMN IF NOT EXISTS pp_endpoint_url text;
