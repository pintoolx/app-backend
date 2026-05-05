-- Add retry support to strategy_runs
-- Allows automatic retry of failed strategy runs up to a configurable limit.

ALTER TABLE public.strategy_runs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS retry_of uuid REFERENCES public.strategy_runs(id) ON DELETE SET NULL;

-- Index for finding failed runs that can be retried
CREATE INDEX IF NOT EXISTS strategy_runs_failed_retriable_idx
  ON public.strategy_runs(deployment_id, retry_count)
  WHERE status = 'failed' AND retry_count < max_retries;
