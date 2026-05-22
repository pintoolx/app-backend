use anchor_lang::prelude::*;

use crate::errors::PythFeedError;
use crate::state::PythFeedState;

#[derive(Accounts)]
pub struct ResetTrigger<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ PythFeedError::UnauthorizedCaller,
    )]
    pub feed: Account<'info, PythFeedState>,
}

pub fn handler(ctx: Context<ResetTrigger>) -> Result<()> {
    let f = &mut ctx.accounts.feed;
    f.triggered = false;
    f.last_price = 0;
    f.last_publish_time = 0;
    msg!("pyth_feed reset by creator={}", f.creator);
    Ok(())
}
