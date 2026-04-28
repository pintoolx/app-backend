pub mod follower_vault;
pub mod follower_vault_authority;
pub mod public_snapshot;
pub mod strategy_deployment;
pub mod strategy_state;
pub mod strategy_subscription;
pub mod strategy_version;
pub mod vault_authority;

pub use follower_vault::*;
pub use follower_vault_authority::*;
pub use public_snapshot::*;
pub use strategy_deployment::*;
pub use strategy_state::*;
pub use strategy_subscription::*;
pub use strategy_version::*;
pub use vault_authority::*;

/// Lifecycle status as a single byte (kept in sync with the backend port enum).
/// 0=draft, 1=deployed, 2=paused, 3=stopped, 4=closed.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LifecycleStatus {
    Draft = 0,
    Deployed = 1,
    Paused = 2,
    Stopped = 3,
    Closed = 4,
}

impl LifecycleStatus {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Draft),
            1 => Some(Self::Deployed),
            2 => Some(Self::Paused),
            3 => Some(Self::Stopped),
            4 => Some(Self::Closed),
            _ => None,
        }
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        match (self, next) {
            (Self::Draft, Self::Deployed) => true,
            (Self::Deployed, Self::Paused) => true,
            (Self::Deployed, Self::Stopped) => true,
            (Self::Paused, Self::Deployed) => true,
            (Self::Paused, Self::Stopped) => true,
            (Self::Stopped, Self::Closed) => true,
            _ => false,
        }
    }
}

/// Execution mode marker matching the backend `DeploymentExecutionMode`.
/// 0=offchain, 1=er, 2=per.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ExecutionMode {
    Offchain = 0,
    Er = 1,
    Per = 2,
}

impl ExecutionMode {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Offchain),
            1 => Some(Self::Er),
            2 => Some(Self::Per),
            _ => None,
        }
    }
}
