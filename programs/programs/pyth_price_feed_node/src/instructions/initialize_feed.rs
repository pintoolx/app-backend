use anchor_lang::prelude::*;

use crate::constants::{CONDITION_ABOVE, CONDITION_BELOW, CONDITION_EQUAL, PYTH_FEED_SEED};
use crate::errors::PythFeedError;
use crate::state::PythFeedState;

#[derive(Accounts)]
#[instruction(feed_id: [u8; 32])]
pub struct InitializeFeed<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = PythFeedState::SIZE,
        seeds = [PYTH_FEED_SEED, creator.key().as_ref(), feed_id.as_ref()],
        bump,
    )]
    pub feed: Account<'info, PythFeedState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeFeed>,
    feed_id: [u8; 32],
    target_price: i64,
    exponent: i32,
    condition: u8,
    max_staleness_secs: u32,
) -> Result<()> {
    require!(target_price > 0, PythFeedError::InvalidTargetPrice);
    require!(
        matches!(condition, CONDITION_ABOVE | CONDITION_BELOW | CONDITION_EQUAL),
        PythFeedError::InvalidCondition
    );

    let f = &mut ctx.accounts.feed;
    f.creator = ctx.accounts.creator.key();
    f.feed_id = feed_id;
    f.target_price = target_price;
    f.exponent = exponent;
    f.condition = condition;
    f.max_staleness_secs = max_staleness_secs;
    f.last_price = 0;
    f.last_publish_time = 0;
    f.triggered = false;
    f.bump = ctx.bumps.feed;
    f._reserved = [0; 32];

    msg!(
        "pyth_feed initialized: creator={} target={} exp={} cond={}",
        f.creator,
        f.target_price,
        f.exponent,
        f.condition
    );
    Ok(())
}
