-- Demo prep (2026-05-08): add verified + display_name to creator subscription
-- plans so the marketplace + creator-profile endpoints can return curated
-- metadata without a parallel creators table. We piggy-back on
-- creator_subscription_plans because it already has exactly one row per
-- creator (PK = creator_wallet) and is queried in every marketplace path.

ALTER TABLE creator_subscription_plans
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE creator_subscription_plans
  ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE INDEX IF NOT EXISTS idx_creator_subscription_plans_verified
  ON creator_subscription_plans(verified)
  WHERE verified = true;

COMMENT ON COLUMN creator_subscription_plans.verified IS
  'Operator-curated trust badge surfaced in marketplace + creator profile. Toggled via admin endpoint; never auto-set.';
COMMENT ON COLUMN creator_subscription_plans.display_name IS
  'Operator-curated display name for the creator. Falls back to wallet short form when null.';
