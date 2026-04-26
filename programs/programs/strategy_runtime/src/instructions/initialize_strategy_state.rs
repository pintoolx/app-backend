use anchor_lang::prelude::*;

use crate::constants::STRATEGY_STATE_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{LifecycleStatus, StrategyDeployment, StrategyState};

#[derive(Accounts)]
pub struct InitializeStrategyState<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        init,
        payer = creator,
        space = StrategyState::SIZE,
        seeds = [STRATEGY_STATE_SEED, deployment.key().as_ref()],
        bump,
    )]
    pub strategy_state: Account<'info, StrategyState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeStrategyState>) -> Result<()> {
    let clock = Clock::get()?;
    let acc = &mut ctx.accounts.strategy_state;
    acc.deployment = ctx.accounts.deployment.key();
    acc.lifecycle_status = LifecycleStatus::Draft as u8;
    acc.state_revision = 0;
    acc.private_state_commitment = [0u8; 32];
    acc.last_result_code = 0;
    acc.last_commit_slot = clock.slot;
    acc.bump = ctx.bumps.strategy_state;
    acc._reserved = [0u8; crate::constants::RESERVED_ACCOUNT_BYTES];
    msg!("strategy_state initialized deployment={}", acc.deployment);
    Ok(())
}
