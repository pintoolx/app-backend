import { Inject, Injectable, Logger } from '@nestjs/common';
import { StrategyDeploymentsRepository } from '../strategy-deployments/strategy-deployments.repository';
import {
  MAGICBLOCK_PER_ADAPTER,
  type MagicBlockPerAdapterPort,
} from '../magicblock/magicblock.port';
import {
  PrivateExecutionCyclesRepository,
  type PrivateExecutionCycleRow,
} from './private-execution-cycles.repository';
import {
  FollowerExecutionReceiptsRepository,
  type FollowerExecutionReceiptRow,
} from './follower-execution-receipts.repository';
import { StrategySubscriptionsRepository } from './subscriptions.repository';
import { FollowerVaultsRepository } from './follower-vaults.repository';
import {
  FollowerVaultAllocationsService,
  type AllocationResult,
} from './follower-vault-allocations.service';
import {
  PRIVATE_STRATEGY_OUTPUT_PROVIDER,
  type PrivateStrategyOutputProvider,
  type StrategyCycleOutput,
} from './private-cycle-strategy-output';

export interface PrivateCycleStartInput {
  triggerType: string;
  triggerRef?: string;
  idempotencyKey: string;
  notional?: string;
  /**
   * Phase-4: when true, ignore cached strategy output and re-query the
   * strategy provider. The previous cycle's non-terminal receipts are
   * superseded so the audit trail records both attempts.
   */
  replan?: boolean;
}

export interface PrivateCycleView {
  cycle: PrivateExecutionCycleRow;
  receipts: FollowerExecutionReceiptRow[];
}

@Injectable()
export class PrivateExecutionCyclesService {
  private readonly logger = new Logger(PrivateExecutionCyclesService.name);

  constructor(
    private readonly cyclesRepository: PrivateExecutionCyclesRepository,
    private readonly receiptsRepository: FollowerExecutionReceiptsRepository,
    private readonly subscriptionsRepository: StrategySubscriptionsRepository,
    private readonly followerVaultsRepository: FollowerVaultsRepository,
    private readonly deploymentsRepository: StrategyDeploymentsRepository,
    private readonly allocationsService: FollowerVaultAllocationsService,
    @Inject(MAGICBLOCK_PER_ADAPTER) private readonly perAdapter: MagicBlockPerAdapterPort,
    @Inject(PRIVATE_STRATEGY_OUTPUT_PROVIDER)
    private readonly strategyOutputProvider: PrivateStrategyOutputProvider,
  ) {}

  async startCycle(
    deploymentId: string,
    walletAddress: string,
    params: PrivateCycleStartInput,
  ): Promise<PrivateCycleView> {
    // Only the deployment creator (or operator, future work) can start a cycle.
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);

    // Idempotency: caller-supplied keys reuse the existing cycle row instead
    // of double-publishing receipts. With `replan: true` we keep the cycle
    // row but supersede its non-terminal receipts and re-fan-out from a
    // fresh strategy output.
    const existing = await this.cyclesRepository.getByIdempotencyKey(
      deploymentId,
      params.idempotencyKey,
    );
    let cycle: PrivateExecutionCycleRow;
    if (existing) {
      if (!params.replan) {
        const receipts = await this.receiptsRepository.listByCycle(existing.id);
        return { cycle: existing, receipts };
      }
      // Replan: supersede planned/failed receipts so the audit trail keeps
      // both attempts; applied receipts are intentionally NOT touched.
      const supersededCount = await this.receiptsRepository.supersedeUnappliedForCycle(
        existing.id,
      );
      this.logger.log(
        `replan cycle=${existing.id} superseded=${supersededCount}`,
      );
      cycle = await this.cyclesRepository.update(existing.id, {
        status: 'running',
        completedAt: null,
        errorMessage: null,
      });
    } else {
      cycle = await this.cyclesRepository.insert({
        deploymentId,
        idempotencyKey: params.idempotencyKey,
        triggerType: params.triggerType,
        triggerRef: params.triggerRef ?? null,
        status: 'running',
      });
    }

    let receipts: FollowerExecutionReceiptRow[] = [];
    try {
      const subscriptions = await this.subscriptionsRepository.listActiveByDeployment(deploymentId);

      // Each subscription has exactly one follower vault (UNIQUE on
      // follower_vaults.subscription_id). We resolve them in parallel.
      const vaultRows = await Promise.all(
        subscriptions.map((sub) =>
          this.followerVaultsRepository.getBySubscriptionIdOrThrow(sub.id),
        ),
      );
      const vaultBySubscription = new Map(vaultRows.map((vault) => [vault.subscription_id, vault]));

      // Phase-4: pull strategy-defined allocations if available. When the
      // provider returns null we fall back to legacy notional+proportional.
      const strategyOutput = await this.strategyOutputProvider.getCycleOutput({
        deploymentId,
        cycleId: cycle.id,
        idempotencyKey: params.idempotencyKey,
        replan: params.replan ?? false,
      });

      const notional = params.notional ? BigInt(params.notional) : 0n;
      const inputs = this.allocationsService.fromRows(subscriptions);
      const allocations: AllocationResult[] = strategyOutput
        ? this.allocationsService.computeAllocationsWithStrategyOutput(inputs, strategyOutput)
        : this.allocationsService.computeAllocations(inputs, notional);

      const strategyVersion = strategyOutput?.meta.strategyVersion ?? null;

      // Build receipt inserts. If the allocation has a `skipReason` we go
      // straight to status='skipped' to avoid a useless PER fan-out.
      const plannedRows = allocations
        .map((alloc) => {
          const sub = subscriptions.find((s) => s.id === alloc.subscriptionId);
          const vault = vaultBySubscription.get(alloc.subscriptionId);
          if (!sub || !vault) return null;
          const initialStatus: 'skipped' | 'planned' = alloc.skipReason ? 'skipped' : 'planned';
          return {
            alloc,
            sub,
            vault,
            insert: {
              cycleId: cycle.id,
              subscriptionId: sub.id,
              followerVaultId: vault.id,
              allocationAmount: alloc.allocationAmount,
              allocationPctBps: alloc.allocationPctBps,
              payload: this.buildSanitizedReceiptPayload(
                sub.allocation_mode,
                sub.max_capital,
                strategyVersion,
                alloc.skipReason,
                alloc.operationHint,
              ),
              status: initialStatus,
            },
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      receipts = await this.receiptsRepository.insertMany(plannedRows.map((p) => p.insert));

      // PER fan-out: write each non-skipped follower's sanitized allocation
      // into the private runtime. Failures are isolated per receipt so one
      // bad write does not abort the whole cycle.
      receipts = await Promise.all(
        receipts.map(async (receipt) => {
          // Skip rows that we already marked as `skipped` upfront.
          if (receipt.status === 'skipped') return receipt;
          const sub = subscriptions.find((s) => s.id === receipt.subscription_id);
          try {
            const fanoutResult = await this.perAdapter.writeFollowerPrivateState({
              deploymentId,
              cycleId: cycle.id,
              subscriptionId: receipt.subscription_id,
              followerVaultId: receipt.follower_vault_id,
              followerWallet: sub?.follower_wallet ?? '',
              payload: {
                allocationAmount: receipt.allocation_amount,
                allocationPctBps: receipt.allocation_pct_bps,
                allocationMode: sub?.allocation_mode ?? null,
                strategyVersion,
              },
            });
            try {
              return await this.receiptsRepository.updateStatus(receipt.id, {
                status: fanoutResult.status,
                privateStateRevision: fanoutResult.privateStateRevision,
              });
            } catch (err) {
              this.logger.warn(
                `Receipt status update failed for ${receipt.id}: ${
                  err instanceof Error ? err.message : err
                }`,
              );
              return { ...receipt, status: fanoutResult.status };
            }
          } catch (err) {
            this.logger.warn(
              `PER fan-out failed for receipt=${receipt.id}: ${
                err instanceof Error ? err.message : err
              }`,
            );
            try {
              return await this.receiptsRepository.updateStatus(receipt.id, { status: 'failed' });
            } catch {
              return { ...receipt, status: 'failed' };
            }
          }
        }),
      );

      const totalAllocated = allocations.reduce((acc, a) => acc + BigInt(a.allocationAmount), 0n);
      const appliedCount = receipts.filter((r) => r.status === 'applied').length;
      const failedCount = receipts.filter((r) => r.status === 'failed').length;
      const skippedCount = receipts.filter((r) => r.status === 'skipped').length;
      const finalStatus = this.computeTerminalCycleStatus(
        appliedCount,
        failedCount,
        skippedCount,
        receipts.length,
      );
      const completed = await this.cyclesRepository.update(cycle.id, {
        status: finalStatus,
        completedAt: new Date().toISOString(),
        metricsSummary: {
          followerCount: receipts.length,
          appliedCount,
          failedCount,
          skippedCount,
          totalAllocated: totalAllocated.toString(),
          notional: notional.toString(),
          strategyVersion,
          mode: strategyOutput ? 'strategy-output' : 'notional-fallback',
        },
      });
      return { cycle: completed, receipts };
    } catch (err) {
      this.logger.error(
        `Private cycle ${cycle.id} failed: ${err instanceof Error ? err.message : err}`,
      );
      const failed = await this.cyclesRepository.update(cycle.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : 'unknown error',
      });
      return { cycle: failed, receipts };
    }
  }

  /**
   * Cycle terminal-status decision tree:
   *   - all applied (or skipped) and zero failed   → completed
   *   - some applied and some failed               → partial
   *   - all failed (no applied)                    → failed
   *   - no receipts at all (e.g. zero followers)   → completed (empty cycle)
   */
  private computeTerminalCycleStatus(
    appliedCount: number,
    failedCount: number,
    skippedCount: number,
    total: number,
  ): 'completed' | 'partial' | 'failed' {
    if (total === 0) return 'completed';
    if (failedCount === 0) return 'completed';
    if (appliedCount === 0 && skippedCount === 0) return 'failed';
    if (appliedCount > 0) return 'partial';
    // failed > 0 and skipped > 0 but applied == 0 — treat as failed.
    return 'failed';
  }

  private buildSanitizedReceiptPayload(
    allocationMode: string,
    maxCapital: string | null,
    strategyVersion: number | null,
    skipReason?: string,
    operationHint?: string,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      allocationMode,
      maxCapitalAtCycle: maxCapital,
    };
    if (strategyVersion !== null) payload.strategyVersion = strategyVersion;
    if (skipReason) payload.skipReason = skipReason;
    if (operationHint) payload.operationHint = operationHint;
    return payload;
  }

  async getCycle(
    deploymentId: string,
    cycleId: string,
    walletAddress: string,
  ): Promise<PrivateCycleView> {
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const cycle = await this.cyclesRepository.getByIdAndDeployment(deploymentId, cycleId);
    const receipts = await this.receiptsRepository.listByCycle(cycle.id);
    return { cycle, receipts };
  }

  async listCycles(
    deploymentId: string,
    walletAddress: string,
    limit = 50,
  ): Promise<PrivateExecutionCycleRow[]> {
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    return this.cyclesRepository.listByDeployment(deploymentId, limit);
  }
}
