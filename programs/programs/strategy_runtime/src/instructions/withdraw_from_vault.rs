use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::{FOLLOWER_VAULT_AUTHORITY_SEED, FOLLOWER_VAULT_SEED};
use crate::errors::StrategyRuntimeError;
use crate::state::{
    FollowerVault, FollowerVaultAuthority, FollowerVaultLifecycleStatus, StrategySubscription,
};

/// Subscriber pulls SPL tokens out of the follower-vault token account.
/// Signed by the `vault_authority` PDA (the vault token account owner).
///
/// Allowed while the vault is `Active`, `Paused`, or `Exiting`. If the
/// withdrawal drains the vault while in `Exiting`, the vault transitions to
/// `Closed` (terminal).
#[derive(Accounts)]
pub struct WithdrawFromVault<'info> {
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
        constraint = vault_token_account.owner == vault_authority.key()
            @ StrategyRuntimeError::UnauthorizedFollower,
        constraint = vault_token_account.mint == mint.key()
            @ StrategyRuntimeError::InvalidInstructionData,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = follower_token_account.owner == follower.key()
            @ StrategyRuntimeError::UnauthorizedFollower,
        constraint = follower_token_account.mint == mint.key()
            @ StrategyRuntimeError::InvalidInstructionData,
    )]
    pub follower_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawFromVault>, amount: u64) -> Result<()> {
    require!(amount > 0, StrategyRuntimeError::InvalidInstructionData);

    let current = FollowerVaultLifecycleStatus::from_u8(ctx.accounts.follower_vault.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;
    require!(
        matches!(
            current,
            FollowerVaultLifecycleStatus::Active
                | FollowerVaultLifecycleStatus::Paused
                | FollowerVaultLifecycleStatus::Exiting
        ),
        StrategyRuntimeError::InvalidLifecycleTransition
    );

    let pre_balance = ctx.accounts.vault_token_account.amount;
    require!(
        amount <= pre_balance,
        StrategyRuntimeError::InvalidInstructionData
    );

    let follower_vault_key = ctx.accounts.follower_vault.key();
    let authority_bump = ctx.accounts.vault_authority.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        FOLLOWER_VAULT_AUTHORITY_SEED,
        follower_vault_key.as_ref(),
        &[authority_bump],
    ]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.vault_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.follower_token_account.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    // Final-withdrawal transition: if this drained the vault during Exiting,
    // close it. Other lifecycle transitions are owned by
    // `set_follower_vault_status`.
    if amount == pre_balance && matches!(current, FollowerVaultLifecycleStatus::Exiting) {
        let closed = FollowerVaultLifecycleStatus::Closed as u8;
        ctx.accounts.follower_vault.lifecycle_status = closed;
        ctx.accounts.subscription.lifecycle_status = closed;
        msg!(
            "follower_vault {} transitioned Exiting -> Closed (drained)",
            ctx.accounts.follower_vault.key()
        );
    }

    msg!(
        "withdraw_from_vault vault={} mint={} amount={}",
        ctx.accounts.follower_vault.key(),
        ctx.accounts.mint.key(),
        amount
    );
    Ok(())
}
