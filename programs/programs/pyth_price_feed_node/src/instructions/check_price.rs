use anchor_lang::prelude::*;

use crate::constants::{CONDITION_ABOVE, CONDITION_BELOW, CONDITION_EQUAL, EQUAL_TOLERANCE};
use crate::errors::PythFeedError;
use crate::state::PythFeedState;

#[derive(Accounts)]
pub struct CheckPrice<'info> {
    /// Anyone can submit a reading — the feed is keyed by (creator, feed_id).
    /// V2 will replace the keeper-trusted price with an on-chain Pyth verify.
    pub caller: Signer<'info>,

    #[account(mut)]
    pub feed: Account<'info, PythFeedState>,
}

pub fn handler(
    ctx: Context<CheckPrice>,
    current_price: i64,
    publish_time: i64,
) -> Result<()> {
    let f = &mut ctx.accounts.feed;
    require!(!f.triggered, PythFeedError::AlreadyTriggered);
    require!(current_price > 0, PythFeedError::InvalidReportedPrice);

    if f.max_staleness_secs > 0 {
        let now = Clock::get()?.unix_timestamp;
        let age = now.saturating_sub(publish_time);
        require!(
            age >= 0 && (age as u64) <= f.max_staleness_secs as u64,
            PythFeedError::StalePrice
        );
    }

    f.last_price = current_price;
    f.last_publish_time = publish_time;

    let hit = match f.condition {
        CONDITION_ABOVE => current_price > f.target_price,
        CONDITION_BELOW => current_price < f.target_price,
        CONDITION_EQUAL => (current_price - f.target_price).abs() <= EQUAL_TOLERANCE,
        _ => return err!(PythFeedError::InvalidCondition),
    };

    if hit {
        f.triggered = true;
        msg!(
            "pyth_feed triggered: current={} target={} cond={}",
            current_price,
            f.target_price,
            f.condition
        );
    }

    Ok(())
}
