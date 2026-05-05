use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::STRATEGY_STATE_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::StrategyDeployment;

/// Hard ceiling on `commit_frequency_ms`. 6 hours is generous; anything
/// larger is almost certainly a unit error.
const MAX_COMMIT_FREQUENCY_MS: u32 = 6 * 60 * 60 * 1000;

#[delegate]
#[derive(Accounts)]
pub struct DelegateStrategyState<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = deployment.creator == creator.key() @ StrategyRuntimeError::UnauthorizedCreator,
    )]
    pub deployment: Account<'info, StrategyDeployment>,

    /// CHECK: PDA to delegate to ER — will be owned by delegation program.
    #[account(mut, del)]
    pub strategy_state: AccountInfo<'info>,
}

/// Delegate `strategy_state` to the supplied Ephemeral Rollups validator.
///
/// Both `validator` and `commit_frequency_ms` are now caller-supplied so the
/// program does not have to be redeployed when the platform rotates ER
/// validators or tunes commit cadence per environment (dev/stage/prod).
///
/// `commit_frequency_ms == 0` falls back to the SDK default.
pub fn handler(
    ctx: Context<DelegateStrategyState>,
    validator: Pubkey,
    commit_frequency_ms: u32,
) -> Result<()> {
    require!(
        validator != Pubkey::default(),
        StrategyRuntimeError::InvalidInstructionData
    );
    require!(
        commit_frequency_ms <= MAX_COMMIT_FREQUENCY_MS,
        StrategyRuntimeError::InvalidInstructionData
    );

    let deployment_key = ctx.accounts.deployment.key();
    let seeds: &[&[u8]] = &[STRATEGY_STATE_SEED, deployment_key.as_ref()];

    ctx.accounts.delegate_strategy_state(
        &ctx.accounts.creator,
        seeds,
        DelegateConfig {
            commit_frequency_ms,
            validator: Some(validator),
        },
    )?;

    msg!(
        "strategy_state delegated: deployment={}, validator={}, commit_frequency_ms={}",
        deployment_key,
        validator,
        commit_frequency_ms
    );
    Ok(())
}
