use anchor_lang::prelude::*;

use crate::constants::RESERVED_ACCOUNT_BYTES;

/// Vault authority PDA — owns custodial assets when treasury_mode requires
/// program-controlled custody. Phase 1 only persists routing fields; transfer
/// instructions land in Phase 2.
#[account]
#[derive(Debug)]
pub struct VaultAuthority {
    pub deployment: Pubkey,
    pub creator: Pubkey,
    /// 0=public_self_custody, 1=program_owned, 2=private_payments_relay
    ///
    /// ⚠️ Asymmetric encoding — this byte mapping is **not** the same as
    /// [`super::FollowerVaultCustodyMode`] (which uses 0=program_owned,
    /// 1=self_custody, 2=private_payments_relay). Off-chain decoders must
    /// keep two separate codecs and never share one. See
    /// `backend/src/onchain/anchor-onchain-adapter.service.ts` and
    /// `2026-05-08-strategy-runtime-spec.md` for the documented split.
    pub custody_mode: u8,
    /// 0=active, 1=frozen
    pub status: u8,
    /// Hash over the allowed mint config — empty until configured.
    pub allowed_mint_config_hash: [u8; 32],
    pub bump: u8,
    pub _reserved: [u8; RESERVED_ACCOUNT_BYTES],
}

impl VaultAuthority {
    pub const SIZE: usize =
        8 +  // discriminator
        32 + // deployment
        32 + // creator
        1 +  // custody_mode
        1 +  // status
        32 + // allowed_mint_config_hash
        1 +  // bump
        RESERVED_ACCOUNT_BYTES;
}
