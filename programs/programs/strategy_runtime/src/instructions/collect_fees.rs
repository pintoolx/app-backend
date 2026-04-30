use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed,
    system_instruction,
};

use crate::constants::VAULT_AUTHORITY_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{StrategyDeployment, VaultAuthority};

#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    /// CHECK: Vault authority PDA — we only transfer lamports out of it.
    #[account(
        mut,
        seeds = [VAULT_AUTHORITY_SEED, deployment.key().as_ref()],
        bump = vault_authority.bump,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,
}

pub fn handler(ctx: Context<CollectFees>) -> Result<()> {
    let vault_authority = &ctx.accounts.vault_authority;
    let creator_key = ctx.accounts.creator.key();
    let vault_key = vault_authority.key();

    // Ensure custody_mode is program_owned (1) or private_payments_relay (2)
    // so that only vaults that actually hold fees can be collected from.
    require!(
        vault_authority.custody_mode == 1 || vault_authority.custody_mode == 2,
        StrategyRuntimeError::InvalidCustodyMode
    );

    // PDA signer seeds
    let deployment_key = ctx.accounts.deployment.key();
    let seeds: &[&[u8]] = &[
        VAULT_AUTHORITY_SEED,
        deployment_key.as_ref(),
        &[vault_authority.bump],
    ];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    // Calculate rent-exempt minimum for the vault authority account size
    let rent = Rent::get()?;
    let rent_exempt = rent.minimum_balance(VaultAuthority::SIZE);
    let current_lamports = ctx.accounts.vault_authority.to_account_info().lamports();

    // Collect everything above rent-exempt minimum
    let collectable = current_lamports.saturating_sub(rent_exempt);
    require!(collectable > 0, StrategyRuntimeError::NoFeesToCollect);

    // Transfer collectable lamports from vault_authority to creator
    invoke_signed(
        &system_instruction::transfer(&vault_key, &creator_key, collectable),
        &[
            ctx.accounts.vault_authority.to_account_info(),
            ctx.accounts.creator.to_account_info(),
        ],
        signer_seeds,
    )?;

    msg!(
        "collect_fees: vault={}, creator={}, collected={} lamports",
        vault_key,
        creator_key,
        collectable
    );
    Ok(())
}
