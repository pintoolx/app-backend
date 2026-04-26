use anchor_lang::prelude::*;

use crate::constants::RESERVED_ACCOUNT_BYTES;

/// Public snapshot — sanitised view of the deployment for marketplace/leaderboard.
#[account]
#[derive(Debug)]
pub struct PublicSnapshot {
    pub deployment: Pubkey,
    pub snapshot_revision: u32,
    pub published_slot: u64,
    /// 0=running, 1=paused, 2=stopped, 3=closed (mirrors a subset of LifecycleStatus)
    pub status_code: u8,
    /// Risk band code: 0=unknown,1=low,2=medium,3=high
    pub risk_band: u8,
    /// PnL summary in bps (signed, can be negative).
    pub pnl_summary_bps: i32,
    /// Hash over the larger off-chain metrics blob.
    pub public_metrics_hash: [u8; 32],
    pub bump: u8,
    pub _reserved: [u8; RESERVED_ACCOUNT_BYTES],
}

impl PublicSnapshot {
    pub const SIZE: usize =
        8 +  // discriminator
        32 + // deployment
        4 +  // snapshot_revision
        8 +  // published_slot
        1 +  // status_code
        1 +  // risk_band
        4 +  // pnl_summary_bps
        32 + // public_metrics_hash
        1 +  // bump
        RESERVED_ACCOUNT_BYTES;
}
