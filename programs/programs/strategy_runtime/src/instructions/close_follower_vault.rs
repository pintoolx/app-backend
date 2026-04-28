use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::{
    FollowerVault, FollowerVaultAuthority, FollowerVaultLifecycleStatus, StrategySubscription,
};

#[derive(Accounts)]
pub struct CloseFollowerVault<'info> {
    #[account(mut)]
    pub follower: Signer<'info>,

    #[account(
        mut,
        close = follower,
        constraint = follower_vault.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
        constraint = follower_vault.lifecycle_status == FollowerVaultLifecycleStatus::Closed as u8
            @ StrategyRuntimeError::FollowerVaultNotClosed,
    )]
    pub follower_vault: Account<'info, FollowerVault>,

    #[account(
        mut,
        close = follower,
        constraint = authority.follower_vault == follower_vault.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub authority: Account<'info, FollowerVaultAuthority>,

    #[account(
        mut,
        close = follower,
        constraint = subscription.key() == follower_vault.subscription
            @ StrategyRuntimeError::SubscriptionDeploymentMismatch,
        constraint = subscription.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub subscription: Account<'info, StrategySubscription>,
}

pub fn handler(ctx: Context<CloseFollowerVault>) -> Result<()> {
    msg!(
        "follower_vault closed vault={} subscription={} authority={} follower={}",
        ctx.accounts.follower_vault.key(),
        ctx.accounts.subscription.key(),
        ctx.accounts.authority.key(),
        ctx.accounts.follower.key()
    );
    Ok(())
}
