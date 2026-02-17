-- Add user_type column to users table
ALTER TABLE public.users
  ADD COLUMN user_type text NOT NULL DEFAULT 'human'
  CONSTRAINT chk_user_type CHECK (user_type IN ('human', 'agent'));

-- Create api_keys table
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  wallet_address text NOT NULL REFERENCES public.users(wallet_address),
  name text NOT NULL DEFAULT 'Default',
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add indexes
CREATE INDEX idx_api_keys_key_hash ON public.api_keys (key_hash);
CREATE INDEX idx_api_keys_wallet_address ON public.api_keys (wallet_address);

-- Partial unique index: one active key per wallet
CREATE UNIQUE INDEX idx_api_keys_one_active_per_wallet
  ON public.api_keys (wallet_address)
  WHERE is_active = true;

-- Enable RLS (Security Best Practice)
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Grant permissions to service_role and postgres
GRANT ALL ON public.api_keys TO service_role;
GRANT ALL ON public.api_keys TO postgres;

-- Explicit Policy for Service Role (Backstop if Bypass fails)
DROP POLICY IF EXISTS "Service Role Full Access" ON public.api_keys;

CREATE POLICY "Service Role Full Access"
ON public.api_keys
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Ensure Anon and Authenticated cannot access this table
REVOKE ALL ON public.api_keys FROM anon;
REVOKE ALL ON public.api_keys FROM authenticated;
