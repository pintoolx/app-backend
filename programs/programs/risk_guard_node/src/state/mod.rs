use anchor_lang::prelude::*;

/// Per-creator drawdown guard. One PDA per (program, creator).
///
/// `frozen` flips to true the first time `check_drawdown` observes a value
/// exceeding `max_allowed_bps`. While frozen, all subsequent
/// `check_drawdown` calls fail until `reset_guard` is invoked by the
/// `creator`.
#[account]
pub struct GuardState {
    pub creator: Pubkey,
    pub max_allowed_bps: u16,
    pub last_drawdown_bps: u16,
    pub frozen: bool,
    pub bump: u8,
    /// Reserved for future fields without re-deriving accounts.
    pub _reserved: [u8; 24],
}

impl GuardState {
    /// 8 (Anchor discriminator) + 32 + 2 + 2 + 1 + 1 + 24 = 70 bytes.
    pub const SIZE: usize = 8 + 32 + 2 + 2 + 1 + 1 + 24;
}
