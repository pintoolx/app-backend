use anchor_lang::prelude::*;

use crate::constants::GUARD_SEED;
use crate::errors::RiskGuardError;
use crate::state::GuardState;

#[derive(Accounts)]
pub struct InitializeGuard<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = GuardState::SIZE,
        seeds = [GUARD_SEED, creator.key().as_ref()],
        bump,
    )]
    pub guard: Account<'info, GuardState>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeGuard>, max_allowed_bps: u16) -> Result<()> {
    require!(
        max_allowed_bps > 0 && max_allowed_bps <= 10_000,
        RiskGuardError::InvalidMaxBps
    );
    let g = &mut ctx.accounts.guard;
    g.creator = ctx.accounts.creator.key();
    g.max_allowed_bps = max_allowed_bps;
    g.last_drawdown_bps = 0;
    g.frozen = false;
    g.bump = ctx.bumps.guard;
    g._reserved = [0; 24];
    msg!(
        "risk_guard initialized: creator={} max={}bps",
        g.creator,
        g.max_allowed_bps
    );
    Ok(())
}
