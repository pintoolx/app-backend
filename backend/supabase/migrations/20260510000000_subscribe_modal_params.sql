-- Subscribe modal: risk preset + auto-rebalance toggle + initial deposit (analytics).
-- Driven by demo cuts 10/11 — frontend Subscribe modal needs these parameters
-- exposed end-to-end.
--
-- on-chain note: these fields are NOT yet written into the StrategySubscription
-- account. Keeper consumes them off-chain when planning execution cycles.
-- If on-chain enforcement is needed later, fold them into the
-- `config_commitment` hash that adjust_subscription_params writes.

ALTER TABLE strategy_subscriptions
  ADD COLUMN risk_preset TEXT
    CHECK (risk_preset IN ('conservative', 'moderate', 'aggressive')),
  ADD COLUMN auto_rebalance_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN initial_deposit_amount NUMERIC;

COMMENT ON COLUMN strategy_subscriptions.risk_preset IS
  'Subscribe modal risk dropdown; service-side maps to max_drawdown_bps via RISK_PRESETS table';
COMMENT ON COLUMN strategy_subscriptions.auto_rebalance_enabled IS
  'Subscribe modal toggle; keeper-enforced (off-chain) when planning execution cycles';
COMMENT ON COLUMN strategy_subscriptions.initial_deposit_amount IS
  'Raw smallest-unit amount the user committed at subscribe time. Analytics only — actual on-chain balance lives in the vault token account.';
