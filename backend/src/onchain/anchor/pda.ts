import { PublicKey } from '@solana/web3.js';

export const STRATEGY_VERSION_SEED = Buffer.from('strategy_version');
export const STRATEGY_DEPLOYMENT_SEED = Buffer.from('strategy_deployment');
export const VAULT_AUTHORITY_SEED = Buffer.from('vault_authority');
export const STRATEGY_STATE_SEED = Buffer.from('strategy_state');
export const PUBLIC_SNAPSHOT_SEED = Buffer.from('public_snapshot');

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

/** Convert a 0x-prefixed or bare 64-char hex string to a 32-byte number array. */
export function hexTo32ByteArray(hex: string): number[] {
  const trimmed = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(`Expected 32-byte hex string, got: ${hex}`);
  }
  return Array.from(Buffer.from(trimmed, 'hex'));
}
