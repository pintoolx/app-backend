-- Strategy Platform Migration (Phase 3 - PER & Private Payments)
-- Reference: backend/docs/STRATEGY_PLATFORM_DEV_SPEC.md, Week 5 plan
--
-- Adds tracking tables for MagicBlock PER permission groups and the
-- challenge-signature-token auth flow used to gate private state access,
-- plus deployment tracking columns for PER and Private Payments endpoints.
-- Legacy deployments stay valid (all new columns nullable, tables empty).

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

-- 2. per_auth_tokens: server-issued PER access tokens (revocable, auditable).
--    Two states are recorded in the same table:
--      status='challenge'  -> a pending challenge nonce; signature still due
--      status='active'     -> a verified token; clients send it as bearer
--      status='revoked'    -> revoked by close, rotation, or admin
CREATE TABLE IF NOT EXISTS public.per_auth_tokens (
  token text NOT NULL,
  deployment_id uuid NOT NULL,
  wallet text NOT NULL,
  group_id text,
  status text NOT NULL DEFAULT 'challenge'
    CHECK (status IN ('challenge', 'active', 'revoked')),
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  CONSTRAINT per_auth_tokens_pkey PRIMARY KEY (token),
  CONSTRAINT per_auth_tokens_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS per_auth_tokens_deployment_idx
  ON public.per_auth_tokens(deployment_id);
CREATE INDEX IF NOT EXISTS per_auth_tokens_wallet_idx
  ON public.per_auth_tokens(wallet);
CREATE INDEX IF NOT EXISTS per_auth_tokens_status_idx
  ON public.per_auth_tokens(status);

-- 3. strategy_deployments columns for endpoint tracking. The session ids
--    already exist (er_session_id, per_session_id) — we add the resolved
--    endpoint URLs and a Private Payments session id so we can persist what
--    we actually used at delegate / register time.
ALTER TABLE public.strategy_deployments
  ADD COLUMN IF NOT EXISTS per_endpoint_url text,
  ADD COLUMN IF NOT EXISTS pp_session_id text,
  ADD COLUMN IF NOT EXISTS pp_endpoint_url text;

COMMENT ON TABLE public.strategy_per_groups
  IS 'One row per deployment that opted into MagicBlock PER (Private Ephemeral Rollups). Members JSONB shape: [{wallet, role, expiresAt?}]';
COMMENT ON TABLE public.per_auth_tokens
  IS 'PER challenge-signature-token store. Tokens transition challenge -> active on signature verify, and active -> revoked on close or rotation.';
