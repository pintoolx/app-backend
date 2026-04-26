-- Admin Dashboard (Phase 1)
-- Reference: spec "Admin Dashboard for PinTool Backend"
--
-- Adds three tables:
--   1. admin_users         — staff accounts (email + bcrypt + encrypted TOTP)
--   2. admin_refresh_tokens — server-side refresh-token revocation list
--   3. admin_audit_logs    — append-only audit trail of every admin write
--
-- All tables are isolated from the user-facing schema. They never reference
-- the `users` table; instead admin identity is fully separate (email-based
-- with mandatory TOTP), so a compromise of the wallet auth pipeline cannot
-- escalate into the admin surface.

-- 1. admin_users -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  totp_secret_enc text,                 -- AES-GCM ciphertext (base64)
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('viewer', 'operator', 'superadmin')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone,
  last_login_at timestamp with time zone,
  last_login_ip inet,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_pkey PRIMARY KEY (id),
  CONSTRAINT admin_users_email_unique UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS admin_users_status_idx
  ON public.admin_users (status);

-- 2. admin_refresh_tokens --------------------------------------------------
-- Refresh tokens are stored as SHA-256 hashes so a DB leak does not allow
-- impersonation. `replaced_by` lets us implement rotation: each refresh
-- atomically marks the prior token as `replaced` and inserts a successor.
CREATE TABLE IF NOT EXISTS public.admin_refresh_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'replaced', 'revoked')),
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  replaced_by uuid,
  user_agent text,
  ip_address inet,
  CONSTRAINT admin_refresh_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT admin_refresh_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT admin_refresh_tokens_user_fkey FOREIGN KEY (admin_user_id)
    REFERENCES public.admin_users (id) ON DELETE CASCADE,
  CONSTRAINT admin_refresh_tokens_replaced_by_fkey FOREIGN KEY (replaced_by)
    REFERENCES public.admin_refresh_tokens (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS admin_refresh_tokens_user_idx
  ON public.admin_refresh_tokens (admin_user_id, status);

-- 3. admin_audit_logs ------------------------------------------------------
-- Append-only. Every admin write goes through `AuditInterceptor` which
-- captures `payload_before` (when applicable) and `payload_after`. Read
-- actions are *not* logged here — Loki / Prometheus carry that signal.
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id bigserial NOT NULL,
  admin_user_id uuid,
  admin_email text,
  role text,
  action text NOT NULL,
  target_type text,
  target_id text,
  payload_before jsonb,
  payload_after jsonb,
  request_id text,
  ip_address inet,
  user_agent text,
  status text NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failure')),
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT admin_audit_logs_user_fkey FOREIGN KEY (admin_user_id)
    REFERENCES public.admin_users (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_action_time_idx
  ON public.admin_audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_target_idx
  ON public.admin_audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_user_time_idx
  ON public.admin_audit_logs (admin_user_id, created_at DESC);

-- Bootstrap notes -----------------------------------------------------------
-- There is intentionally no SQL-level seed for the first admin. Use the CLI
-- helper instead:
--
--     ts-node -P tsconfig.json scripts/admin/create-admin.ts \
--       --email ops@yourorg.com --role superadmin
--
-- The script prompts for a password, hashes it with bcrypt, generates a
-- fresh TOTP secret (printed once as an otpauth URL), encrypts it with
-- $ADMIN_TOTP_ENC_KEY (32-byte hex), and inserts the row.
