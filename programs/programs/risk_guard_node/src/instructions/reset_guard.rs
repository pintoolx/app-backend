use anchor_lang::prelude::*;

use crate::errors::RiskGuardError;
use crate::state::GuardState;

#[derive(Accounts)]
pub struct ResetGuard<'info> {
    pub creator: Signer<'info>,

    #[account(
        mut,
        has_one = creator @ RiskGuardError::UnauthorizedCaller,
    )]
    pub guard: Account<'info, GuardState>,
}

pub fn handler(ctx: Context<ResetGuard>) -> Result<()> {
    let g = &mut ctx.accounts.guard;
    g.frozen = false;
    g.last_drawdown_bps = 0;
    msg!("risk_guard reset by creator={}", g.creator);
    Ok(())
}
