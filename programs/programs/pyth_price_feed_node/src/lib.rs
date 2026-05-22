use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Placeholder ID — replaced by `anchor keys sync` after first build.
declare_id!("Cu4NttQKr68uxKpy5V2iMecj5EscruaBMZc9D8sbAMcN");

#[program]
pub mod pyth_price_feed_node {
    use super::*;

    /// Initialize a per-(creator, feed_id) price-condition feed.
    /// `condition`: 0 = above, 1 = below, 2 = equal (±EQUAL_TOLERANCE).
    /// `exponent` is the Pyth exponent for `target_price` (typically -8).
    /// `max_staleness_secs` rejects reports older than N seconds (0 = off).
    pub fn initialize_feed(
        ctx: Context<InitializeFeed>,
        feed_id: [u8; 32],
        target_price: i64,
        exponent: i32,
        condition: u8,
        max_staleness_secs: u32,
    ) -> Result<()> {
        instructions::initialize_feed::handler(
            ctx,
            feed_id,
            target_price,
            exponent,
            condition,
            max_staleness_secs,
        )
    }

    /// Keeper-submitted price reading. Latches `triggered = true` the first
    /// time the condition is met; subsequent calls fail until `reset_trigger`.
    /// V2 will replace the trusted reading with on-chain Pyth verification.
    pub fn check_price(
        ctx: Context<CheckPrice>,
        current_price: i64,
        publish_time: i64,
    ) -> Result<()> {
        instructions::check_price::handler(ctx, current_price, publish_time)
    }

    /// Creator-only — clear the latched trigger so the feed can fire again.
    pub fn reset_trigger(ctx: Context<ResetTrigger>) -> Result<()> {
        instructions::reset_trigger::handler(ctx)
    }
}
