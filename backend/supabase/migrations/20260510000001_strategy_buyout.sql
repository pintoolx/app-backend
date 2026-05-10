-- Strategy buyout: per-strategy one-time purchase that grants the buyer the
-- same private-view access as an active creator subscription. Creator-level
-- monthly subscriptions stay unchanged — buyout is a parallel unlock path.

ALTER TABLE strategies
  ADD COLUMN purchase_price_amount NUMERIC,
  ADD COLUMN purchase_payment_mint TEXT;

COMMENT ON COLUMN strategies.purchase_price_amount IS
  'Optional one-time buyout price in smallest unit. NULL = strategy is not for sale individually.';
COMMENT ON COLUMN strategies.purchase_payment_mint IS
  'SPL mint accepted for the buyout (typically the same USDC mint as creator subscriptions).';

CREATE TABLE strategy_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  buyer_wallet TEXT NOT NULL,
  price_amount NUMERIC NOT NULL,
  payment_mint TEXT NOT NULL,
  payment_tx_signature TEXT NOT NULL UNIQUE,
  payout_wallet TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(strategy_id, buyer_wallet)
);

CREATE INDEX idx_strategy_purchases_buyer ON strategy_purchases(buyer_wallet);
CREATE INDEX idx_strategy_purchases_strategy ON strategy_purchases(strategy_id);

COMMENT ON TABLE strategy_purchases IS
  'Per-strategy one-time buyout records. Owning a row here grants the buyer access to the strategy''s private definition, parallel to active creator subscriptions.';
COMMENT ON COLUMN strategy_purchases.payment_tx_signature IS
  'On-chain transaction signature verified by the backend before insertion. Used as natural idempotency key.';
