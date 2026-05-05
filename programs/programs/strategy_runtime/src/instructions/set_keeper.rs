use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::StrategyDeployment;

/// Replace the keeper pubkey on a deployment. Only the creator can rotate
/// the keeper. Pass `Pubkey::default()` to revert to "creator-only" mode.
#[derive(Accounts)]
pub struct SetKeeper<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,
}

pub fn handler(ctx: Context<SetKeeper>, new_keeper: Pubkey) -> Result<()> {
    let acc = &mut ctx.accounts.deployment;
    let previous = acc.keeper;
    acc.keeper = new_keeper;
    msg!(
        "set_keeper deployment={} previous={} new={}",
        acc.key(),
        previous,
        new_keeper
    );
    Ok(())
}
