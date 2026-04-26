use anchor_lang::prelude::*;

use crate::constants::PUBLIC_SNAPSHOT_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::{PublicSnapshot, StrategyDeployment};

#[derive(Accounts)]
pub struct SetPublicSnapshot<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        init_if_needed,
        payer = creator,
        space = PublicSnapshot::SIZE,
        seeds = [PUBLIC_SNAPSHOT_SEED, deployment.key().as_ref()],
        bump,
    )]
    pub public_snapshot: Account<'info, PublicSnapshot>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SetPublicSnapshot>,
    expected_snapshot_revision: u32,
    status_code: u8,
    risk_band: u8,
    pnl_summary_bps: i32,
    public_metrics_hash: [u8; 32],
) -> Result<()> {
    let snap = &mut ctx.accounts.public_snapshot;

    if snap.deployment == Pubkey::default() {
        snap.deployment = ctx.accounts.deployment.key();
        snap.bump = ctx.bumps.public_snapshot;
        snap._reserved = [0u8; crate::constants::RESERVED_ACCOUNT_BYTES];
    } else {
        require!(
            snap.deployment == ctx.accounts.deployment.key(),
            StrategyRuntimeError::UnauthorizedCreator
        );
    }

    require!(
        expected_snapshot_revision > snap.snapshot_revision,
        StrategyRuntimeError::SnapshotNotMonotonic
    );

    let clock = Clock::get()?;
    snap.snapshot_revision = expected_snapshot_revision;
    snap.published_slot = clock.slot;
    snap.status_code = status_code;
    snap.risk_band = risk_band;
    snap.pnl_summary_bps = pnl_summary_bps;
    snap.public_metrics_hash = public_metrics_hash;
    msg!(
        "set_public_snapshot deployment={} revision={} status={}",
        ctx.accounts.deployment.key(),
        snap.snapshot_revision,
        status_code
    );
    Ok(())
}
