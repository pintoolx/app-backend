CREATE TABLE public.auth_challenges (
  wallet_address text NOT NULL PRIMARY KEY,
  challenge text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
