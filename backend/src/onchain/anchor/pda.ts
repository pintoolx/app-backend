import { PublicKey } from '@solana/web3.js';

export const STRATEGY_VERSION_SEED = Buffer.from('strategy_version');
export const STRATEGY_DEPLOYMENT_SEED = Buffer.from('strategy_deployment');
export const VAULT_AUTHORITY_SEED = Buffer.from('vault_authority');
export const STRATEGY_STATE_SEED = Buffer.from('strategy_state');
export const PUBLIC_SNAPSHOT_SEED = Buffer.from('public_snapshot');

// Phase-2 follower-vault seeds. These mirror programs/programs/strategy_runtime/src/constants.rs:12-14.
export const STRATEGY_SUBSCRIPTION_SEED = Buffer.from('strategy_subscription');
export const FOLLOWER_VAULT_SEED = Buffer.from('follower_vault');
export const FOLLOWER_VAULT_AUTHORITY_SEED = Buffer.from('follower_vault_authority');

/** Convert a 36-char UUID string to its 16-byte Buffer representation. */
export function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID for PDA seed: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}

function u32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

export function deriveStrategyVersionPda(
  programId: PublicKey,
  strategyId: string,
  version: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STRATEGY_VERSION_SEED, uuidToBytes(strategyId), u32LE(version)],
    programId,
  );
}

export function deriveDeploymentPda(
  programId: PublicKey,
  deploymentId: string,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STRATEGY_DEPLOYMENT_SEED, uuidToBytes(deploymentId)],
    programId,
  );
}

export function deriveVaultAuthorityPda(
  programId: PublicKey,
  deploymentPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, deploymentPda.toBuffer()],
    programId,
  );
}

export function deriveStrategyStatePda(
  programId: PublicKey,
  deploymentPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STRATEGY_STATE_SEED, deploymentPda.toBuffer()],
    programId,
  );
}

export function derivePublicSnapshotPda(
  programId: PublicKey,
  deploymentPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PUBLIC_SNAPSHOT_SEED, deploymentPda.toBuffer()],
    programId,
  );
}

/**
 * Derive the StrategySubscription PDA bound to (deployment, follower).
 * Mirrors the on-chain seed in initialize_follower_subscription.rs:23-27 and
 * the IDL seeds at strategy_runtime.json:240-277.
 */
export function deriveSubscriptionPda(
  programId: PublicKey,
  deploymentPda: PublicKey,
  followerWallet: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STRATEGY_SUBSCRIPTION_SEED, deploymentPda.toBuffer(), followerWallet.toBuffer()],
    programId,
  );
}

/**
 * Derive the FollowerVault PDA for a subscription. Matches
 * initialize_follower_vault.rs:25 — one vault per subscription.
 */
export function deriveFollowerVaultPda(
  programId: PublicKey,
  subscriptionPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FOLLOWER_VAULT_SEED, subscriptionPda.toBuffer()],
    programId,
  );
}

/**
 * Derive the FollowerVaultAuthority PDA for a follower vault. Matches
 * initialize_follower_vault_authority.rs:22.
 */
export function deriveFollowerVaultAuthorityPda(
  programId: PublicKey,
  followerVaultPda: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FOLLOWER_VAULT_AUTHORITY_SEED, followerVaultPda.toBuffer()],
    programId,
  );
}

/** Convert a 0x-prefixed or bare 64-char hex string to a 32-byte number array. */
export function hexTo32ByteArray(hex: string): number[] {
  const trimmed = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(`Expected 32-byte hex string, got: ${hex}`);
  }
  return Array.from(Buffer.from(trimmed, 'hex'));
}
