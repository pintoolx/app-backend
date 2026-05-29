import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { HealthService } from '../../health/health.service';
import { KeeperKeypairService } from '../../onchain/keeper-keypair.service';
import { AdminOverviewService } from '../overview/admin-overview.service';

/**
 * Keeper runway warning bands. The keeper halts *all* deployment evaluations
 * once its balance drops below MINIMUM_KEEPER_SOL (see strategy-keeper.service
 * `MINIMUM_KEEPER_SOL = 0.1`), so anything below that is `critical`, not merely
 * low. `low` is an early-warning runway band above the halt threshold.
 */
const CRITICAL_BALANCE_SOL = 0.1;
const LOW_BALANCE_WARNING_SOL = 0.25;

export type KeeperWarningLevel = 'ok' | 'low' | 'critical' | 'unknown';

export interface KeeperStatus {
  configured: boolean;
  /** Mirrors `configured`; the admin UI reads `initialized`. */
  initialized: boolean;
  publicKey: string | null;
  source: 'env' | 'system_config' | null;
  /** On-chain SOL balance of the keeper signer. */
  balanceSol: number | null;
  rpcUrl: string;
  /** Banded runway signal consumed by the dashboard badge. */
  warningLevel: KeeperWarningLevel;
  /** Human-readable note (low-balance hint or load error). */
  warning: string | null;
}

function keeperWarningLevel(sol: number | null): KeeperWarningLevel {
  if (sol == null) return 'unknown';
  if (sol < CRITICAL_BALANCE_SOL) return 'critical';
  if (sol < LOW_BALANCE_WARNING_SOL) return 'low';
  return 'ok';
}

@Injectable()
export class AdminSystemService {
  private readonly logger = new Logger(AdminSystemService.name);

  constructor(
    private readonly healthService: HealthService,
    private readonly keeperService: KeeperKeypairService,
    private readonly overviewService: AdminOverviewService,
    private readonly configService: ConfigService,
  ) {}

  async getReadiness() {
    return this.healthService.readiness();
  }

  getAdapterMatrix() {
    return this.overviewService.computeAdapterMatrix();
  }

  async getKeeperStatus(): Promise<KeeperStatus> {
    const rpcUrl =
      this.configService.get<string>('solana.rpcUrl') ?? 'https://api.devnet.solana.com';
    try {
      const keypair = await this.keeperService.loadKeypair();
      const conn = new Connection(rpcUrl, 'confirmed');
      const lamports = await conn.getBalance(keypair.publicKey);
      const sol = lamports / LAMPORTS_PER_SOL;
      return {
        configured: true,
        initialized: true,
        publicKey: keypair.publicKey.toBase58(),
        source: this.keeperService.getResolvedSource(),
        balanceSol: sol,
        rpcUrl,
        warningLevel: keeperWarningLevel(sol),
        warning:
          sol < CRITICAL_BALANCE_SOL
            ? `SOL balance ${sol.toFixed(4)} below halt threshold ${CRITICAL_BALANCE_SOL} — keeper is skipping all evaluations`
            : sol < LOW_BALANCE_WARNING_SOL
              ? `SOL balance ${sol.toFixed(4)} approaching halt threshold ${CRITICAL_BALANCE_SOL}`
              : null,
      };
    } catch (err) {
      this.logger.warn(`Keeper status unavailable: ${err instanceof Error ? err.message : err}`);
      return {
        configured: false,
        initialized: false,
        publicKey: null,
        source: null,
        balanceSol: null,
        rpcUrl,
        warningLevel: 'unknown',
        warning: err instanceof Error ? err.message : 'Keeper not configured',
      };
    }
  }
}
