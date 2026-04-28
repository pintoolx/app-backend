use anchor_lang::prelude::*;

use crate::constants::FOLLOWER_VAULT_AUTHORITY_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{FollowerVault, FollowerVaultAuthority};

#[derive(Accounts)]
pub struct InitializeFollowerVaultAuthority<'info> {
    #[account(mut)]
    pub follower: Signer<'info>,

    #[account(
        mut,
        constraint = follower_vault.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub follower_vault: Account<'info, FollowerVault>,

    #[account(
        init,
        payer = follower,
        space = FollowerVaultAuthority::SIZE,
        seeds = [FOLLOWER_VAULT_AUTHORITY_SEED, follower_vault.key().as_ref()],
        bump,
    )]
    pub authority: Account<'info, FollowerVaultAuthority>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeFollowerVaultAuthority>) -> Result<()> {
    let acc = &mut ctx.accounts.authority;
    acc.follower_vault = ctx.accounts.follower_vault.key();
    acc.follower = ctx.accounts.follower.key();
    acc.status = 0;
    acc.allowed_mint_config_hash = [0u8; 32];
    acc.bump = ctx.bumps.authority;
    acc._reserved = [0u8; crate::constants::RESERVED_ACCOUNT_BYTES];

    // Backwire the follower vault so the authority key is discoverable from
    // the vault row alone.
    ctx.accounts.follower_vault.authority = acc.key();

    msg!(
        "follower_vault_authority initialized vault={} follower={}",
        acc.follower_vault,
        acc.follower
    );
    Ok(())
}
