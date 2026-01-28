-- Enable RLS (Security Best Practice)
ALTER TABLE public.auth_challenges ENABLE ROW LEVEL SECURITY;

-- Grant permissions to service_role (just in case)
GRANT ALL ON public.auth_challenges TO service_role;
GRANT ALL ON public.auth_challenges TO postgres;

-- Explicit Policy for Service Role (Backstop if Bypass fails)
DROP POLICY IF EXISTS "Service Role Full Access" ON public.auth_challenges;

CREATE POLICY "Service Role Full Access"
ON public.auth_challenges
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Ensure Anon cannot access this table
REVOKE ALL ON public.auth_challenges FROM anon;
REVOKE ALL ON public.auth_challenges FROM authenticated;
