use anchor_lang::prelude::*;

use crate::constants::RESERVED_ACCOUNT_BYTES;

/// Anchored representation of a published strategy version.
/// Holds the public/private commitment hashes so deployments can prove they
/// reference an immutable revision.
#[account]
#[derive(Debug)]
pub struct StrategyVersion {
    /// Wallet that authored the strategy.
    pub creator: Pubkey,
    /// 16-byte UUID identifying the parent strategy in the off-chain DB.
    pub strategy_id: [u8; 16],
    /// Monotonic version number assigned at publish time.
    pub version: u32,
    /// Hash over the sanitised public metadata (display surface).
    pub public_metadata_hash: [u8; 32],
    /// Commitment over the private definition (full IR).
    pub private_definition_commitment: [u8; 32],
    /// Slot the version was registered on chain.
    pub registered_slot: u64,
    /// PDA bump seed.
    pub bump: u8,
    /// Reserved bytes for forward compatibility.
    pub _reserved: [u8; RESERVED_ACCOUNT_BYTES],
}

impl StrategyVersion {
    pub const SIZE: usize =
        8 +  // discriminator
        32 + // creator
        16 + // strategy_id
        4 +  // version
        32 + // public_metadata_hash
        32 + // private_definition_commitment
        8 +  // registered_slot
        1 +  // bump
        RESERVED_ACCOUNT_BYTES;
}
