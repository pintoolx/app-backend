use anchor_lang::prelude::*;

use crate::constants::RESERVED_ACCOUNT_BYTES;

/// Follower-vault authority PDA. Seeded by
/// `(FOLLOWER_VAULT_AUTHORITY_SEED, follower_vault)`. Provides a stable
/// authority surface for scoped session-key or delegate execution. Phase-2
/// only persists routing fields; transfer / mint configuration land later.
#[account]
#[derive(Debug)]
pub struct FollowerVaultAuthority {
    pub follower_vault: Pubkey,
    pub follower: Pubkey,
    /// 0 = active, 1 = frozen
    pub status: u8,
    /// Hash over the allowed mint config — empty until configured.
    pub allowed_mint_config_hash: [u8; 32],
    pub bump: u8,
    pub _reserved: [u8; RESERVED_ACCOUNT_BYTES],
}

impl FollowerVaultAuthority {
    pub const SIZE: usize =
        8 +  // discriminator
        32 + // follower_vault
        32 + // follower
        1 +  // status
        32 + // allowed_mint_config_hash
        1 +  // bump
        RESERVED_ACCOUNT_BYTES;
}
