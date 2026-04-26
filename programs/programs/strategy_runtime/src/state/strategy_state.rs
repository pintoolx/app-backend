use anchor_lang::prelude::*;

use crate::constants::RESERVED_ACCOUNT_BYTES;

/// Private state pointer — holds the latest commitment and a monotonic
/// revision so off-chain runs (or the ER session) can append-only update.
#[account]
#[derive(Debug)]
pub struct StrategyState {
    pub deployment: Pubkey,
    pub lifecycle_status: u8,
    pub state_revision: u32,
    pub private_state_commitment: [u8; 32],
    pub last_result_code: u32,
    pub last_commit_slot: u64,
    pub bump: u8,
    pub _reserved: [u8; RESERVED_ACCOUNT_BYTES],
}

impl StrategyState {
    pub const SIZE: usize =
        8 +  // discriminator
        32 + // deployment
        1 +  // lifecycle_status
        4 +  // state_revision
        32 + // private_state_commitment
        4 +  // last_result_code
        8 +  // last_commit_slot
        1 +  // bump
        RESERVED_ACCOUNT_BYTES;
}
