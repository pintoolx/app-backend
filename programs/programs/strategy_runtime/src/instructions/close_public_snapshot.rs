use anchor_lang::prelude::*;

use crate::constants::PUBLIC_SNAPSHOT_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{PublicSnapshot, StrategyDeployment};

/// Reclaim rent from a [`PublicSnapshot`] PDA after a deployment has been
/// retired. The snapshot is purely informational so the creator may close it
/// at any time (snapshots can be re-created with `set_public_snapshot` if
/// they decide to keep publishing metrics).
#[derive(Accounts)]
pub struct ClosePublicSnapshot<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        mut,
        close = creator,
        seeds = [PUBLIC_SNAPSHOT_SEED, deployment.key().as_ref()],
        bump = public_snapshot.bump,
        constraint = public_snapshot.deployment == deployment.key()
            @ StrategyRuntimeError::SubscriptionDeploymentMismatch,
    )]
    pub public_snapshot: Account<'info, PublicSnapshot>,
}

pub fn handler(ctx: Context<ClosePublicSnapshot>) -> Result<()> {
    msg!(
        "close_public_snapshot deployment={} snapshot={}",
        ctx.accounts.deployment.key(),
        ctx.accounts.public_snapshot.key()
    );
    Ok(())
}
