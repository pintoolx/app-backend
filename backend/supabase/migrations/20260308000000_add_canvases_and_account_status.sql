-- Migration: 20260308000000_add_canvases_and_account_status
-- Description:
--   1. Create `canvases` table for draft workflow designs
--   2. Add `canvas_id` FK to `workflows` table
--   3. Replace `accounts.is_active` boolean with `status` enum (inactive/active/closed)

-- ============================================================
-- 1. Create canvases table
-- ============================================================
CREATE TABLE public.canvases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_wallet_address text NOT NULL,
  name text NOT NULL,
  description text,
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT canvases_pkey PRIMARY KEY (id),
  CONSTRAINT canvases_owner_wallet_address_fkey FOREIGN KEY (owner_wallet_address) REFERENCES public.users(wallet_address)
);

CREATE INDEX idx_canvases_owner ON public.canvases(owner_wallet_address);

-- ============================================================
-- 2. Add canvas_id to workflows
-- ============================================================
ALTER TABLE public.workflows
ADD COLUMN IF NOT EXISTS canvas_id uuid REFERENCES public.canvases(id) ON DELETE SET NULL;

CREATE INDEX idx_workflows_canvas_id ON public.workflows(canvas_id);

-- ============================================================
-- 3. Migrate accounts.is_active → status
-- ============================================================
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'inactive'
  CHECK (status IN ('inactive', 'active', 'closed'));

-- Migrate existing data: true → 'active', false → 'closed'
UPDATE public.accounts SET status = 'active' WHERE is_active = true;
UPDATE public.accounts SET status = 'closed' WHERE is_active = false;

-- Drop old column
ALTER TABLE public.accounts DROP COLUMN IF EXISTS is_active;
