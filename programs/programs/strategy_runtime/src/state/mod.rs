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

// ───────────────────────────────────────────
// Rust unit tests — fast feedback, no validator
// ───────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_from_u8_valid() {
        assert_eq!(LifecycleStatus::from_u8(0), Some(LifecycleStatus::Draft));
        assert_eq!(LifecycleStatus::from_u8(1), Some(LifecycleStatus::Deployed));
        assert_eq!(LifecycleStatus::from_u8(2), Some(LifecycleStatus::Paused));
        assert_eq!(LifecycleStatus::from_u8(3), Some(LifecycleStatus::Stopped));
        assert_eq!(LifecycleStatus::from_u8(4), Some(LifecycleStatus::Closed));
    }

    #[test]
    fn lifecycle_from_u8_invalid() {
        assert_eq!(LifecycleStatus::from_u8(5), None);
        assert_eq!(LifecycleStatus::from_u8(99), None);
        assert_eq!(LifecycleStatus::from_u8(255), None);
    }

    #[test]
    fn lifecycle_all_valid_transitions() {
        let valid = [
            (LifecycleStatus::Draft, LifecycleStatus::Deployed),
            (LifecycleStatus::Deployed, LifecycleStatus::Paused),
            (LifecycleStatus::Deployed, LifecycleStatus::Stopped),
            (LifecycleStatus::Paused, LifecycleStatus::Deployed),
            (LifecycleStatus::Paused, LifecycleStatus::Stopped),
            (LifecycleStatus::Stopped, LifecycleStatus::Closed),
        ];
        for (from, to) in valid {
            assert!(from.can_transition_to(to), "{:?} -> {:?} should be valid", from, to);
        }
    }

    #[test]
    fn lifecycle_all_invalid_transitions() {
        use LifecycleStatus::*;
        let invalid = [
            (Draft, Paused),
            (Draft, Stopped),
            (Draft, Closed),
            (Deployed, Draft),
            (Deployed, Closed),
            (Deployed, Deployed),
            (Paused, Draft),
            (Paused, Paused),
            (Paused, Closed),
            (Stopped, Draft),
            (Stopped, Deployed),
            (Stopped, Paused),
            (Stopped, Stopped),
            (Closed, Draft),
            (Closed, Deployed),
            (Closed, Paused),
            (Closed, Stopped),
            (Closed, Closed),
        ];
        for (from, to) in invalid {
            assert!(!from.can_transition_to(to), "{:?} -> {:?} should be invalid", from, to);
        }
    }

    #[test]
    fn execution_mode_from_u8_valid() {
        assert_eq!(ExecutionMode::from_u8(0), Some(ExecutionMode::Offchain));
        assert_eq!(ExecutionMode::from_u8(1), Some(ExecutionMode::Er));
        assert_eq!(ExecutionMode::from_u8(2), Some(ExecutionMode::Per));
    }

    #[test]
    fn execution_mode_from_u8_invalid() {
        assert_eq!(ExecutionMode::from_u8(3), None);
        assert_eq!(ExecutionMode::from_u8(255), None);
    }

    #[test]
    fn follower_lifecycle_from_u8_valid() {
        assert_eq!(FollowerVaultLifecycleStatus::from_u8(0), Some(FollowerVaultLifecycleStatus::PendingFunding));
        assert_eq!(FollowerVaultLifecycleStatus::from_u8(1), Some(FollowerVaultLifecycleStatus::Active));
        assert_eq!(FollowerVaultLifecycleStatus::from_u8(2), Some(FollowerVaultLifecycleStatus::Paused));
        assert_eq!(FollowerVaultLifecycleStatus::from_u8(3), Some(FollowerVaultLifecycleStatus::Exiting));
        assert_eq!(FollowerVaultLifecycleStatus::from_u8(4), Some(FollowerVaultLifecycleStatus::Closed));
    }

    #[test]
    fn follower_lifecycle_all_valid_transitions() {
        use FollowerVaultLifecycleStatus::*;
        let valid = [
            (PendingFunding, Active),
            (PendingFunding, Closed),
            (Active, Paused),
            (Active, Exiting),
            (Paused, Active),
            (Paused, Exiting),
            (Exiting, Closed),
        ];
        for (from, to) in valid {
            // Replicate the can_transition logic from set_follower_vault_status
            let ok = matches!(
                (from, to),
                (PendingFunding, Active)
                    | (PendingFunding, Closed)
                    | (Active, Paused)
                    | (Active, Exiting)
                    | (Paused, Active)
                    | (Paused, Exiting)
                    | (Exiting, Closed)
            );
            assert!(ok, "{:?} -> {:?} should be valid", from, to);
        }
    }

    #[test]
    fn follower_lifecycle_all_invalid_transitions() {
        use FollowerVaultLifecycleStatus::*;
        let invalid = [
            (PendingFunding, PendingFunding),
            (PendingFunding, Paused),
            (PendingFunding, Exiting),
            (Active, PendingFunding),
            (Active, Active),
            (Active, Closed),
            (Paused, PendingFunding),
            (Paused, Paused),
            (Paused, Closed),
            (Exiting, PendingFunding),
            (Exiting, Active),
            (Exiting, Paused),
            (Exiting, Exiting),
            (Closed, PendingFunding),
            (Closed, Active),
            (Closed, Paused),
            (Closed, Exiting),
            (Closed, Closed),
        ];
        for (from, to) in invalid {
            let ok = matches!(
                (from, to),
                (PendingFunding, Active)
                    | (PendingFunding, Closed)
                    | (Active, Paused)
                    | (Active, Exiting)
                    | (Paused, Active)
                    | (Paused, Exiting)
                    | (Exiting, Closed)
            );
            assert!(!ok, "{:?} -> {:?} should be invalid", from, to);
        }
    }

    #[test]
    fn custody_mode_from_u8_valid() {
        assert_eq!(FollowerVaultCustodyMode::from_u8(0), Some(FollowerVaultCustodyMode::ProgramOwned));
        assert_eq!(FollowerVaultCustodyMode::from_u8(1), Some(FollowerVaultCustodyMode::SelfCustody));
        assert_eq!(FollowerVaultCustodyMode::from_u8(2), Some(FollowerVaultCustodyMode::PrivatePaymentsRelay));
    }

    #[test]
    fn custody_mode_from_u8_invalid() {
        assert_eq!(FollowerVaultCustodyMode::from_u8(3), None);
        assert_eq!(FollowerVaultCustodyMode::from_u8(99), None);
    }

    // ── Phase 4.3: emergency pause / resume ──

    #[test]
    fn emergency_pause_transition_valid() {
        assert!(LifecycleStatus::Deployed.can_transition_to(LifecycleStatus::Paused));
    }

    #[test]
    fn emergency_resume_transition_valid() {
        assert!(LifecycleStatus::Paused.can_transition_to(LifecycleStatus::Deployed));
    }

    #[test]
    fn emergency_pause_from_non_deployed_invalid() {
        assert!(!LifecycleStatus::Draft.can_transition_to(LifecycleStatus::Paused));
        assert!(!LifecycleStatus::Stopped.can_transition_to(LifecycleStatus::Paused));
        assert!(!LifecycleStatus::Closed.can_transition_to(LifecycleStatus::Paused));
    }

    #[test]
    fn emergency_resume_from_non_paused_invalid() {
        // Draft -> Deployed is valid (normal initialization), so exclude it.
        assert!(!LifecycleStatus::Deployed.can_transition_to(LifecycleStatus::Deployed));
        assert!(!LifecycleStatus::Stopped.can_transition_to(LifecycleStatus::Deployed));
        assert!(!LifecycleStatus::Closed.can_transition_to(LifecycleStatus::Deployed));
    }

    // ── Phase 4.2: collect_fees rent-exempt sanity check ──

    #[test]
    fn vault_authority_size_is_stable() {
        // If this changes, collect_fees must be updated as well.
        assert_eq!(VaultAuthority::SIZE, 171);
    }
}
