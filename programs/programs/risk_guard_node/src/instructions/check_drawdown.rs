use anchor_lang::prelude::*;

use crate::errors::RiskGuardError;
use crate::state::GuardState;

#[derive(Accounts)]
pub struct CheckDrawdown<'info> {
    /// Anyone can submit a drawdown reading — the guard is keyed by creator
    /// and we trust whoever signs to be reporting on the right strategy.
    pub caller: Signer<'info>,

    #[account(mut)]
    pub guard: Account<'info, GuardState>,
}

pub fn handler(ctx: Context<CheckDrawdown>, current_drawdown_bps: u16) -> Result<()> {
    let g = &mut ctx.accounts.guard;
    require!(!g.frozen, RiskGuardError::GuardFrozen);
    g.last_drawdown_bps = current_drawdown_bps;
    if current_drawdown_bps > g.max_allowed_bps {
        g.frozen = true;
        msg!(
            "risk_guard tripped: current={}bps > max={}bps",
            current_drawdown_bps,
            g.max_allowed_bps
        );
    }
    Ok(())
}
