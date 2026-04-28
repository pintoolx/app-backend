use anchor_lang::prelude::*;

use crate::constants::RESERVED_ACCOUNT_BYTES;

/// One subscription PDA per `(deployment, follower)` pair. Public anchor for
/// the follower's enrollment in a creator's strategy. Sensitive subscription
/// configuration (max capital, drawdown guard, allocation mode, etc.) stays
/// in the off-chain `strategy_subscriptions` table or in PER-private state;
/// the on-chain account only carries authority and lifecycle facts.
///
/// Lifecycle status mirrors the off-chain enum:
///   0 = pending_funding, 1 = active, 2 = paused, 3 = exiting, 4 = closed
#[account]
#[derive(Debug)]
pub struct StrategySubscription {
    pub deployment: Pubkey,
    pub follower: Pubkey,
    pub follower_vault: Pubkey,
    /// 16-byte UUID mirroring the DB row id so PDAs can be derived without
    /// touching Postgres.
    pub subscription_id: [u8; 16],
    pub lifecycle_status: u8,
    pub created_slot: u64,
    pub bump: u8,
    pub _reserved: [u8; RESERVED_ACCOUNT_BYTES],
}

impl StrategySubscription {
    pub const SIZE: usize =
        8 +  // discriminator
        32 + // deployment
        32 + // follower
        32 + // follower_vault
        16 + // subscription_id
        1 +  // lifecycle_status
        8 +  // created_slot
        1 +  // bump
        RESERVED_ACCOUNT_BYTES;
}

/// Follower-vault lifecycle status as a single byte. Kept in sync with the
/// backend `FollowerVaultLifecycleStatus` union and the `follower_vaults.lifecycle_status`
/// CHECK constraint.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FollowerVaultLifecycleStatus {
    PendingFunding = 0,
    Active = 1,
    Paused = 2,
    Exiting = 3,
    Closed = 4,
}

impl FollowerVaultLifecycleStatus {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::PendingFunding),
            1 => Some(Self::Active),
            2 => Some(Self::Paused),
            3 => Some(Self::Exiting),
            4 => Some(Self::Closed),
            _ => None,
        }
    }
}
