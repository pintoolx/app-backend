import {
  Injectable,
  Logger,
  Inject,
  NotImplementedException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  StrategyRunsRepository,
  StrategyRunRow,
  ExecutionLayer,
} from './strategy-runs.repository';
import {
  ONCHAIN_ADAPTER,
  type OnchainAdapterPort,
  type CommitStateParams,
  type SetPublicSnapshotParams,
} from '../onchain/onchain-adapter.port';
import {
  MAGICBLOCK_ER_ADAPTER,
  type MagicBlockErAdapterPort,
} from '../magicblock/magicblock.port';
import {
  StrategyDeploymentsRepository,
  type StrategyDeploymentRow,
} from '../strategy-deployments/strategy-deployments.repository';
import { MetricsService } from '../observability/metrics.service';
import { StrategyEvaluationEvent } from './strategy-keeper.service';

/**
 * Phase 1.2 — Strategy Runs Service
 *
 * Listens for 'strategy.evaluated' events emitted by StrategyKeeperService,
 * creates a run record, and executes the strategy according to its
 * execution_mode.
 *
 * Execution flow per mode:
 *   offchain  → commitState() + setPublicSnapshot()
 *   er        → route() through MagicBlock ER (Phase 1.2: advisory only)
 *   per       → startCycle() via PrivateExecutionCyclesService (future)
 */
@Injectable()
export class StrategyRunsService {
  private readonly logger = new Logger(StrategyRunsService.name);

  constructor(
    private readonly runsRepository: StrategyRunsRepository,
    private readonly deploymentsRepository: StrategyDeploymentsRepository,
    @Inject(ONCHAIN_ADAPTER) private readonly onchainAdapter: OnchainAdapterPort,
    @Inject(MAGICBLOCK_ER_ADAPTER) private readonly erAdapter: MagicBlockErAdapterPort,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Event handler: when StrategyKeeperService evaluates a deployment and
   * decides it should run, this handler creates the run record and kicks
   * off asynchronous execution.
   */
  @OnEvent('strategy.evaluated')
  async handleStrategyEvaluated(event: StrategyEvaluationEvent): Promise<void> {
    this.logger.log(
      `Handling strategy.evaluated: deployment=${event.deploymentId} trigger=${event.triggerType}`,
    );

    try {
      const run = await this.createRun({
        deploymentId: event.deploymentId,
        executionLayer: event.executionMode as ExecutionLayer,
      });

      // Execute asynchronously so the event handler returns quickly
      this.executeRun(run.id).catch((err) => {
        this.logger.error(
          `Unhandled executeRun error for run=${run.id}: ${err instanceof Error ? err.message : err}`,
        );
      });
    } catch (err) {
      this.logger.error(
        `Failed to create run for deployment=${event.deploymentId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Create a pending strategy run record.
   */
  async createRun(params: {
    deploymentId: string;
    executionLayer: ExecutionLayer;
    strategyVersionId?: string | null;
  }): Promise<StrategyRunRow> {
    return this.runsRepository.insertRun({
      deploymentId: params.deploymentId,
      executionLayer: params.executionLayer,
      strategyVersionId: params.strategyVersionId ?? null,
    });
  }

  /**
   * Execute a strategy run end-to-end.
   *
   * 1. Fetch run + deployment
   * 2. Update status → running
   * 3. Execute according to execution_layer
   * 4. Update status → completed / failed
   * 5. Publish public snapshot
   */
  async executeRun(runId: string): Promise<StrategyRunRow> {
    const t0 = Date.now();
    const run = await this.runsRepository.getById(runId);
    if (!run) {
      throw new Error(`Strategy run not found: ${runId}`);
    }

    let deployment: StrategyDeploymentRow;
    try {
      deployment = await this.deploymentsRepository.getById(run.deployment_id);
    } catch (err) {
      const msg = `Deployment not found for run=${runId}: ${err instanceof Error ? err.message : err}`;
      this.logger.error(msg);
      this.metricsService.recordAdapterCall(
        'keeper',
        'executeRun',
        'fail',
        (Date.now() - t0) / 1000,
      );
      return this.runsRepository.updateRun(runId, {
        status: 'failed',
        errorMessage: msg,
        completedAt: new Date().toISOString(),
      });
    }

    // Transition to running
    await this.runsRepository.updateRun(runId, { status: 'running' });

    try {
      let outcome: Record<string, unknown> = {};

      switch (run.execution_layer) {
        case 'offchain': {
          outcome = await this.executeOffchain(run, deployment);
          break;
        }
        case 'er': {
          outcome = await this.executeEr(run, deployment);
          break;
        }
        case 'per': {
          outcome = await this.executePer(run, deployment);
          break;
        }
        default:
          throw new NotImplementedException(
            `Execution layer not implemented: ${run.execution_layer}`,
          );
      }

      // Publish public snapshot (best-effort; failures are logged but don't
      // fail the run).
      await this.publishPublicSnapshot(run, deployment, outcome);

      const completed = await this.runsRepository.updateRun(runId, {
        status: 'completed',
        publicOutcome: outcome,
        completedAt: new Date().toISOString(),
      });

      this.metricsService.recordAdapterCall(
        'keeper',
        'executeRun',
        'ok',
        (Date.now() - t0) / 1000,
      );

      this.logger.log(
        `Strategy run completed: run=${runId} deployment=${deployment.id} layer=${run.execution_layer}`,
      );
      return completed;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Strategy run failed: run=${runId}`, err);

      this.metricsService.recordAdapterCall(
        'keeper',
        'executeRun',
        'fail',
        (Date.now() - t0) / 1000,
      );

      return this.runsRepository.updateRun(runId, {
        status: 'failed',
        errorMessage,
        completedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Offchain execution: commit state to the on-chain program.
   */
  private async executeOffchain(
    run: StrategyRunRow,
    deployment: StrategyDeploymentRow,
  ): Promise<Record<string, unknown>> {
    const commitParams: CommitStateParams = {
      deploymentId: deployment.id,
      expectedRevision: deployment.state_revision,
      newPrivateStateCommitment: this.generateMockCommitment(),
      lastResultCode: 0,
    };

    const commitResult = await this.onchainAdapter.commitState(commitParams);

    return {
      layer: 'offchain',
      commitSignature: commitResult.signature,
      newStateRevision: commitResult.newStateRevision,
    };
  }

  /**
   * ER execution: route a transaction through MagicBlock ER.
   *
   * Phase 1.2 limitation: constructing the actual ER transaction requires
   * program-specific instruction building.  For now we log and return a
   * placeholder outcome.  A future phase will build real instructions.
   */
  private async executeEr(
    _run: StrategyRunRow,
    deployment: StrategyDeploymentRow,
  ): Promise<Record<string, unknown>> {
    this.logger.warn(
      `ER execution not fully implemented in Phase 1.2 for deployment=${deployment.id}. ` +
        `Returning advisory outcome.`,
    );
    return {
      layer: 'er',
      advisory: true,
      note: 'ER auto-execution requires client-signed tx or fee sponsorship (Phase 1.3+)',
    };
  }

  /**
   * PER execution: start a private execution cycle.
   *
   * Phase 1.2 limitation: PER cycles require a creator wallet signature for
   * the challenge/verify flow.  Keeper-operated PER execution needs a
   * credential delegation model not yet implemented.
   */
  private async executePer(
    _run: StrategyRunRow,
    deployment: StrategyDeploymentRow,
  ): Promise<Record<string, unknown>> {
    this.logger.warn(
      `PER execution not fully implemented in Phase 1.2 for deployment=${deployment.id}. ` +
        `Returning advisory outcome.`,
    );
    return {
      layer: 'per',
      advisory: true,
      note: 'PER auto-execution needs credential delegation (Phase 1.3+)',
    };
  }

  /**
   * Publish a public snapshot so followers and explorers can see the latest
   * strategy summary without touching private state.
   */
  private async publishPublicSnapshot(
    run: StrategyRunRow,
    deployment: StrategyDeploymentRow,
    outcome: Record<string, unknown>,
  ): Promise<void> {
    try {
      const snapshotParams: SetPublicSnapshotParams = {
        deploymentId: deployment.id,
        expectedSnapshotRevision: deployment.state_revision + 1,
        status: run.status === 'completed' ? 'ok' : 'degraded',
        pnlSummaryBps: null,
        riskBand: null,
        publicMetricsHash: this.hashOutcome(outcome),
      };

      const result = await this.onchainAdapter.setPublicSnapshot(snapshotParams);
      this.logger.debug(
        `Public snapshot published for deployment=${deployment.id} sig=${result.signature}`,
      );
    } catch (err) {
      this.logger.warn(
        `Public snapshot publish failed for deployment=${deployment.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private generateMockCommitment(): string {
    // In a real implementation this would be a hash of the private state.
    // Phase 1.2 uses a deterministic placeholder so tests are stable.
    return '0x' + 'ab'.repeat(32);
  }

  private hashOutcome(outcome: Record<string, unknown>): string {
    // Simple deterministic hash for the snapshot.
    const str = JSON.stringify(outcome);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `0x${Math.abs(hash).toString(16).padStart(64, '0')}`;
  }
}
