import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

/**
 * Admin read surface for `strategy_runs` — the live keeper scheduling layer that
 * actually drives follower copy-trading. Distinct from the legacy
 * `workflow_executions` table that the /admin/executions endpoint reports on.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** A pending/running run older than this is "stuck" (keeper polls every ~30s). */
const STUCK_AFTER_MS = 10 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const RETRY_FETCH_CAP = 5_000;

export type StrategyRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ExecutionLayer = 'offchain' | 'er' | 'per';

export interface AdminRunRow {
  id: string;
  deployment_id: string;
  execution_layer: ExecutionLayer;
  status: StrategyRunStatus;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  retry_of: string | null;
  er_session_id: string | null;
  per_session_id: string | null;
}

export interface RunsHealth {
  generatedAt: string;
  last24h: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  /** completed / (completed + failed) over the window, in basis points. */
  successRateBps: number;
  /** Currently pending or running, regardless of age. */
  running: number;
  /** Pending/running older than the stuck threshold — likely wedged. */
  stuck: number;
  /** Failed in the last 24h that have exhausted their retry budget. */
  retryExhausted24h: number;
}

const RUN_COLUMNS =
  'id, deployment_id, execution_layer, status, started_at, completed_at, error_message, retry_count, max_retries, retry_of, er_session_id, per_session_id';

@Injectable()
export class AdminRunsService {
  private readonly logger = new Logger(AdminRunsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async listRuns(params: {
    deploymentId?: string;
    status?: StrategyRunStatus;
    executionLayer?: ExecutionLayer;
    stuckOnly?: boolean;
    limit?: number;
  }): Promise<AdminRunRow[]> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    let q = this.supabaseService.client
      .from('strategy_runs')
      .select(RUN_COLUMNS)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (params.deploymentId) q = q.eq('deployment_id', params.deploymentId);
    if (params.status) q = q.eq('status', params.status);
    if (params.executionLayer) q = q.eq('execution_layer', params.executionLayer);
    if (params.stuckOnly) {
      const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
      q = q.in('status', ['pending', 'running']).lt('started_at', cutoff);
    }
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list strategy runs (admin)', error);
      return [];
    }
    return (data ?? []) as unknown as AdminRunRow[];
  }

  async getHealth(): Promise<RunsHealth> {
    const sinceIso = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString();
    const stuckCutoffIso = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

    const [total, completed, failed, cancelled, running, stuck, retryExhausted24h] =
      await Promise.all([
        this.countRows((q) => q.gte('started_at', sinceIso)),
        this.countRows((q) => q.eq('status', 'completed').gte('started_at', sinceIso)),
        this.countRows((q) => q.eq('status', 'failed').gte('started_at', sinceIso)),
        this.countRows((q) => q.eq('status', 'cancelled').gte('started_at', sinceIso)),
        this.countRows((q) => q.in('status', ['pending', 'running'])),
        this.countRows((q) =>
          q.in('status', ['pending', 'running']).lt('started_at', stuckCutoffIso),
        ),
        this.countRetryExhausted(sinceIso),
      ]);

    const denom = completed + failed;
    const successRateBps = denom > 0 ? Math.round((completed / denom) * 10_000) : 0;

    return {
      generatedAt: new Date().toISOString(),
      last24h: { total, completed, failed, cancelled },
      successRateBps,
      running,
      stuck,
      retryExhausted24h,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async countRows(
    refine?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<number> {
    let q = this.supabaseService.client
      .from('strategy_runs')
      .select('*', { count: 'exact', head: true });
    if (refine) q = refine(q);
    const { count, error } = await q;
    if (error) {
      this.logger.warn(`Failed to count strategy_runs: ${error.message}`);
      return 0;
    }
    return count ?? 0;
  }

  /**
   * "Retry exhausted" is a column-to-column comparison (retry_count >= max_retries)
   * that PostgREST can't express in a head-count, so fetch the window's failed
   * runs and fold in JS. Bounded by RETRY_FETCH_CAP.
   */
  private async countRetryExhausted(sinceIso: string): Promise<number> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_runs')
      .select('retry_count, max_retries')
      .eq('status', 'failed')
      .gte('started_at', sinceIso)
      .limit(RETRY_FETCH_CAP);
    if (error) {
      this.logger.warn(`Failed to scan retry-exhausted runs: ${error.message}`);
      return 0;
    }
    return (data ?? []).filter(
      (r: { retry_count?: number; max_retries?: number }) =>
        (r.retry_count ?? 0) >= (r.max_retries ?? 1),
    ).length;
  }
}
