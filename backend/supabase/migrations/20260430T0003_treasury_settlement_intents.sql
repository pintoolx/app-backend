-- Phase 5 follower-vault privacy: treasury settlement intents.
--
-- Tracks every unsubscribe / redeem request that needs to move encrypted
-- value out of the per-vault Umbra treasury. Settlement is asynchronous
-- (queue + callback) so we capture the lifecycle here for admin replay /
-- reconciliation.
--
-- Idempotent: re-running is a no-op.

CREATE TABLE IF NOT EXISTS public.treasury_settlement_intents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('unsubscribe', 'redeem')),
  policy text NOT NULL DEFAULT 'unshield'
    CHECK (policy IN ('unshield', 'transfer-to-self')),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created',
      'intent-queued',
      'claim-queued',
      'confirmed',
      'failed',
      'stuck'
    )),
  queue_signature text,
  callback_signature text,
  claimable_utxo_ref text,
  recipient_pubkey text,
  mint text,
  amount numeric,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT treasury_settlement_intents_pkey PRIMARY KEY (id),
  CONSTRAINT treasury_settlement_intents_subscription_fkey FOREIGN KEY (subscription_id)
    REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE,
  CONSTRAINT treasury_settlement_intents_deployment_fkey FOREIGN KEY (deployment_id)
    REFERENCES public.strategy_deployments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS treasury_settlement_intents_subscription_idx
  ON public.treasury_settlement_intents(subscription_id);
CREATE INDEX IF NOT EXISTS treasury_settlement_intents_status_idx
  ON public.treasury_settlement_intents(status);
CREATE INDEX IF NOT EXISTS treasury_settlement_intents_pending_age_idx
  ON public.treasury_settlement_intents(created_at)
  WHERE status NOT IN ('confirmed', 'failed');

DROP TRIGGER IF EXISTS treasury_settlement_intents_set_updated_at
  ON public.treasury_settlement_intents;
CREATE TRIGGER treasury_settlement_intents_set_updated_at
  BEFORE UPDATE ON public.treasury_settlement_intents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.treasury_settlement_intents IS
  'Async settlement intents: unsubscribe/redeem flows that move encrypted value out of follower-vault treasury. status surfaces queue → callback → confirmed lifecycle.';
