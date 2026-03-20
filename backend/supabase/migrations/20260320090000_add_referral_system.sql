-- Migration: 20260320090000_add_referral_system
-- Description:
--   1. Add users.app_role for admin authorization
--   2. Create referral_codes table
--   3. Create referral_user_quotas table
--   4. Add helper RPCs for quota reservation and single-use redemption

-- ============================================================
-- 1. Users role for admin authorization
-- ============================================================
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS app_role text NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_users_app_role'
  ) THEN
    ALTER TABLE public.users
    ADD CONSTRAINT chk_users_app_role
    CHECK (app_role IN ('user', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_app_role ON public.users(app_role);

-- ============================================================
-- 2. Referral codes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  created_by_wallet text NOT NULL REFERENCES public.users(wallet_address),
  created_for_wallet text REFERENCES public.users(wallet_address),
  source_type text NOT NULL CHECK (source_type IN ('admin', 'user')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  used_by_wallet text REFERENCES public.users(wallet_address),
  used_at timestamp with time zone,
  expires_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chk_referral_codes_used_count_max CHECK (used_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_created_by_wallet
ON public.referral_codes(created_by_wallet);

CREATE INDEX IF NOT EXISTS idx_referral_codes_created_for_wallet
ON public.referral_codes(created_for_wallet);

CREATE INDEX IF NOT EXISTS idx_referral_codes_status
ON public.referral_codes(status);

CREATE INDEX IF NOT EXISTS idx_referral_codes_created_at
ON public.referral_codes(created_at DESC);

-- ============================================================
-- 3. User referral quotas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.referral_user_quotas (
  wallet_address text PRIMARY KEY REFERENCES public.users(wallet_address),
  max_codes integer NOT NULL CHECK (max_codes >= 0),
  issued_count integer NOT NULL DEFAULT 0 CHECK (issued_count >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chk_referral_quota_issued_lte_max CHECK (issued_count <= max_codes)
);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_user_quotas ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.referral_codes TO service_role;
GRANT ALL ON public.referral_codes TO postgres;
GRANT ALL ON public.referral_user_quotas TO service_role;
GRANT ALL ON public.referral_user_quotas TO postgres;

DROP POLICY IF EXISTS "Service Role Full Access" ON public.referral_codes;
CREATE POLICY "Service Role Full Access"
ON public.referral_codes
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Service Role Full Access" ON public.referral_user_quotas;
CREATE POLICY "Service Role Full Access"
ON public.referral_user_quotas
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

REVOKE ALL ON public.referral_codes FROM anon;
REVOKE ALL ON public.referral_codes FROM authenticated;
REVOKE ALL ON public.referral_user_quotas FROM anon;
REVOKE ALL ON public.referral_user_quotas FROM authenticated;

-- ============================================================
-- 4. RPC helper functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.reserve_referral_quota(
  p_wallet text,
  p_count integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_updated integer;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN false;
  END IF;

  UPDATE public.referral_user_quotas
  SET issued_count = issued_count + p_count,
      updated_at = now()
  WHERE wallet_address = p_wallet
    AND issued_count + p_count <= max_codes;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_referral_quota(
  p_wallet text,
  p_count integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_updated integer;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN false;
  END IF;

  UPDATE public.referral_user_quotas
  SET issued_count = GREATEST(issued_count - p_count, 0),
      updated_at = now()
  WHERE wallet_address = p_wallet;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

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
        WHEN used_count + 1 >= max_uses THEN 'used'
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
    AND used_count < max_uses
    AND (expires_at IS NULL OR expires_at > now())
    AND (created_for_wallet IS NULL OR created_for_wallet = p_wallet)
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_referral_quota(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_referral_quota(text, integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.release_referral_quota(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_referral_quota(text, integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.consume_referral_code(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_referral_code(text, text) TO postgres;
