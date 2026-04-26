import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import { createHash, createHmac } from 'crypto';
import * as nacl from 'tweetnacl';
import { SupabaseService } from '../database/supabase.service';

const UMBRA_MASTER_SEED_ENV = 'UMBRA_MASTER_SEED';
const SYSTEM_CONFIG_KEY = 'umbra_master_seed';

export interface DeploymentSigner {
  /** Solana ed25519 keypair used to sign on-chain ix on behalf of the deployment. */
  ed25519: Keypair;
  /** Curve25519 (X25519) public/secret bytes used as the EUA viewing key. */
  x25519: { publicKey: Uint8Array; secretKey: Uint8Array };
  /** A short, non-secret reference (HMAC-based) we can store alongside the deployment. */
  seedRef: string;
}

/**
 * Derives deterministic per-deployment Umbra signers from a tenant master
 * seed. The master seed is loaded once and never logged.
 *
 * Resolution order:
 *   1. process.env.UMBRA_MASTER_SEED (hex or base64)
 *   2. system_config row where key='umbra_master_seed'
 *
 * Derivation:
 *   ed25519_seed = SHA-256("umbra-ed25519" || deploymentId || master_seed)
 *   x25519_seed  = SHA-256("umbra-x25519"  || deploymentId || master_seed)
 *   seedRef      = HMAC-SHA-256(master_seed, deploymentId).hex.slice(0,16)
 */
@Injectable()
export class UmbraDeploymentSignerService {
  private readonly logger = new Logger(UmbraDeploymentSignerService.name);
  private cachedMasterSeed: Buffer | null = null;
  private cachedFrom: 'env' | 'system_config' | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>(UMBRA_MASTER_SEED_ENV));
  }

  async deriveForDeployment(deploymentId: string): Promise<DeploymentSigner> {
    if (!deploymentId || deploymentId.length === 0) {
      throw new InternalServerErrorException('deriveForDeployment requires a deployment id');
    }
    const seed = await this.getMasterSeed();

    const ed25519Seed = sha256Concat(Buffer.from('umbra-ed25519'), Buffer.from(deploymentId), seed);
    const x25519Seed = sha256Concat(Buffer.from('umbra-x25519'), Buffer.from(deploymentId), seed);

    const ed25519 = Keypair.fromSeed(ed25519Seed);
    const x25519 = nacl.box.keyPair.fromSecretKey(x25519Seed);

    const seedRef = createHmac('sha256', seed).update(deploymentId).digest('hex').slice(0, 16);
    return {
      ed25519,
      x25519: { publicKey: x25519.publicKey, secretKey: x25519.secretKey },
      seedRef,
    };
  }

  async getMasterSeed(): Promise<Buffer> {
    if (this.cachedMasterSeed) return this.cachedMasterSeed;
    const envSeed = this.configService.get<string>(UMBRA_MASTER_SEED_ENV);
    if (envSeed) {
      const buf = parseSeed(envSeed);
      this.cachedMasterSeed = buf;
      this.cachedFrom = 'env';
      this.logger.log('Umbra master seed loaded from env');
      return buf;
    }
    const dbSeed = await this.fetchSystemConfigSeed();
    if (dbSeed) {
      const buf = parseSeed(dbSeed);
      this.cachedMasterSeed = buf;
      this.cachedFrom = 'system_config';
      this.logger.log('Umbra master seed loaded from system_config');
      return buf;
    }
    throw new InternalServerErrorException(
      `Umbra master seed not configured. Set the ${UMBRA_MASTER_SEED_ENV} env var or insert a row into system_config with key='${SYSTEM_CONFIG_KEY}'.`,
    );
  }

  getResolvedSource(): 'env' | 'system_config' | null {
    return this.cachedFrom;
  }

  private async fetchSystemConfigSeed(): Promise<string | null> {
    if (!this.supabaseService.client) return null;
    const { data, error } = await this.supabaseService.client
      .from('system_config')
      .select('value')
      .eq('key', SYSTEM_CONFIG_KEY)
      .maybeSingle();
    if (error) {
      this.logger.warn(`system_config lookup failed for ${SYSTEM_CONFIG_KEY}: ${error.message}`);
      return null;
    }
    return data?.value ?? null;
  }
}

function parseSeed(raw: string): Buffer {
  const trimmed = raw.trim();
  // Accept hex (64 hex chars = 32 bytes), base64, or arbitrary string.
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length >= 32) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length >= 16) return decoded;
  } catch {
    /* fall through */
  }
  return Buffer.from(trimmed, 'utf8');
}

function sha256Concat(...parts: Buffer[]): Uint8Array {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return Uint8Array.from(h.digest());
}
