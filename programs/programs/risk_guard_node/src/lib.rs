use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Placeholder ID — replaced by `anchor keys sync` after first build.
declare_id!("4JKazw3boeciANsXNDPk8eko2Q6RGBRNaDvUvShtodAQ");

#[program]
pub mod risk_guard_node {
    use super::*;

    /// Initialize a per-creator drawdown guard.
    /// `max_allowed_bps` is the threshold beyond which the guard freezes.
    pub fn initialize_guard(ctx: Context<InitializeGuard>, max_allowed_bps: u16) -> Result<()> {
        instructions::initialize_guard::handler(ctx, max_allowed_bps)
    }

    /// Submit a current drawdown reading. If it exceeds `max_allowed_bps`,
    /// the guard freezes and all subsequent calls fail until `reset_guard`.
    pub fn check_drawdown(ctx: Context<CheckDrawdown>, current_drawdown_bps: u16) -> Result<()> {
        instructions::check_drawdown::handler(ctx, current_drawdown_bps)
    }

    /// Creator-only — clear the frozen flag.
    pub fn reset_guard(ctx: Context<ResetGuard>) -> Result<()> {
        instructions::reset_guard::handler(ctx)
    }
}
