use anchor_lang::prelude::*;

/// Per-(creator, feed_id) price-condition state.
///
/// `triggered` flips to true the first time `check_price` observes a value
/// satisfying the configured condition. While triggered, all subsequent
/// `check_price` calls fail until `reset_trigger` is invoked by the creator.
///
/// `feed_id` is the 32-byte Pyth feed identifier (e.g. SOL/USD). It is
/// stored both for PDA derivation and so callers can sanity-check that the
/// keeper-supplied price comes from the right oracle.
///
/// V1 follows the keeper-submits-price pattern (mirrors `risk_guard_node`).
/// V2 can wrap a `pyth-solana-receiver-sdk` price account read so the
/// program verifies the Pyth update itself, removing keeper trust.
#[account]
pub struct PythFeedState {
    pub creator: Pubkey,
    /// Pyth feed identifier (32-byte hex, e.g. SOL/USD feed).
    pub feed_id: [u8; 32],
    /// Target price in raw price units (apply `exponent` to interpret).
    pub target_price: i64,
    /// Pyth exponent (negative — e.g. -8 means raw / 1e8 = human price).
    pub exponent: i32,
    /// 0 = above, 1 = below, 2 = equal (±EQUAL_TOLERANCE).
    pub condition: u8,
    /// Max acceptable age (seconds) between Pyth publish_time and this slot.
    /// 0 = no staleness check (NOT recommended in production).
    pub max_staleness_secs: u32,
    /// Last reported price in raw units.
    pub last_price: i64,
    /// Pyth publish_time of `last_price` (unix seconds).
    pub last_publish_time: i64,
    /// Latched: true once the condition has been hit at least once.
    pub triggered: bool,
    /// PDA bump seed.
    pub bump: u8,
    /// Reserved for future fields without re-deriving accounts.
    pub _reserved: [u8; 32],
}

impl PythFeedState {
    /// 8 (discriminator) + 32 + 32 + 8 + 4 + 1 + 4 + 8 + 8 + 1 + 1 + 32 = 139 bytes.
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 4 + 1 + 4 + 8 + 8 + 1 + 1 + 32;
}
