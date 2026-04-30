-- Phase 4 follower-vault privacy: cycle planner status surface.
--
-- - private_execution_cycles.status learns the 'partial' value so the cycle
--   service can record cycles where some followers were applied but others
--   failed without misclassifying the cycle as completed or fully failed.
-- - follower_execution_receipts.status learns the 'superseded' value so a
--   replan flow can mark the previous receipts as outdated without deleting
--   them (the audit trail stays intact).
--
-- Idempotent: drops + recreates the named CHECK constraints.

-- 1) private_execution_cycles.status -----------------------------------------
ALTER TABLE public.private_execution_cycles
  DROP CONSTRAINT IF EXISTS private_execution_cycles_status_check;

ALTER TABLE public.private_execution_cycles
  ADD CONSTRAINT private_execution_cycles_status_check
    CHECK (status IN ('accepted', 'running', 'completed', 'partial', 'failed'));

COMMENT ON COLUMN public.private_execution_cycles.status IS
  'Cycle terminal state. partial = at least one follower fan-out applied AND at least one failed.';

-- 2) follower_execution_receipts.status --------------------------------------
ALTER TABLE public.follower_execution_receipts
  DROP CONSTRAINT IF EXISTS follower_execution_receipts_status_check;

ALTER TABLE public.follower_execution_receipts
  ADD CONSTRAINT follower_execution_receipts_status_check
    CHECK (status IN ('planned', 'applied', 'skipped', 'failed', 'superseded'));

COMMENT ON COLUMN public.follower_execution_receipts.status IS
  'Receipt lifecycle: planned/applied/skipped/failed are normal terminals; superseded is set when a replan creates new receipts that replace the old ones.';
