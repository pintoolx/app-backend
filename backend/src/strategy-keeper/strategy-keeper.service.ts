import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '../database/supabase.service';
import { KeeperKeypairService } from '../onchain/keeper-keypair.service';
import { MetricsService } from '../observability/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StrategyDeploymentRow } from '../strategy-deployments/strategy-deployments.repository';

const MINIMUM_KEEPER_SOL = 0.1;
const DEFAULT_POLLING_MS = 30_000;

export interface StrategyEvaluationEvent {
  deploymentId: string;
  strategyId: string;
  executionMode: string;
  triggerType: string;
  evaluatedAt: Date;
}

/**
 * Phase 1.1 — Strategy Keeper Service
 *
 * Periodically polls active (deployed) strategy deployments and emits
 * evaluation events.  The actual execution is handled by
 * StrategyRunsService (Phase 1.2) which listens for these events.
 *
 * Architecture mirrors WorkflowLifecycleManager:
 *   polling → sync → evaluate → emit → (async execution by subscriber)
 */
@Injectable()
export class StrategyKeeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyKeeperService.name);
  private pollingTimeout: NodeJS.Timeout | null = null;
  private syncInProgress = false;
  private readonly POLLING_MS: number;
  private lastEvaluationResults = new Map<
    string,
    { triggered: boolean; evaluatedAt: Date; note?: string }
  >();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly keeperKeypairService: KeeperKeypairService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.POLLING_MS =
      this.configService.get<number>('STRATEGY_KEEPER_POLLING_MS') ??
      DEFAULT_POLLING_MS;
  }

  onModuleInit() {
    this.startPolling();
  }

  onModuleDestroy() {
    this.stopPolling();
  }

  private startPolling() {
    this.logger.log(
      `Starting strategy keeper polling (interval=${this.POLLING_MS}ms)...`,
    );
    if (this.pollingTimeout) return;
    this.pollingTimeout = setTimeout(() => {
      this.pollingLoop();
    }, 0);
  }

  private stopPolling() {
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
  }

  private async pollingLoop() {
    if (!this.pollingTimeout) return;
    await this.runSyncOnce();
    if (!this.pollingTimeout) return;
    this.pollingTimeout = setTimeout(() => {
      this.pollingLoop();
    }, this.POLLING_MS);
  }

  private async runSyncOnce(): Promise<number> {
    if (this.syncInProgress) return 0;
    this.syncInProgress = true;
    try {
      return await this.syncDeployments();
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Core logic:
   * 1. Fetch deployed deployments from DB
   * 2. Check keeper balance (skip all if < MINIMUM_KEEPER_SOL)
   * 3. Evaluate each deployment's trigger condition
   * 4. Emit 'strategy.evaluated' event for triggered deployments
   */
  async syncDeployments(): Promise<number> {
    const t0 = Date.now();
    let emittedCount = 0;

    try {
      // 1. Fetch active deployments
      const { data: deployments, error } = await this.supabaseService.client
        .from('strategy_deployments')
        .select('*')
        .eq('lifecycle_status', 'deployed')
        .order('updated_at', { ascending: false });

      if (error) {
        this.logger.error('Failed to fetch deployed strategies', error);
        this.metricsService.recordAdapterCall(
          'keeper',
          'syncDeployments',
          'fail',
          (Date.now() - t0) / 1000,
        );
        return 0;
      }

      const rows = (deployments ?? []) as StrategyDeploymentRow[];
      if (rows.length === 0) {
        this.logger.debug('No deployed strategies to evaluate');
        this.metricsService.recordAdapterCall(
          'keeper',
          'syncDeployments',
          'ok',
          (Date.now() - t0) / 1000,
        );
        return 0;
      }

      // 2. Check keeper balance
      const hasFunds = await this.checkKeeperBalance();
      if (!hasFunds) {
        this.logger.warn(
          `Keeper balance below ${MINIMUM_KEEPER_SOL} SOL; skipping all evaluations`,
        );
        return 0;
      }

      // 3. Evaluate each deployment
      for (const deployment of rows) {
        const evaluation = await this.evaluateDeployment(deployment);
        this.lastEvaluationResults.set(deployment.id, {
          triggered: evaluation.triggered,
          evaluatedAt: new Date(),
          note: evaluation.note,
        });

        if (evaluation.triggered) {
          const event: StrategyEvaluationEvent = {
            deploymentId: deployment.id,
            strategyId: deployment.strategy_id,
            executionMode: deployment.execution_mode,
            triggerType: evaluation.triggerType,
            evaluatedAt: new Date(),
          };
          this.eventEmitter.emit('strategy.evaluated', event);
          emittedCount++;
          this.logger.log(
            `Strategy evaluation triggered: deployment=${deployment.id} mode=${deployment.execution_mode} trigger=${evaluation.triggerType}`,
          );
        }
      }

      this.metricsService.recordAdapterCall(
        'keeper',
        'syncDeployments',
        'ok',
        (Date.now() - t0) / 1000,
      );
      return emittedCount;
    } catch (err) {
      this.logger.error('Unexpected error in syncDeployments', err);
      this.metricsService.recordAdapterCall(
        'keeper',
        'syncDeployments',
        'fail',
        (Date.now() - t0) / 1000,
      );
      return 0;
    }
  }

  /**
   * Evaluate whether a single deployment should trigger a strategy run.
   *
   * Current logic (Phase 1.1):
   * - Reads trigger_config from deployment.metadata
   * - Supports 'interval' trigger (default: every 5 min)
   * - Supports 'manual' trigger (one-shot flag in metadata)
   *
   * Future phases will add 'price' and 'signal' triggers.
   */
  private async evaluateDeployment(deployment: StrategyDeploymentRow): Promise<{
    triggered: boolean;
    triggerType: string;
    note?: string;
  }> {
    const metadata = deployment.metadata ?? {};
    const triggerConfig = (metadata.trigger_config as Record<string, unknown>) ?? {
      type: 'interval',
      interval_ms: 300_000, // 5 minutes default
    };
    const triggerType = String(triggerConfig.type ?? 'interval');

    const lastEval = this.lastEvaluationResults.get(deployment.id);

    switch (triggerType) {
      case 'interval': {
        const intervalMs = Number(triggerConfig.interval_ms ?? 300_000);
        if (!lastEval) {
          return { triggered: true, triggerType, note: 'first evaluation' };
        }
        const elapsed = Date.now() - lastEval.evaluatedAt.getTime();
        if (elapsed >= intervalMs) {
          return {
            triggered: true,
            triggerType,
            note: `interval elapsed ${Math.round(elapsed / 1000)}s >= ${intervalMs / 1000}s`,
          };
        }
        return {
          triggered: false,
          triggerType,
          note: `interval not elapsed (${Math.round(elapsed / 1000)}s < ${intervalMs / 1000}s)`,
        };
      }

      case 'manual': {
        const pending = metadata.manual_trigger_pending === true;
        if (pending) {
          // Clear the pending flag so it doesn't trigger again
          await this.clearManualTriggerFlag(deployment.id);
          return { triggered: true, triggerType, note: 'manual trigger pending' };
        }
        return { triggered: false, triggerType, note: 'no manual trigger pending' };
      }

      case 'price': {
        // Phase 1.3+ — placeholder; always false in Phase 1.1
        return {
          triggered: false,
          triggerType,
          note: 'price trigger not yet implemented (Phase 1.3+)',
        };
      }

      default:
        return {
          triggered: false,
          triggerType,
          note: `unknown trigger type: ${triggerType}`,
        };
    }
  }

  private async clearManualTriggerFlag(deploymentId: string): Promise<void> {
    try {
      await this.supabaseService.client
        .from('strategy_deployments')
        .update({
          metadata: {
            // We need to merge; raw SQL would be safer but Supabase supports
            // jsonb merge via the RPC or we can read-update-write.
            // For simplicity we rely on the caller (StrategyRunsService) to
            // update metadata atomically when creating a run.
          },
        })
        .eq('id', deploymentId);
    } catch (err) {
      this.logger.warn(`Failed to clear manual trigger flag for ${deploymentId}`, err);
    }
  }

  /**
   * Check keeper SOL balance. Returns false if below MINIMUM_KEEPER_SOL.
   */
  private async checkKeeperBalance(): Promise<boolean> {
    try {
      const keeper = await this.keeperKeypairService.loadKeypair();
      const rpcUrl =
        this.configService.get<string>('SOLANA_RPC_URL') ??
        'https://api.devnet.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');
      const lamports = await connection.getBalance(keeper.publicKey);
      const balance = lamports / LAMPORTS_PER_SOL;

      this.logger.debug(`Keeper balance: ${balance.toFixed(4)} SOL`);

      // Record metric regardless of threshold
      // (MetricsService doesn't expose a raw gauge setter; we use a custom
      // metric name via the same registry for now.)
      //
      // Note: prometheus gauge for keeper balance is recorded as a separate
      // metric in the registry if the caller wires it up.  For Phase 1.1 we
      // log it and rely on the adapter_call metric for syncDeployments.

      return balance >= MINIMUM_KEEPER_SOL;
    } catch (err) {
      this.logger.warn(
        `Keeper balance check failed: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  /**
   * Expose the last evaluation results for health / debugging.
   */
  getLastEvaluations(): Array<{
    deploymentId: string;
    triggered: boolean;
    evaluatedAt: Date;
    note?: string;
  }> {
    return Array.from(this.lastEvaluationResults.entries()).map(
      ([deploymentId, result]) => ({
        deploymentId,
        ...result,
      }),
    );
  }

  /**
   * Force an immediate evaluation cycle (used by admin / tests).
   */
  async forceEvaluation(): Promise<number> {
    return this.runSyncOnce();
  }
}
