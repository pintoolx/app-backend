use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::errors::StrategyRuntimeError;
use crate::state::{LifecycleStatus, StrategyDeployment, StrategyState};

/// Commit a private-state revision **inside an Ephemeral Rollups session** and
/// snapshot it back to the base layer in the same transaction via the
/// `MagicIntentBundleBuilder` CPI.
///
/// The `signer` account must be either the deployment's `creator` or its
/// configured `keeper` (see [`StrategyDeployment::is_authorized_keeper`]).
/// Field name is kept as `creator` for IDL backward compatibility.
///
/// `expected_revision` is the current revision; the new revision is
/// `expected_revision + 1`.
#[commit]
#[derive(Accounts)]
pub struct CommitStateOnEr<'info> {
    #[account(mut)]
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
    // magic_program and magic_context injected by #[commit] macro
}

pub fn handler(
    ctx: Context<CommitStateOnEr>,
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

    // Mutate the strategy_state inside an inner block so the &mut borrow
    // ends *before* we hand AccountInfo over to the Magic Program CPI.
    // Calling Account::exit() persists the new bytes; otherwise the CPI
    // would observe the pre-mutation snapshot.
    let new_revision = {
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

        let revision = state.state_revision;
        state.exit(&crate::ID)?;
        revision
    };

    // Commit the updated strategy_state back to the base layer via Magic Program CPI.
    MagicIntentBundleBuilder::new(
        ctx.accounts.creator.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit(&[ctx.accounts.strategy_state.to_account_info()])
    .build_and_invoke()?;

    msg!(
        "commit_state_on_er deployment={} new_revision={} result_code={}",
        ctx.accounts.deployment.key(),
        new_revision,
        last_result_code
    );
    Ok(())
}
