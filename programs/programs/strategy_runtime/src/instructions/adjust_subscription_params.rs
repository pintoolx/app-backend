use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::{FollowerVaultLifecycleStatus, StrategySubscription};

/// Subscriber updates their per-subscription configuration commitment
/// (position size, risk band, allocation mode, etc.). Off-chain holds the
/// cleartext params; on-chain stores only the hash so keepers can verify the
/// params they execute against match what the subscriber signed.
///
/// `expected_revision` must equal the current `params_revision` for replay
/// protection. The new revision becomes `expected_revision + 1`.
#[derive(Accounts)]
pub struct AdjustSubscriptionParams<'info> {
    pub follower: Signer<'info>,

    #[account(
        mut,
        constraint = subscription.follower == follower.key() @ StrategyRuntimeError::UnauthorizedFollower,
    )]
    pub subscription: Account<'info, StrategySubscription>,
}

pub fn handler(
    ctx: Context<AdjustSubscriptionParams>,
    expected_revision: u64,
    new_config_commitment: [u8; 32],
) -> Result<()> {
    let current = FollowerVaultLifecycleStatus::from_u8(ctx.accounts.subscription.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;

    // Allow adjustments while the subscription is funded and operational.
    // Reject pending_funding (no funds to apply against), exiting, or closed.
    require!(
        matches!(
            current,
            FollowerVaultLifecycleStatus::Active | FollowerVaultLifecycleStatus::Paused
        ),
        StrategyRuntimeError::InvalidLifecycleTransition
    );

    let sub = &mut ctx.accounts.subscription;
    require!(
        expected_revision == sub.params_revision,
        StrategyRuntimeError::StaleRevision
    );

    sub.params_revision = expected_revision
        .checked_add(1)
        .ok_or(StrategyRuntimeError::StaleRevision)?;
    sub.config_commitment = new_config_commitment;

    msg!(
        "adjust_subscription_params subscription={} new_revision={}",
        sub.key(),
        sub.params_revision
    );
    Ok(())
}
