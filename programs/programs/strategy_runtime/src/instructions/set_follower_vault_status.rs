use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::{FollowerVault, FollowerVaultLifecycleStatus, StrategySubscription};

/// Apply a lifecycle transition to a follower vault. Mirrors the off-chain
/// state machine in `SubscriptionsService.transitionStatus`.
///
/// Allowed transitions:
///   pending_funding -> active | closed
///   active          -> paused | exiting
///   paused          -> active | exiting
///   exiting         -> closed
#[derive(Accounts)]
#[instruction(new_status: u8)]
pub struct SetFollowerVaultStatus<'info> {
    #[account(mut)]
    pub follower: Signer<'info>,

    #[account(
        mut,
        constraint = follower_vault.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub follower_vault: Account<'info, FollowerVault>,

    #[account(
        mut,
        constraint = subscription.key() == follower_vault.subscription
            @ StrategyRuntimeError::SubscriptionDeploymentMismatch,
        constraint = subscription.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub subscription: Account<'info, StrategySubscription>,
}

pub fn handler(ctx: Context<SetFollowerVaultStatus>, new_status: u8) -> Result<()> {
    let target = FollowerVaultLifecycleStatus::from_u8(new_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;
    let current = FollowerVaultLifecycleStatus::from_u8(ctx.accounts.follower_vault.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;

    if !can_transition(current, target) {
        return err!(StrategyRuntimeError::InvalidLifecycleTransition);
    }

    ctx.accounts.follower_vault.lifecycle_status = new_status;
    ctx.accounts.subscription.lifecycle_status = new_status;

    msg!(
        "follower_vault status vault={} {:?} -> {:?}",
        ctx.accounts.follower_vault.key(),
        current,
        target
    );
    Ok(())
}

fn can_transition(
    current: FollowerVaultLifecycleStatus,
    target: FollowerVaultLifecycleStatus,
) -> bool {
    use FollowerVaultLifecycleStatus::*;
    matches!(
        (current, target),
        (PendingFunding, Active)
            | (PendingFunding, Closed)
            | (Active, Paused)
            | (Active, Exiting)
            | (Paused, Active)
            | (Paused, Exiting)
            | (Exiting, Closed),
    )
}
