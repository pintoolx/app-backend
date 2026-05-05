use anchor_lang::prelude::*;

/// Reserved tail kept at 64 bytes — `keeper` is carved out of the original
/// reserved region without changing total account size, so accounts already
/// on-chain remain rent-exempt and deserialise identically (the bytes that
/// were `_reserved[0..32]` now decode as `keeper` and default to the
/// all-zero `Pubkey::default()` until `set_keeper` is invoked).
const RESERVED_TAIL_BYTES: usize = 32;

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
    /// Optional keeper signer authorised to commit private state on behalf of
    /// the creator. `Pubkey::default()` means "not configured" — fall back to
    /// the creator. New deployments set this equal to `creator` at init.
    pub keeper: Pubkey,
    pub _reserved: [u8; RESERVED_TAIL_BYTES],
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
        32 + // keeper
        RESERVED_TAIL_BYTES;

    /// Returns true if `signer_key` is authorised to act as keeper for this
    /// deployment (creator is always allowed; keeper is allowed only when
    /// explicitly configured to a non-zero pubkey).
    pub fn is_authorized_keeper(&self, signer_key: &Pubkey) -> bool {
        signer_key == &self.creator
            || (self.keeper != Pubkey::default() && signer_key == &self.keeper)
    }
}
