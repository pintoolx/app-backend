-- Phase 3 follower-vault privacy: visibility-grant audit log.
--
-- Captures every grant lifecycle event so admins can answer "who shared what
-- with whom and when". Grant rows themselves are mutable (status / revoked_at)
-- so we keep an immutable event tape alongside them.
--
-- Idempotent: re-running is a no-op.

CREATE TABLE IF NOT EXISTS public.follower_visibility_grant_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('created', 'revoked', 'expired-detected')),
  actor_wallet text,
  scope text NOT NULL
    CHECK (scope IN (
      'vault-balance',
      'vault-state',
      'metrics-window',
      'auditor-window',
      'creator-only',
      'subscriber-self',
      'coarse-public'
    )),
  grantee_wallet text NOT NULL,
  expires_at timestamp with time zone,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT follower_visibility_grant_events_pkey PRIMARY KEY (id),
  CONSTRAINT follower_visibility_grant_events_grant_fkey FOREIGN KEY (grant_id)
    REFERENCES public.follower_visibility_grants(id) ON DELETE CASCADE,
  CONSTRAINT follower_visibility_grant_events_subscription_fkey FOREIGN KEY (subscription_id)
    REFERENCES public.strategy_subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS follower_visibility_grant_events_grant_idx
  ON public.follower_visibility_grant_events(grant_id);
CREATE INDEX IF NOT EXISTS follower_visibility_grant_events_subscription_idx
  ON public.follower_visibility_grant_events(subscription_id);
CREATE INDEX IF NOT EXISTS follower_visibility_grant_events_created_idx
  ON public.follower_visibility_grant_events(created_at DESC);

COMMENT ON TABLE public.follower_visibility_grant_events
  IS 'Immutable audit tape for visibility-grant lifecycle events.';
