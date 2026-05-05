-- Fix: allow 'auto' trigger_type in workflow_executions
-- The WorkflowLifecycleManager inserts trigger_type='auto' for automatically started workflows,
-- but the original CHECK constraint did not include this value, causing insert failures (PG 23514).

ALTER TABLE public.workflow_executions
DROP CONSTRAINT IF EXISTS workflow_executions_trigger_type_check;

ALTER TABLE public.workflow_executions
ADD CONSTRAINT workflow_executions_trigger_type_check
CHECK (trigger_type = ANY (ARRAY['manual'::text, 'scheduled'::text, 'price_trigger'::text, 'webhook'::text, 'telegram_command'::text, 'auto'::text]));
