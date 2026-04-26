use anchor_lang::prelude::*;

use crate::constants::VAULT_AUTHORITY_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{StrategyDeployment, VaultAuthority};

#[derive(Accounts)]
#[instruction(custody_mode: u8)]
pub struct InitializeVaultAuthority<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        init,
        payer = creator,
        space = VaultAuthority::SIZE,
        seeds = [VAULT_AUTHORITY_SEED, deployment.key().as_ref()],
        bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeVaultAuthority>, custody_mode: u8) -> Result<()> {
    let acc = &mut ctx.accounts.vault_authority;
    acc.deployment = ctx.accounts.deployment.key();
    acc.creator = ctx.accounts.creator.key();
    acc.custody_mode = custody_mode;
    acc.status = 0;
    acc.allowed_mint_config_hash = [0u8; 32];
    acc.bump = ctx.bumps.vault_authority;
    acc._reserved = [0u8; crate::constants::RESERVED_ACCOUNT_BYTES];

    // Wire the deployment back at the vault authority once it exists.
    ctx.accounts.deployment.vault_authority = acc.key();
    msg!(
        "vault_authority initialized deployment={} custody_mode={}",
        acc.deployment,
        custody_mode
    );
    Ok(())
}
