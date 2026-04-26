use anchor_lang::prelude::*;

use crate::constants::STRATEGY_DEPLOYMENT_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{ExecutionMode, LifecycleStatus, StrategyDeployment, StrategyVersion};

#[derive(Accounts)]
#[instruction(deployment_id: [u8; 16], execution_mode: u8, deployment_nonce: u64)]
pub struct InitializeDeployment<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = strategy_version.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub strategy_version: Account<'info, StrategyVersion>,

    #[account(
        init,
        payer = creator,
        space = StrategyDeployment::SIZE,
        seeds = [STRATEGY_DEPLOYMENT_SEED, &deployment_id],
        bump,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeDeployment>,
    deployment_id: [u8; 16],
    execution_mode: u8,
    deployment_nonce: u64,
) -> Result<()> {
    let _ = ExecutionMode::from_u8(execution_mode)
        .ok_or(StrategyRuntimeError::InvalidExecutionMode)?;
    let clock = Clock::get()?;

    let acc = &mut ctx.accounts.deployment;
    acc.creator = ctx.accounts.creator.key();
    acc.strategy_version = ctx.accounts.strategy_version.key();
    acc.vault_authority = Pubkey::default();
    acc.deployment_id = deployment_id;
    acc.execution_mode = execution_mode;
    acc.lifecycle_status = LifecycleStatus::Draft as u8;
    acc.deployment_nonce = deployment_nonce;
    acc.initialized_slot = clock.slot;
    acc.bump = ctx.bumps.deployment;
    acc._reserved = [0u8; crate::constants::RESERVED_ACCOUNT_BYTES];
    msg!(
        "deployment initialized id={:?} creator={}",
        deployment_id,
        acc.creator
    );
    Ok(())
}
