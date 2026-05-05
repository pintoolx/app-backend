pub mod close_deployment;
pub mod close_follower_vault;
pub mod close_public_snapshot;
pub mod close_vault_authority;
pub mod collect_fees;
pub mod commit_state;
pub mod commit_state_on_er;
pub mod delegate_strategy_state;
pub mod emergency_pause;
pub mod emergency_resume;
pub mod initialize_deployment;
pub mod initialize_follower_subscription;
pub mod initialize_follower_vault;
pub mod initialize_follower_vault_authority;
pub mod initialize_strategy_state;
pub mod initialize_strategy_version;
pub mod initialize_vault_authority;
pub mod set_follower_vault_status;
pub mod set_keeper;
pub mod set_lifecycle_status;
pub mod set_public_snapshot;

pub use close_deployment::*;
pub use close_follower_vault::*;
pub use close_public_snapshot::*;
pub use close_vault_authority::*;
pub use collect_fees::*;
pub use commit_state::*;
pub use commit_state_on_er::*;
pub use delegate_strategy_state::*;
pub use emergency_pause::*;
pub use emergency_resume::*;
pub use initialize_deployment::*;
pub use initialize_follower_subscription::*;
pub use initialize_follower_vault::*;
pub use initialize_follower_vault_authority::*;
pub use initialize_strategy_state::*;
pub use initialize_strategy_version::*;
pub use initialize_vault_authority::*;
pub use set_follower_vault_status::*;
pub use set_keeper::*;
pub use set_lifecycle_status::*;
pub use set_public_snapshot::*;
// Manual `undelegate_strategy_state` was deleted: the `#[ephemeral]` macro on
// the program module auto-injects `process_undelegation` and the corresponding
// `InitializeAfterUndelegation` accounts struct. No hand-rolled wrapper is
// needed and keeping one risks creating a duplicate IDL discriminator.
