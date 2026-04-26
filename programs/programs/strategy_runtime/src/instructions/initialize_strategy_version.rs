use anchor_lang::prelude::*;

use crate::constants::STRATEGY_VERSION_SEED;
use crate::state::StrategyVersion;

#[derive(Accounts)]
#[instruction(strategy_id: [u8; 16], version: u32)]
pub struct InitializeStrategyVersion<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = StrategyVersion::SIZE,
        seeds = [STRATEGY_VERSION_SEED, &strategy_id, &version.to_le_bytes()],
        bump,
    )]
    pub strategy_version: Account<'info, StrategyVersion>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeStrategyVersion>,
    strategy_id: [u8; 16],
    version: u32,
    public_metadata_hash: [u8; 32],
    private_definition_commitment: [u8; 32],
) -> Result<()> {
    let clock = Clock::get()?;
    let acc = &mut ctx.accounts.strategy_version;
    acc.creator = ctx.accounts.creator.key();
    acc.strategy_id = strategy_id;
    acc.version = version;
    acc.public_metadata_hash = public_metadata_hash;
    acc.private_definition_commitment = private_definition_commitment;
    acc.registered_slot = clock.slot;
    acc.bump = ctx.bumps.strategy_version;
    acc._reserved = [0u8; crate::constants::RESERVED_ACCOUNT_BYTES];
    msg!(
        "strategy_version registered version={} creator={}",
        version,
        acc.creator
    );
    Ok(())
}
