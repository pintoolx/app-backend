-- Admin Phase 2 (Write Operations)
-- Reference: spec /home/kuoba123/.factory/specs/2026-04-26-admin-page.md (Stage B)
--
-- Adds:
--   1. banned_wallets — denylist enforced by BannedWalletsGuard on user routes
--   2. workflow_executions.killed_by / killed_at — admin "kill execution" trail
--
-- Maintenance mode (system_config.key='maintenance_mode') uses the existing
-- system_config table from initial-1.sql, no new column needed.

-- 1. banned_wallets
CREATE TABLE IF NOT EXISTS public.banned_wallets (
  wallet text NOT NULL,
  banned_by uuid NOT NULL,
  reason text,
  banned_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone,
  CONSTRAINT banned_wallets_pkey PRIMARY KEY (wallet),
  CONSTRAINT banned_wallets_banned_by_fkey FOREIGN KEY (banned_by)
    REFERENCES public.admin_users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS banned_wallets_banned_by_idx
  ON public.banned_wallets(banned_by);
CREATE INDEX IF NOT EXISTS banned_wallets_expires_at_idx
  ON public.banned_wallets(expires_at);

COMMENT ON TABLE public.banned_wallets IS
  'Wallets blocked from authenticating against the user-facing API. Admin /admin/* paths bypass this gate so a misfire cannot lock admins out.';

-- 2. workflow_executions kill audit columns
ALTER TABLE public.workflow_executions
  ADD COLUMN IF NOT EXISTS killed_by uuid,
  ADD COLUMN IF NOT EXISTS killed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS killed_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'workflow_executions_killed_by_fkey'
      AND table_name = 'workflow_executions'
  ) THEN
    ALTER TABLE public.workflow_executions
      ADD CONSTRAINT workflow_executions_killed_by_fkey
      FOREIGN KEY (killed_by) REFERENCES public.admin_users(id);
  END IF;
END$$;

COMMENT ON COLUMN public.workflow_executions.killed_by IS
  'admin_users.id who killed this execution (set by /admin/executions/:id/kill)';
