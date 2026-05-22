/// PDA seed for the per-(creator, feed_id) PythFeedState account.
/// `seeds = [PYTH_FEED_SEED, creator.key().as_ref(), feed_id.as_ref()]`
pub const PYTH_FEED_SEED: &[u8] = b"pyth_feed";

/// Condition discriminants stored on-chain.
pub const CONDITION_ABOVE: u8 = 0;
pub const CONDITION_BELOW: u8 = 1;
pub const CONDITION_EQUAL: u8 = 2;

/// Tolerance (price units) used when evaluating CONDITION_EQUAL so we don't
/// require an exact integer match on noisy oracle data.
pub const EQUAL_TOLERANCE: i64 = 1;
