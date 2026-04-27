import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AdapterMatrixRow {
  adapter: string;
  mode: 'real' | 'noop';
  endpoint?: string;
}

const REQUIRED_PROD_ENV_VARS = ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];

/**
 * Week 6.5 — Startup config sanity checks.
 *
 * Logs an adapter matrix on boot (which port is real vs noop), and refuses to
 * start in production if a critical adapter is still in noop mode (unless
 * `STRATEGY_ALLOW_NOOP_IN_PROD=true`).
 */
@Injectable()
export class RuntimeConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger('StrategyPlatform');

  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap(): void {
    const matrix = this.computeAdapterMatrix();
    this.logger.log('=== adapter matrix ===');
    for (const row of matrix) {
      const tail = row.endpoint ? ` (endpoint=${row.endpoint})` : '';
      this.logger.log(`  ${row.adapter.padEnd(8, ' ')}: ${row.mode}${tail}`);
    }
    this.logger.log('=======================');

    this.assertRequiredEnv();
    this.assertProdAdapters(matrix);
  }

  private computeAdapterMatrix(): AdapterMatrixRow[] {
    const onchainProgramId = this.configService.get<string>('STRATEGY_RUNTIME_PROGRAM_ID');
    const onchainSeed = this.configService.get<string>('STRATEGY_RUNTIME_KEEPER_SEED');
    const erRouter = this.configService.get<string>('MAGICBLOCK_ROUTER_URL');
    const perEndpoint = this.configService.get<string>('MAGICBLOCK_PER_ENDPOINT');
    const ppEndpoint = this.configService.get<string>('MAGICBLOCK_PP_ENDPOINT');
    const umbraEnabled = this.configService.get<string>('UMBRA_ENABLED') === 'true';

    return [
      {
        adapter: 'onchain',
        mode: onchainProgramId && onchainSeed ? 'real' : 'noop',
        endpoint: onchainProgramId,
      },
      {
        adapter: 'er',
        mode: erRouter && erRouter.trim() ? 'real' : 'noop',
        endpoint: erRouter ?? undefined,
      },
      {
        adapter: 'per',
        mode: perEndpoint && perEndpoint.trim() ? 'real' : 'noop',
        endpoint: perEndpoint ?? undefined,
      },
      {
        adapter: 'pp',
        mode: ppEndpoint && ppEndpoint.trim() ? 'real' : 'noop',
        endpoint: ppEndpoint ?? undefined,
      },
      {
        adapter: 'umbra',
        mode: umbraEnabled ? 'real' : 'noop',
      },
    ];
  }

  private assertRequiredEnv(): void {
    const env = process.env.NODE_ENV ?? 'development';
    const missing = REQUIRED_PROD_ENV_VARS.filter((name) => !this.configService.get<string>(name));
    if (env === 'production' && missing.length > 0) {
      const msg = `Missing required production env vars: ${missing.join(', ')}`;
      this.logger.error(msg);
      throw new Error(msg);
    }
    if (missing.length > 0) {
      this.logger.warn(`Missing recommended env vars (development OK): ${missing.join(', ')}`);
    }
  }

  private assertProdAdapters(matrix: AdapterMatrixRow[]): void {
    if (process.env.NODE_ENV !== 'production') return;
    const allow = this.configService.get<string>('STRATEGY_ALLOW_NOOP_IN_PROD') === 'true';
    const noopAdapters = matrix.filter((m) => m.mode === 'noop').map((m) => m.adapter);
    if (noopAdapters.length === 0) return;
    if (allow) {
      this.logger.warn(
        `[STRATEGY] Running in production with noop adapters: ${noopAdapters.join(', ')}. ` +
          `Set STRATEGY_ALLOW_NOOP_IN_PROD=false to enforce real adapters.`,
      );
      return;
    }
    const msg =
      `Refusing to start in production with noop adapters: ${noopAdapters.join(', ')}. ` +
      `Set STRATEGY_ALLOW_NOOP_IN_PROD=true to bypass.`;
    this.logger.error(msg);
    throw new Error(msg);
  }
}
