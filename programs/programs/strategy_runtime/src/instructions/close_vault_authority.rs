use anchor_lang::prelude::*;

use crate::constants::VAULT_AUTHORITY_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{LifecycleStatus, StrategyDeployment, VaultAuthority};

/// Reclaim rent from a [`VaultAuthority`] PDA after the parent deployment has
/// been stopped/closed and any accrued fees have been swept via
/// `collect_fees`. Only the deployment creator can close it.
///
/// The deployment account is **not** closed here — call `close_deployment`
/// first or after, depending on whether you still want to keep the
/// deployment metadata around.
#[derive(Accounts)]
pub struct CloseVaultAuthority<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        mut,
        close = creator,
        seeds = [VAULT_AUTHORITY_SEED, deployment.key().as_ref()],
        bump = vault_authority.bump,
        constraint = vault_authority.deployment == deployment.key()
            @ StrategyRuntimeError::SubscriptionDeploymentMismatch,
    )]
    pub vault_authority: Account<'info, VaultAuthority>,
}

pub fn handler(ctx: Context<CloseVaultAuthority>) -> Result<()> {
    let lifecycle = LifecycleStatus::from_u8(ctx.accounts.deployment.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;
    // Only allow closing once the deployment has been stopped (or fully closed).
    // This prevents a creator from yanking the vault authority while the
    // deployment is still live and risking dangling fee accumulators.
    require!(
        matches!(lifecycle, LifecycleStatus::Stopped | LifecycleStatus::Closed),
        StrategyRuntimeError::DeploymentNotStopped
    );
    msg!(
        "close_vault_authority deployment={} vault_authority={}",
        ctx.accounts.deployment.key(),
        ctx.accounts.vault_authority.key()
    );
    Ok(())
}
