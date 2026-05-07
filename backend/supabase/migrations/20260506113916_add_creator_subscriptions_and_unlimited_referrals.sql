-- Creator-level subscriptions + unlimited internal referral codes.

-- ---------------------------------------------------------------------------
-- 1. Referral codes can be single-use (max_uses = 1) or unlimited (NULL).
-- ---------------------------------------------------------------------------
ALTER TABLE public.referral_codes
  DROP CONSTRAINT IF EXISTS referral_codes_max_uses_check;

ALTER TABLE public.referral_codes
  DROP CONSTRAINT IF EXISTS chk_referral_codes_used_count_max;

ALTER TABLE public.referral_codes
  ALTER COLUMN max_uses DROP NOT NULL;

ALTER TABLE public.referral_codes
  ADD CONSTRAINT referral_codes_max_uses_check
  CHECK (max_uses IS NULL OR max_uses > 0);

ALTER TABLE public.referral_codes
  ADD CONSTRAINT chk_referral_codes_used_count_max
  CHECK (max_uses IS NULL OR used_count <= max_uses);

CREATE OR REPLACE FUNCTION public.consume_referral_code(
  p_code text,
  p_wallet text
)
RETURNS SETOF public.referral_codes
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.referral_codes
  SET used_count = used_count + 1,
      status = CASE
        WHEN max_uses IS NOT NULL AND used_count + 1 >= max_uses THEN 'used'
        ELSE status
      END,
      used_by_wallet = CASE
        WHEN used_count = 0 THEN p_wallet
        ELSE used_by_wallet
      END,
      used_at = CASE
        WHEN used_count = 0 THEN now()
        ELSE used_at
      END,
      updated_at = now()
  WHERE code = upper(trim(p_code))
    AND status = 'active'
    AND (max_uses IS NULL OR used_count < max_uses)
    AND (expires_at IS NULL OR expires_at > now())
    AND (created_for_wallet IS NULL OR created_for_wallet = p_wallet)
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_referral_code(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_referral_code(text, text) TO postgres;

-- ---------------------------------------------------------------------------
-- 2. Creator-level monthly subscriptions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_subscription_plans (
  creator_wallet text PRIMARY KEY REFERENCES public.users(wallet_address),
  monthly_price_amount text NOT NULL
    CHECK (monthly_price_amount ~ '^[0-9]+$' AND monthly_price_amount::numeric > 0),
  payment_mint text NOT NULL,
  payout_wallet text NOT NULL REFERENCES public.users(wallet_address),
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_wallet text NOT NULL REFERENCES public.users(wallet_address),
  subscriber_wallet text NOT NULL REFERENCES public.users(wallet_address),
  status text NOT NULL DEFAULT 'payment_required'
    CHECK (status IN ('payment_required', 'active', 'cancelled', 'expired')),
  payment_mint text NOT NULL,
  plan_price_amount text NOT NULL
    CHECK (plan_price_amount ~ '^[0-9]+$' AND plan_price_amount::numeric > 0),
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT creator_subscriptions_unique_pair UNIQUE (creator_wallet, subscriber_wallet)
);

CREATE TABLE IF NOT EXISTS public.creator_subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.creator_subscriptions(id) ON DELETE CASCADE,
  creator_wallet text NOT NULL REFERENCES public.users(wallet_address),
  subscriber_wallet text NOT NULL REFERENCES public.users(wallet_address),
  tx_signature text NOT NULL UNIQUE,
  payment_mint text NOT NULL,
  amount text NOT NULL CHECK (amount ~ '^[0-9]+$' AND amount::numeric > 0),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'rejected')),
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  verification_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_subscriptions_subscriber_idx
  ON public.creator_subscriptions(subscriber_wallet);
CREATE INDEX IF NOT EXISTS creator_subscriptions_creator_status_idx
  ON public.creator_subscriptions(creator_wallet, status, current_period_end);
CREATE INDEX IF NOT EXISTS creator_subscription_payments_subscription_idx
  ON public.creator_subscription_payments(subscription_id);

DROP TRIGGER IF EXISTS creator_subscription_plans_set_updated_at ON public.creator_subscription_plans;
CREATE TRIGGER creator_subscription_plans_set_updated_at
  BEFORE UPDATE ON public.creator_subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS creator_subscriptions_set_updated_at ON public.creator_subscriptions;
CREATE TRIGGER creator_subscriptions_set_updated_at
  BEFORE UPDATE ON public.creator_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.creator_subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_subscription_payments ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.creator_subscription_plans TO service_role;
GRANT ALL ON public.creator_subscription_plans TO postgres;
GRANT ALL ON public.creator_subscriptions TO service_role;
GRANT ALL ON public.creator_subscriptions TO postgres;
GRANT ALL ON public.creator_subscription_payments TO service_role;
GRANT ALL ON public.creator_subscription_payments TO postgres;

DROP POLICY IF EXISTS "Service Role Full Access" ON public.creator_subscription_plans;
CREATE POLICY "Service Role Full Access"
ON public.creator_subscription_plans
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access" ON public.creator_subscriptions;
CREATE POLICY "Service Role Full Access"
ON public.creator_subscriptions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access" ON public.creator_subscription_payments;
CREATE POLICY "Service Role Full Access"
ON public.creator_subscription_payments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

REVOKE ALL ON public.creator_subscription_plans FROM anon;
REVOKE ALL ON public.creator_subscription_plans FROM authenticated;
REVOKE ALL ON public.creator_subscriptions FROM anon;
REVOKE ALL ON public.creator_subscriptions FROM authenticated;
REVOKE ALL ON public.creator_subscription_payments FROM anon;
REVOKE ALL ON public.creator_subscription_payments FROM authenticated;
