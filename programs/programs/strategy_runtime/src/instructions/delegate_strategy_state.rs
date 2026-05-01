use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::STRATEGY_STATE_SEED;
use crate::errors::StrategyRuntimeError;
use crate::state::StrategyDeployment;

const ER_VALIDATOR: Pubkey = pubkey!("5G2FN3TadN9C1qPrJmqg6fjaB1ZyGD1pEoZoMhwgZyYi");

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

pub fn handler(ctx: Context<DelegateStrategyState>) -> Result<()> {
    let deployment_key = ctx.accounts.deployment.key();

    let seeds: &[&[u8]] = &[
        STRATEGY_STATE_SEED,
        deployment_key.as_ref(),
    ];

    ctx.accounts.delegate_strategy_state(
        &ctx.accounts.creator,
        seeds,
        DelegateConfig {
            commit_frequency_ms: 30_000,
            validator: Some(ER_VALIDATOR),
        },
    )?;

    msg!(
        "strategy_state delegated: deployment={}, validator={}",
        deployment_key,
        ER_VALIDATOR
    );
    Ok(())
}
