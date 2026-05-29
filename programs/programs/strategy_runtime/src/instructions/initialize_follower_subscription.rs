use anchor_lang::prelude::*;

use crate::constants::STRATEGY_SUBSCRIPTION_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{
    FollowerVaultLifecycleStatus, LifecycleStatus, StrategyDeployment, StrategySubscription,
};

/// Enrol the signing wallet as a follower of the supplied deployment. The
/// follower self-signs because subscriptions are public discovery actions —
/// the creator does not need to gate which wallet may subscribe at this layer
/// (off-chain visibility presets and PER permission groups are the access
/// control plane).
#[derive(Accounts)]
#[instruction(subscription_id: [u8; 16])]
pub struct InitializeFollowerSubscription<'info> {
    #[account(mut)]
    pub follower: Signer<'info>,

    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        init,
        payer = follower,
        space = StrategySubscription::SIZE,
        seeds = [
            STRATEGY_SUBSCRIPTION_SEED,
            deployment.key().as_ref(),
            follower.key().as_ref(),
        ],
        bump,
    )]
    pub subscription: Account<'info, StrategySubscription>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeFollowerSubscription>,
    subscription_id: [u8; 16],
) -> Result<()> {
    // Reject subscriptions to deployments that are not ready to take followers.
    // `Deployed` and `Paused` are both acceptable: paused is a temporary creator
    // intervention and we still want followers to enrol so they get notified
    // when the strategy resumes.
    let deployment_status =
        LifecycleStatus::from_u8(ctx.accounts.deployment.lifecycle_status)
            .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;
    require!(
        matches!(
            deployment_status,
            LifecycleStatus::Deployed | LifecycleStatus::Paused
        ),
        StrategyRuntimeError::InvalidLifecycleTransition
    );

    let clock = Clock::get()?;

    let acc = &mut ctx.accounts.subscription;
    acc.deployment = ctx.accounts.deployment.key();
    acc.follower = ctx.accounts.follower.key();
    acc.follower_vault = Pubkey::default();
    acc.subscription_id = subscription_id;
    acc.lifecycle_status = FollowerVaultLifecycleStatus::PendingFunding as u8;
    acc.created_slot = clock.slot;
    acc.bump = ctx.bumps.subscription;
    acc.config_commitment = [0u8; 32];
    acc.params_revision = 0;
    acc._reserved = [0u8; 24];

    msg!(
        "subscription initialized id={:?} deployment={} follower={}",
        subscription_id,
        acc.deployment,
        acc.follower
    );
    Ok(())
}
