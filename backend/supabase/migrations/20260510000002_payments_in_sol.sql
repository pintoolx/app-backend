-- Switch all monetary flows (creator monthly subscriptions + per-strategy
-- buyouts) from USDC SPL transfers to native SOL transfers.
--
-- Old amounts were stored as USDC raw units (6 decimals). Lamports has 9
-- decimals, so the numeric values are not interchangeable — TRUNCATE the
-- impacted tables to avoid silently mis-pricing existing rows.
--
-- payment_mint columns are removed entirely; SOL has no mint, and supporting
-- alternative mints later would deserve its own design rather than carrying
-- a vestigial NULL field.

TRUNCATE TABLE strategy_purchases CASCADE;
TRUNCATE TABLE creator_subscription_payments CASCADE;
TRUNCATE TABLE creator_subscriptions CASCADE;
TRUNCATE TABLE creator_subscription_plans CASCADE;

ALTER TABLE creator_subscription_plans DROP COLUMN payment_mint;
ALTER TABLE creator_subscriptions DROP COLUMN payment_mint;
ALTER TABLE creator_subscription_payments DROP COLUMN payment_mint;
ALTER TABLE strategies DROP COLUMN purchase_payment_mint;
ALTER TABLE strategy_purchases DROP COLUMN payment_mint;

COMMENT ON COLUMN creator_subscription_plans.monthly_price_amount IS
  'Lamports (1 SOL = 1_000_000_000). Native SOL only.';
COMMENT ON COLUMN creator_subscriptions.plan_price_amount IS
  'Lamports snapshotted at subscription time. Native SOL only.';
COMMENT ON COLUMN creator_subscription_payments.amount IS
  'Lamports paid in this confirmed payment. Native SOL only.';
COMMENT ON COLUMN strategies.purchase_price_amount IS
  'Lamports (1 SOL = 1_000_000_000). NULL = strategy is not for one-time sale.';
COMMENT ON COLUMN strategy_purchases.price_amount IS
  'Lamports paid at the moment of purchase. Native SOL only.';
