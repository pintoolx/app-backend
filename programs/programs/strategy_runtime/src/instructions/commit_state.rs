use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::{LifecycleStatus, StrategyDeployment, StrategyState};

#[derive(Accounts)]
pub struct CommitState<'info> {
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        mut,
        constraint = strategy_state.deployment == deployment.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub strategy_state: Account<'info, StrategyState>,
}

pub fn handler(
    ctx: Context<CommitState>,
    expected_revision: u32,
    new_private_state_commitment: [u8; 32],
    last_result_code: u32,
) -> Result<()> {
    let lifecycle = LifecycleStatus::from_u8(ctx.accounts.deployment.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;
    require!(
        matches!(
            lifecycle,
            LifecycleStatus::Deployed | LifecycleStatus::Paused | LifecycleStatus::Stopped
        ),
        StrategyRuntimeError::InvalidLifecycleTransition
    );

    let state = &mut ctx.accounts.strategy_state;
    require!(
        expected_revision == state.state_revision,
        StrategyRuntimeError::StaleRevision
    );

    let clock = Clock::get()?;
    state.state_revision = expected_revision
        .checked_add(1)
        .ok_or(StrategyRuntimeError::StaleRevision)?;
    state.private_state_commitment = new_private_state_commitment;
    state.last_result_code = last_result_code;
    state.last_commit_slot = clock.slot;
    msg!(
        "commit_state deployment={} new_revision={} result_code={}",
        ctx.accounts.deployment.key(),
        state.state_revision,
        last_result_code
    );
    Ok(())
}
