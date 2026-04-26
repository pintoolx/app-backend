import { Injectable, Logger, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { SupabaseService } from '../database/supabase.service';

const KEEPER_ENV_VAR = 'STRATEGY_RUNTIME_KEEPER_SECRET';
const SYSTEM_CONFIG_KEY = 'strategy_runtime_keeper_secret';

/**
 * Resolves the keeper keypair used by the AnchorOnchainAdapter to sign
 * commit_state / set_public_snapshot / lifecycle / close instructions.
 *
 * Resolution order (per Week 3 spec):
 *   1. process.env.STRATEGY_RUNTIME_KEEPER_SECRET (base58-encoded secret key)
 *   2. system_config row where key='strategy_runtime_keeper_secret'
 *
 * The keypair is loaded lazily and cached for the process lifetime.
 */
@Injectable()
export class KeeperKeypairService implements OnModuleInit {
  private readonly logger = new Logger(KeeperKeypairService.name);
  private keypair: Keypair | null = null;
  private resolvedFrom: 'env' | 'system_config' | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Best-effort eager load so misconfigurations show up at boot rather than
    // at first instruction submission. We never throw here so consumers using
    // the Noop adapter can still start without a keeper configured.
    try {
      await this.loadKeypair();
    } catch (err) {
      this.logger.debug(
        `Keeper keypair not yet available at boot: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Returns the cached keypair, loading it on first access. Throws if neither
   * the env nor the system_config fallback is configured.
   */
  async loadKeypair(): Promise<Keypair> {
    if (this.keypair) return this.keypair;

    const envSecret = this.configService.get<string>(KEEPER_ENV_VAR);
    if (envSecret) {
      const kp = this.parseSecret(envSecret);
      this.keypair = kp;
      this.resolvedFrom = 'env';
      this.logger.log(`Keeper keypair loaded from env, public=${kp.publicKey.toBase58()}`);
      return kp;
    }

    const dbSecret = await this.fetchSystemConfigSecret();
    if (dbSecret) {
      const kp = this.parseSecret(dbSecret);
      this.keypair = kp;
      this.resolvedFrom = 'system_config';
      this.logger.log(
        `Keeper keypair loaded from system_config, public=${kp.publicKey.toBase58()}`,
      );
      return kp;
    }

    throw new InternalServerErrorException(
      `Keeper keypair not configured. Set the ${KEEPER_ENV_VAR} env var or insert a row into system_config with key='${SYSTEM_CONFIG_KEY}'.`,
    );
  }

  /** Returns where the keypair was last loaded from (debug helper). */
  getResolvedSource(): 'env' | 'system_config' | null {
    return this.resolvedFrom;
  }

  private parseSecret(secret: string): Keypair {
    const trimmed = secret.trim();
    try {
      // Accept either base58 secret key (64 bytes) or JSON array of 64 numbers.
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const arr = JSON.parse(trimmed) as number[];
        return Keypair.fromSecretKey(Uint8Array.from(arr));
      }
      const bytes = bs58.decode(trimmed);
      return Keypair.fromSecretKey(bytes);
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to parse keeper secret: ${err instanceof Error ? err.message : 'invalid format'}`,
      );
    }
  }

  private async fetchSystemConfigSecret(): Promise<string | null> {
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
