import { Injectable, Logger } from '@nestjs/common';
import { hkdfSync, randomBytes } from 'crypto';
import { Keypair } from '@solana/web3.js';
import { KeeperKeypairService } from '../onchain/keeper-keypair.service';

/**
 * HKDF "info" tag. Mirrored in `initial-8-follower-vaults.sql` so admins can
 * verify a vault's signer was derived under this scheme.
 */
const HKDF_INFO = Buffer.from('follower-vault-umbra-v1', 'utf8');

/**
 * Length of the HKDF output that becomes the Ed25519 seed.
 * `Keypair.fromSeed` requires exactly 32 bytes.
 */
const SEED_LEN = 32;

/**
 * Length of the random per-vault salt. Persisted as hex; never re-used across
 * vaults so that compromise of one salt does not leak siblings.
 */
const SALT_LEN = 32;

export interface DerivedSigner {
  pubkey: string;
  /** 64-byte Solana keypair secret. Holders MUST keep this in-process only. */
  secretKey: Uint8Array;
  derivationSalt: string;
}

/**
 * Derives one Ed25519 signer keypair per follower vault.
 *
 *   seed = HKDF-SHA256(IKM=keeper.secretKey, salt, info='follower-vault-umbra-v1', length=32)
 *   signer = Keypair.fromSeed(seed)
 *
 * Privacy invariants enforced here:
 *  - The keeper master key never leaves `KeeperKeypairService` and is never
 *    persisted by this service.
 *  - Only `derivation_salt` (hex, 32 bytes) and `signer_pubkey` (base58) are
 *    intended for DB persistence by the caller. The 64-byte secretKey is
 *    returned for in-process use (e.g. to pass to the Umbra adapter as a
 *    `signerOverride`) but is NOT logged.
 *  - Each vault gets its own random salt so derivations are independent.
 */
@Injectable()
export class FollowerVaultSignerService {
  private readonly logger = new Logger(FollowerVaultSignerService.name);

  constructor(private readonly keeperService: KeeperKeypairService) {}

  /** Generates a fresh random salt encoded as hex. */
  generateSalt(): string {
    return randomBytes(SALT_LEN).toString('hex');
  }

  /**
   * Derive the per-vault signer for the given salt. Pure function over
   * (keeperSecret, salt). Same salt -> same signer; different salts ->
   * uncorrelated signers.
   */
  async derive(saltHex: string): Promise<DerivedSigner> {
    if (!/^[0-9a-fA-F]+$/.test(saltHex) || saltHex.length === 0) {
      throw new Error('derive: salt must be a non-empty hex string');
    }
    const keeper = await this.keeperService.loadKeypair();
    const salt = Buffer.from(saltHex, 'hex');
    // Explicit copy: Buffer.from(Uint8Array) is documented to copy in modern
    // Node, but using `new Uint8Array(...).set(...)` is unambiguous and keeps
    // us from accidentally sharing memory with `keeper.secretKey` when we
    // wipe `ikm` below.
    const ikm = new Uint8Array(keeper.secretKey.length);
    ikm.set(keeper.secretKey);

    // Node's hkdfSync returns an ArrayBuffer. Convert to Uint8Array seed.
    const seedAb = hkdfSync('sha256', ikm, salt, HKDF_INFO, SEED_LEN);
    const seed = new Uint8Array(seedAb);

    try {
      const kp = Keypair.fromSeed(seed);
      return {
        pubkey: kp.publicKey.toBase58(),
        secretKey: kp.secretKey,
        derivationSalt: saltHex,
      };
    } finally {
      // Best-effort wipe of the in-memory IKM/seed copies. Node has no
      // guaranteed secure-erase, but this minimizes accidental retention.
      seed.fill(0);
      ikm.fill(0);
    }
  }

  /**
   * Generates a new salt and derives the signer in one call. Intended to be
   * called exactly once per follower-vault provisioning.
   */
  async deriveFresh(): Promise<DerivedSigner> {
    const salt = this.generateSalt();
    return this.derive(salt);
  }
}
