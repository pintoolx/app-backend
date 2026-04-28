use anchor_lang::prelude::*;

use crate::constants::FOLLOWER_VAULT_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{
    FollowerVault, FollowerVaultCustodyMode, FollowerVaultLifecycleStatus, StrategySubscription,
};

#[derive(Accounts)]
#[instruction(vault_id: [u8; 16], custody_mode: u8)]
pub struct InitializeFollowerVault<'info> {
    #[account(mut)]
    pub follower: Signer<'info>,

    #[account(
        mut,
        constraint = subscription.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub subscription: Account<'info, StrategySubscription>,

    #[account(
        init,
        payer = follower,
        space = FollowerVault::SIZE,
        seeds = [FOLLOWER_VAULT_SEED, subscription.key().as_ref()],
        bump,
    )]
    pub follower_vault: Account<'info, FollowerVault>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeFollowerVault>,
    vault_id: [u8; 16],
    custody_mode: u8,
) -> Result<()> {
    let _ = FollowerVaultCustodyMode::from_u8(custody_mode)
        .ok_or(StrategyRuntimeError::InvalidCustodyMode)?;
    let clock = Clock::get()?;

    let acc = &mut ctx.accounts.follower_vault;
    acc.subscription = ctx.accounts.subscription.key();
    acc.deployment = ctx.accounts.subscription.deployment;
    acc.follower = ctx.accounts.follower.key();
    acc.authority = Pubkey::default();
    acc.vault_id = vault_id;
    acc.lifecycle_status = FollowerVaultLifecycleStatus::PendingFunding as u8;
    acc.custody_mode = custody_mode;
    acc.created_slot = clock.slot;
    acc.bump = ctx.bumps.follower_vault;
    acc._reserved = [0u8; crate::constants::RESERVED_ACCOUNT_BYTES];

    // Backwire the subscription so off-chain readers can discover the vault
    // pubkey by reading the subscription row alone.
    ctx.accounts.subscription.follower_vault = acc.key();

    msg!(
        "follower_vault initialized id={:?} subscription={} custody_mode={}",
        vault_id,
        acc.subscription,
        custody_mode
    );
    Ok(())
}
