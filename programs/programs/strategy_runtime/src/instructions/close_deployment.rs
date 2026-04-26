use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::{LifecycleStatus, StrategyDeployment, StrategyState};

#[derive(Accounts)]
pub struct CloseDeployment<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        close = creator,
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        mut,
        close = creator,
        constraint = strategy_state.deployment == deployment.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub strategy_state: Account<'info, StrategyState>,
}

pub fn handler(ctx: Context<CloseDeployment>) -> Result<()> {
    let lifecycle = LifecycleStatus::from_u8(ctx.accounts.deployment.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;
    require!(
        matches!(lifecycle, LifecycleStatus::Stopped),
        StrategyRuntimeError::DeploymentNotStopped
    );
    msg!(
        "close_deployment deployment={}",
        ctx.accounts.deployment.key()
    );
    Ok(())
}
