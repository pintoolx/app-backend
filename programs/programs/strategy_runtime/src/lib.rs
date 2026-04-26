use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF");

#[program]
pub mod strategy_runtime {
    use super::*;

    /// Phase 1 — register an immutable strategy version with hashes.
    pub fn initialize_strategy_version(
        ctx: Context<InitializeStrategyVersion>,
        strategy_id: [u8; 16],
        version: u32,
        public_metadata_hash: [u8; 32],
        private_definition_commitment: [u8; 32],
    ) -> Result<()> {
        instructions::initialize_strategy_version::handler(
            ctx,
            strategy_id,
            version,
            public_metadata_hash,
            private_definition_commitment,
        )
    }

    /// Phase 1 — bind a deployment record (DB UUID -> on-chain account) to
    /// a published strategy version. Lifecycle starts at draft.
    pub fn initialize_deployment(
        ctx: Context<InitializeDeployment>,
        deployment_id: [u8; 16],
        execution_mode: u8,
        deployment_nonce: u64,
    ) -> Result<()> {
        instructions::initialize_deployment::handler(
            ctx,
            deployment_id,
            execution_mode,
            deployment_nonce,
        )
    }

    /// Phase 1 — register a vault authority PDA owned by the deployment.
    pub fn initialize_vault_authority(
        ctx: Context<InitializeVaultAuthority>,
        custody_mode: u8,
    ) -> Result<()> {
        instructions::initialize_vault_authority::handler(ctx, custody_mode)
    }

    /// Phase 1 — initialise the private state pointer with revision = 0.
    pub fn initialize_strategy_state(ctx: Context<InitializeStrategyState>) -> Result<()> {
        instructions::initialize_strategy_state::handler(ctx)
    }

    /// Phase 1 — apply a lifecycle transition (state machine enforced).
    pub fn set_lifecycle_status(ctx: Context<SetLifecycleStatus>, new_status: u8) -> Result<()> {
        instructions::set_lifecycle_status::handler(ctx, new_status)
    }

    /// Phase 1 — append a new private state commitment with replay protection.
    pub fn commit_state(
        ctx: Context<CommitState>,
        expected_revision: u32,
        new_private_state_commitment: [u8; 32],
        last_result_code: u32,
    ) -> Result<()> {
        instructions::commit_state::handler(
            ctx,
            expected_revision,
            new_private_state_commitment,
            last_result_code,
        )
    }

    /// Phase 1 — publish/update the public snapshot (monotonic revision).
    pub fn set_public_snapshot(
        ctx: Context<SetPublicSnapshot>,
        expected_snapshot_revision: u32,
        status_code: u8,
        risk_band: u8,
        pnl_summary_bps: i32,
        public_metrics_hash: [u8; 32],
    ) -> Result<()> {
        instructions::set_public_snapshot::handler(
            ctx,
            expected_snapshot_revision,
            status_code,
            risk_band,
            pnl_summary_bps,
            public_metrics_hash,
        )
    }

    /// Phase 1 — close a stopped deployment, returning rent to the creator.
    pub fn close_deployment(ctx: Context<CloseDeployment>) -> Result<()> {
        instructions::close_deployment::handler(ctx)
    }
}
