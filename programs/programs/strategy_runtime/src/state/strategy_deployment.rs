use anchor_lang::prelude::*;

use crate::constants::RESERVED_ACCOUNT_BYTES;

/// Anchored deployment record. The DB authoritative `id` is mirrored here as a
/// 16-byte UUID so PDAs can be derived without depending on Postgres.
#[account]
#[derive(Debug)]
pub struct StrategyDeployment {
    pub creator: Pubkey,
    pub strategy_version: Pubkey,
    pub vault_authority: Pubkey,
    pub deployment_id: [u8; 16],
    pub execution_mode: u8,
    pub lifecycle_status: u8,
    pub deployment_nonce: u64,
    pub initialized_slot: u64,
    pub bump: u8,
    pub _reserved: [u8; RESERVED_ACCOUNT_BYTES],
}

impl StrategyDeployment {
    pub const SIZE: usize =
        8 +  // discriminator
        32 + // creator
        32 + // strategy_version
        32 + // vault_authority
        16 + // deployment_id
        1 +  // execution_mode
        1 +  // lifecycle_status
        8 +  // deployment_nonce
        8 +  // initialized_slot
        1 +  // bump
        RESERVED_ACCOUNT_BYTES;
}
