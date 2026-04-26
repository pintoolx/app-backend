use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::{LifecycleStatus, StrategyDeployment, StrategyState};

#[derive(Accounts)]
pub struct SetLifecycleStatus<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        mut,
        constraint = strategy_state.deployment == deployment.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub strategy_state: Account<'info, StrategyState>,
}

pub fn handler(ctx: Context<SetLifecycleStatus>, new_status: u8) -> Result<()> {
    let next = LifecycleStatus::from_u8(new_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;
    let current = LifecycleStatus::from_u8(ctx.accounts.deployment.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;

    require!(
        current.can_transition_to(next),
        StrategyRuntimeError::InvalidLifecycleTransition
    );

    ctx.accounts.deployment.lifecycle_status = next as u8;
    ctx.accounts.strategy_state.lifecycle_status = next as u8;
    msg!(
        "lifecycle deployment={} {:?} -> {:?}",
        ctx.accounts.deployment.key(),
        current,
        next
    );
    Ok(())
}
