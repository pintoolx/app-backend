//! Compile-time constants used across the strategy runtime program.

/// PDA seed prefixes (single source of truth shared with the backend pda.ts helper).
pub const STRATEGY_VERSION_SEED: &[u8] = b"strategy_version";
pub const STRATEGY_DEPLOYMENT_SEED: &[u8] = b"strategy_deployment";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const STRATEGY_STATE_SEED: &[u8] = b"strategy_state";
pub const PUBLIC_SNAPSHOT_SEED: &[u8] = b"public_snapshot";

/// Reserved bytes appended to every account so we can grow without a migration.
pub const RESERVED_ACCOUNT_BYTES: usize = 64;
