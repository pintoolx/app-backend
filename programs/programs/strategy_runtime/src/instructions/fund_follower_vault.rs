use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{FOLLOWER_VAULT_AUTHORITY_SEED, FOLLOWER_VAULT_SEED};
use crate::errors::StrategyRuntimeError;
use crate::state::{
    FollowerVault, FollowerVaultAuthority, FollowerVaultLifecycleStatus, StrategySubscription,
};

/// Subscriber deposits SPL tokens (USDC) into the follower-vault token
/// account. The vault token account is an ATA owned by the
/// `follower_vault_authority` PDA — created here on first deposit.
///
/// On the first successful deposit while the vault is `PendingFunding`, the
/// lifecycle transitions to `Active` (mirrors the off-chain state machine
/// that gates strategy execution on funded vaults).
#[derive(Accounts)]
pub struct FundFollowerVault<'info> {
    #[account(mut)]
    pub follower: Signer<'info>,

    #[account(
        mut,
        constraint = subscription.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub subscription: Account<'info, StrategySubscription>,

    #[account(
        mut,
        seeds = [FOLLOWER_VAULT_SEED, subscription.key().as_ref()],
        bump = follower_vault.bump,
        constraint = follower_vault.subscription == subscription.key()
            @ StrategyRuntimeError::SubscriptionDeploymentMismatch,
        constraint = follower_vault.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub follower_vault: Account<'info, FollowerVault>,

    #[account(
        seeds = [FOLLOWER_VAULT_AUTHORITY_SEED, follower_vault.key().as_ref()],
        bump = vault_authority.bump,
        constraint = vault_authority.follower_vault == follower_vault.key()
            @ StrategyRuntimeError::SubscriptionDeploymentMismatch,
    )]
    pub vault_authority: Account<'info, FollowerVaultAuthority>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = follower_token_account.owner == follower.key()
            @ StrategyRuntimeError::UnauthorizedFollower,
        constraint = follower_token_account.mint == mint.key()
            @ StrategyRuntimeError::InvalidInstructionData,
    )]
    pub follower_token_account: Box<Account<'info, TokenAccount>>,

    /// ATA owned by `vault_authority`. Created on first deposit.
    #[account(
        init_if_needed,
        payer = follower,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FundFollowerVault>, amount: u64) -> Result<()> {
    require!(amount > 0, StrategyRuntimeError::InvalidInstructionData);

    let current = FollowerVaultLifecycleStatus::from_u8(ctx.accounts.follower_vault.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;

    // Allow deposits while pending_funding (initial fund) or active/paused
    // (top-ups). Reject exiting/closed — funds should be flowing out.
    require!(
        matches!(
            current,
            FollowerVaultLifecycleStatus::PendingFunding
                | FollowerVaultLifecycleStatus::Active
                | FollowerVaultLifecycleStatus::Paused
        ),
        StrategyRuntimeError::InvalidLifecycleTransition
    );

    let cpi_accounts = Transfer {
        from: ctx.accounts.follower_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.follower.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // First successful deposit transitions PendingFunding -> Active.
    if matches!(current, FollowerVaultLifecycleStatus::PendingFunding) {
        let active = FollowerVaultLifecycleStatus::Active as u8;
        ctx.accounts.follower_vault.lifecycle_status = active;
        ctx.accounts.subscription.lifecycle_status = active;
        msg!(
            "follower_vault {} transitioned PendingFunding -> Active",
            ctx.accounts.follower_vault.key()
        );
    }

    msg!(
        "fund_follower_vault vault={} mint={} amount={}",
        ctx.accounts.follower_vault.key(),
        ctx.accounts.mint.key(),
        amount
    );
    Ok(())
}
