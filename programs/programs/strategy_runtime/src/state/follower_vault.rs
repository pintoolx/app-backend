use anchor_lang::prelude::*;

use crate::constants::RESERVED_ACCOUNT_BYTES;

/// Follower vault PDA. Seeded by `(FOLLOWER_VAULT_SEED, subscription)`. Public
/// control shell for the follower's funds; treasury balances live in Umbra
/// and execution state lives in PER. The on-chain row only holds authority
/// and lifecycle metadata.
#[account]
#[derive(Debug)]
pub struct FollowerVault {
    pub subscription: Pubkey,
    pub deployment: Pubkey,
    pub follower: Pubkey,
    pub authority: Pubkey,
    /// 16-byte UUID mirroring the off-chain `follower_vaults.id`.
    pub vault_id: [u8; 16],
    /// 0 = pending_funding, 1 = active, 2 = paused, 3 = exiting, 4 = closed
    pub lifecycle_status: u8,
    /// 0 = program_owned, 1 = self_custody, 2 = private_payments_relay
    pub custody_mode: u8,
    pub created_slot: u64,
    pub bump: u8,
    pub _reserved: [u8; RESERVED_ACCOUNT_BYTES],
}

impl FollowerVault {
    pub const SIZE: usize =
        8 +  // discriminator
        32 + // subscription
        32 + // deployment
        32 + // follower
        32 + // authority
        16 + // vault_id
        1 +  // lifecycle_status
        1 +  // custody_mode
        8 +  // created_slot
        1 +  // bump
        RESERVED_ACCOUNT_BYTES;
}

/// Custody mode mirrors the off-chain `follower_vaults.custody_mode` enum.
///
/// ⚠️ Asymmetric encoding — this byte mapping is **not** the same as
/// [`super::VaultAuthority`]'s `custody_mode` field, which encodes
/// 0=public_self_custody, 1=program_owned, 2=private_payments_relay.
/// Off-chain decoders must keep two separate codecs and never share one.
/// See `backend/src/onchain/anchor-onchain-adapter.service.ts` and
/// `2026-05-08-strategy-runtime-spec.md` for the documented split.
///
/// `PrivatePaymentsRelay = 2` is currently dead — the backend stopped
/// writing it after the PP adapter was removed. Kept on-chain so re-adding
/// PP doesn't require a program redeploy.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FollowerVaultCustodyMode {
    ProgramOwned = 0,
    SelfCustody = 1,
    PrivatePaymentsRelay = 2,
}

impl FollowerVaultCustodyMode {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::ProgramOwned),
            1 => Some(Self::SelfCustody),
            2 => Some(Self::PrivatePaymentsRelay),
            _ => None,
        }
    }
}
