use anchor_lang::prelude::*;

use crate::errors::StrategyRuntimeError;
use crate::state::{LifecycleStatus, StrategyDeployment, StrategyState};

/// Append a new private-state commitment.
///
/// The `signer` account must be either the deployment's `creator` or its
/// configured `keeper` — this lets the off-chain runner commit on behalf of
/// the creator without holding the creator's keypair.
///
/// `expected_revision` is the **current** on-chain revision the caller has
/// observed. Replay protection succeeds when `expected_revision ==
/// strategy_state.state_revision`; the new revision becomes
/// `expected_revision + 1`.
#[derive(Accounts)]
pub struct CommitState<'info> {
    /// Authorised signer — must be either `deployment.creator` or
    /// `deployment.keeper`. Field name kept as `creator` for IDL backward
    /// compatibility; semantically it accepts any authorised principal.
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.is_authorized_keeper(&creator.key())
            @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    #[account(
        mut,
        constraint = strategy_state.deployment == deployment.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub strategy_state: Account<'info, StrategyState>,
}

pub fn handler(
    ctx: Context<CommitState>,
    expected_revision: u32,
    new_private_state_commitment: [u8; 32],
    last_result_code: u32,
) -> Result<()> {
    let lifecycle = LifecycleStatus::from_u8(ctx.accounts.deployment.lifecycle_status)
        .ok_or(StrategyRuntimeError::InvalidLifecycleCode)?;
    require!(
        matches!(lifecycle, LifecycleStatus::Deployed),
        StrategyRuntimeError::InvalidLifecycleTransition
    );

    let state = &mut ctx.accounts.strategy_state;
    require!(
        expected_revision == state.state_revision,
        StrategyRuntimeError::StaleRevision
    );

    let clock = Clock::get()?;
    state.state_revision = expected_revision
        .checked_add(1)
        .ok_or(StrategyRuntimeError::StaleRevision)?;
    state.private_state_commitment = new_private_state_commitment;
    state.last_result_code = last_result_code;
    state.last_commit_slot = clock.slot;
    msg!(
        "commit_state deployment={} new_revision={} result_code={}",
        ctx.accounts.deployment.key(),
        state.state_revision,
        last_result_code
    );
    Ok(())
}
