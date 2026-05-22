use anchor_lang::prelude::*;

#[error_code]
pub enum PythFeedError {
    #[msg("Condition discriminant must be 0 (above), 1 (below) or 2 (equal)")]
    InvalidCondition,
    #[msg("Target price must be greater than zero")]
    InvalidTargetPrice,
    #[msg("Reported price must be greater than zero")]
    InvalidReportedPrice,
    #[msg("Feed has already been triggered — reset before reuse")]
    AlreadyTriggered,
    #[msg("Caller is not the creator of this feed")]
    UnauthorizedCaller,
    #[msg("Reported price is stale (timestamp older than max_staleness_secs)")]
    StalePrice,
}
