use anchor_lang::prelude::*;

#[error_code]
pub enum StrategyRuntimeError {
    #[msg("Lifecycle status transition is not allowed for the current state")]
    InvalidLifecycleTransition,

    #[msg("Strategy state revision is not the expected next value (replay protection)")]
    StaleRevision,

    #[msg("Public snapshot revision must be strictly greater than the current value")]
    SnapshotNotMonotonic,

    #[msg("Deployment must be in stopped state before it can be closed")]
    DeploymentNotStopped,

    #[msg("Provided authority does not match the deployment creator")]
    UnauthorizedCreator,

    #[msg("Provided execution mode is not recognised")]
    InvalidExecutionMode,

    #[msg("Provided lifecycle status code is not recognised")]
    InvalidLifecycleCode,
}
