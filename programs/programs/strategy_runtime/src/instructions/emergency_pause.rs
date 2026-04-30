use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::{LifecycleStatus, StrategyDeployment, StrategyState};

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = deployment.creator == authority.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        mut,
        constraint = strategy_state.deployment == deployment.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub strategy_state: Account<'info, StrategyState>,
}

pub fn handler(ctx: Context<EmergencyPause>) -> Result<()> {
    let current = LifecycleStatus::from_u8(ctx.accounts.deployment.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;

    require!(
        matches!(current, LifecycleStatus::Deployed),
        StrategyRuntimeError::InvalidLifecycleTransition
    );

    let next = LifecycleStatus::Paused;
    ctx.accounts.deployment.lifecycle_status = next as u8;
    ctx.accounts.strategy_state.lifecycle_status = next as u8;

    msg!(
        "EMERGENCY_PAUSE deployment={} authority={} {:?} -> {:?}",
        ctx.accounts.deployment.key(),
        ctx.accounts.authority.key(),
        current,
        next
    );
    Ok(())
}
