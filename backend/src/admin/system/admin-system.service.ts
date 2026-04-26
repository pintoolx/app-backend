import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { HealthService } from '../../health/health.service';
import { KeeperKeypairService } from '../../onchain/keeper-keypair.service';
import { AdminOverviewService } from '../overview/admin-overview.service';

export interface KeeperStatus {
  configured: boolean;
  publicKey: string | null;
  source: 'env' | 'system_config' | null;
  solBalance: number | null;
  rpcUrl: string;
  warning: string | null;
}

const LOW_BALANCE_THRESHOLD_SOL = 0.1;

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
        publicKey: keypair.publicKey.toBase58(),
        source: this.keeperService.getResolvedSource(),
        solBalance: sol,
        rpcUrl,
        warning:
          sol < LOW_BALANCE_THRESHOLD_SOL ? `SOL balance below ${LOW_BALANCE_THRESHOLD_SOL}` : null,
      };
    } catch (err) {
      this.logger.warn(`Keeper status unavailable: ${err instanceof Error ? err.message : err}`);
      return {
        configured: false,
        publicKey: null,
        source: null,
        solBalance: null,
        rpcUrl,
        warning: err instanceof Error ? err.message : 'Keeper not configured',
      };
    }
  }
}
