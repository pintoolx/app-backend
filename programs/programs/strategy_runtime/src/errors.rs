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

    #[msg("Provided custody mode code is not recognised")]
    InvalidCustodyMode,

    #[msg("No fees available to collect from this vault")]
    NoFeesToCollect,

    #[msg("Follower vault must be in closed state before it can be removed")]
    FollowerVaultNotClosed,

    #[msg("Provided follower wallet does not match the recorded subscription")]
    UnauthorizedFollower,

    #[msg("Subscription belongs to a different deployment than the supplied account")]
    SubscriptionDeploymentMismatch,

    #[msg("Delegation buffer owner is not the delegation program")]
    InvalidDelegationBuffer,

    #[msg("Instruction data format is invalid")]
    InvalidInstructionData,
}
