import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../database/supabase.service';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuditLogRow } from '../audit/audit-logs.repository';

export interface AdapterMatrixEntry {
  adapter: 'onchain' | 'er' | 'per' | 'pp' | 'umbra';
  mode: 'real' | 'noop';
  hint: string;
}

export interface AdminOverview {
  generatedAt: string;
  uptimeSeconds: number;
  adapters: AdapterMatrixEntry[];
  counts: {
    users: number;
    accounts: number;
    workflows: number;
    strategies: { total: number; published: number; draft: number };
    deployments: Record<string, number>; // by lifecycle_status
    runningExecutions: number;
    activePerTokens: number;
  };
  recentAdminActions: AuditLogRow[];
}

const ADAPTER_HINTS: AdapterMatrixEntry[] = [
  {
    adapter: 'onchain',
    mode: 'noop',
    hint: 'Set STRATEGY_RUNTIME_PROGRAM_ID + STRATEGY_RUNTIME_KEEPER_SECRET to enable real mode',
  },
  { adapter: 'er', mode: 'noop', hint: 'Set MAGICBLOCK_ROUTER_URL to enable real mode' },
  { adapter: 'per', mode: 'noop', hint: 'Set MAGICBLOCK_PER_ENDPOINT to enable real mode' },
  { adapter: 'pp', mode: 'noop', hint: 'Set MAGICBLOCK_PP_ENDPOINT to enable real mode' },
  { adapter: 'umbra', mode: 'noop', hint: 'Set UMBRA_MASTER_SEED to enable real mode' },
];

@Injectable()
export class AdminOverviewService {
  private readonly logger = new Logger(AdminOverviewService.name);
  private readonly bootedAt = Date.now();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getOverview(): Promise<AdminOverview> {
    const [
      users,
      accounts,
      workflows,
      strategiesTotal,
      strategiesPublished,
      strategiesDraft,
      runningExecutions,
      activePerTokens,
      deploymentBuckets,
      recent,
    ] = await Promise.all([
      this.countRows('users'),
      this.countRows('accounts'),
      this.countRows('workflows'),
      this.countRows('strategies'),
      this.countRows('strategies', (q) => q.eq('lifecycle_state', 'published')),
      this.countRows('strategies', (q) => q.eq('lifecycle_state', 'draft')),
      this.countRows('workflow_executions', (q) => q.eq('status', 'running')),
      this.countRows('per_auth_tokens', (q) =>
        q.eq('status', 'active').gt('expires_at', new Date().toISOString()),
      ),
      this.deploymentBuckets(),
      this.auditLogService.list({ limit: 10 }).catch((err) => {
        this.logger.warn(`Failed to load recent admin actions: ${err}`);
        return [] as AuditLogRow[];
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.max(0, Math.round((Date.now() - this.bootedAt) / 1000)),
      adapters: this.computeAdapterMatrix(),
      counts: {
        users,
        accounts,
        workflows,
        strategies: {
          total: strategiesTotal,
          published: strategiesPublished,
          draft: strategiesDraft,
        },
        deployments: deploymentBuckets,
        runningExecutions,
        activePerTokens,
      },
      recentAdminActions: recent,
    };
  }

  computeAdapterMatrix(): AdapterMatrixEntry[] {
    const config = this.configService;
    const truthy = (v: string | undefined) => typeof v === 'string' && v.trim().length > 0;
    return ADAPTER_HINTS.map((entry) => {
      const mode: 'real' | 'noop' = (() => {
        switch (entry.adapter) {
          case 'onchain':
            return truthy(config.get<string>('STRATEGY_RUNTIME_PROGRAM_ID')) &&
              truthy(config.get<string>('STRATEGY_RUNTIME_KEEPER_SECRET'))
              ? 'real'
              : 'noop';
          case 'er':
            return truthy(config.get<string>('MAGICBLOCK_ROUTER_URL')) ? 'real' : 'noop';
          case 'per':
            return truthy(config.get<string>('MAGICBLOCK_PER_ENDPOINT')) ? 'real' : 'noop';
          case 'pp':
            return truthy(config.get<string>('MAGICBLOCK_PP_ENDPOINT')) ? 'real' : 'noop';
          case 'umbra':
            return truthy(config.get<string>('UMBRA_MASTER_SEED')) ? 'real' : 'noop';
        }
      })();
      return { ...entry, mode };
    });
  }

  // ---------------------------------------------------------------- helpers

  private async countRows(
    table: string,
    refine?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<number> {
    let q = this.supabaseService.client.from(table).select('id', { count: 'exact', head: true });
    if (refine) q = refine(q);
    const { count, error } = await q;
    if (error) {
      this.logger.warn(`Failed to count rows in ${table}: ${error.message}`);
      return 0;
    }
    return count ?? 0;
  }

  private async deploymentBuckets(): Promise<Record<string, number>> {
    const buckets: Record<string, number> = {
      draft: 0,
      deployed: 0,
      paused: 0,
      stopped: 0,
      closed: 0,
    };
    await Promise.all(
      Object.keys(buckets).map(async (status) => {
        buckets[status] = await this.countRows('strategy_deployments', (q) =>
          q.eq('lifecycle_status', status),
        );
      }),
    );
    return buckets;
  }
}
