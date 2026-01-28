-- Migration: 20260129000000_update_schema_v2
-- Description: Updates workflows and executions tables for Frontend History UI and performance.

-- 1. [Workflows] Logic Update: Switch is_active to is_public
-- Drop is_active if it exists (safeguard)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workflows' AND column_name = 'is_active') THEN
        ALTER TABLE public.workflows DROP COLUMN is_active;
    END IF;
END $$;

-- Add is_public with default false (Private by default)
ALTER TABLE public.workflows 
ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false;


-- 2. [Executions] Persistence: Add Snapshot for accurate history replay
ALTER TABLE public.workflow_executions
ADD COLUMN IF NOT EXISTS definition_snapshot jsonb;

-- 3. [Executions] Flexibility: Allow system/notification workflows without wallets
ALTER TABLE public.workflow_executions
ALTER COLUMN account_id DROP NOT NULL;


-- 4. [Performance] Indexing for faster queries
-- Index for querying all executions by a specific user (My History Page)
CREATE INDEX IF NOT EXISTS idx_workflow_executions_owner 
ON public.workflow_executions(owner_wallet_address);

-- Index for querying all executions of a specific workflow (Workflow Stats)
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id 
ON public.workflow_executions(workflow_id);

-- Index for querying transaction history by account (Wallet Activity)
CREATE INDEX IF NOT EXISTS idx_transaction_history_account_id 
ON public.transaction_history(account_id);
