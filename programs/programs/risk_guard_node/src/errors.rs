use anchor_lang::prelude::*;

#[error_code]
pub enum RiskGuardError {
    #[msg("Guard is frozen — reset it before reuse")]
    GuardFrozen,
    #[msg("max_allowed_bps must be greater than 0 and at most 10000")]
    InvalidMaxBps,
    #[msg("Caller is not the creator of this guard")]
    UnauthorizedCaller,
}
