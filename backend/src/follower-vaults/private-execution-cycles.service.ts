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
import { FollowerVaultAllocationsService } from './follower-vault-allocations.service';

export interface PrivateCycleStartInput {
  triggerType: string;
  triggerRef?: string;
  idempotencyKey: string;
  notional?: string;
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
  ) {}

  async startCycle(
    deploymentId: string,
    walletAddress: string,
    params: PrivateCycleStartInput,
  ): Promise<PrivateCycleView> {
    // Only the deployment creator (or operator, future work) can start a cycle.
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);

    // Idempotency: caller-supplied keys reuse the existing cycle row instead
    // of double-publishing receipts. Phase-1 returns the existing receipts.
    const existing = await this.cyclesRepository.getByIdempotencyKey(
      deploymentId,
      params.idempotencyKey,
    );
    if (existing) {
      const receipts = await this.receiptsRepository.listByCycle(existing.id);
      return { cycle: existing, receipts };
    }

    const cycle = await this.cyclesRepository.insert({
      deploymentId,
      idempotencyKey: params.idempotencyKey,
      triggerType: params.triggerType,
      triggerRef: params.triggerRef ?? null,
      status: 'running',
    });

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

      const notional = params.notional ? BigInt(params.notional) : 0n;
      const inputs = this.allocationsService.fromRows(subscriptions);
      const allocations = this.allocationsService.computeAllocations(inputs, notional);

      const inserts = allocations
        .map((alloc) => {
          const sub = subscriptions.find((s) => s.id === alloc.subscriptionId);
          const vault = vaultBySubscription.get(alloc.subscriptionId);
          if (!sub || !vault) return null;
          return {
            cycleId: cycle.id,
            subscriptionId: sub.id,
            followerVaultId: vault.id,
            allocationAmount: alloc.allocationAmount,
            allocationPctBps: alloc.allocationPctBps,
            // Sanitized payload only — must NOT include strategy parameters or
            // raw signal inputs. We capture allocation mode + cap so admins can
            // reason about why a follower received the share they did.
            payload: {
              allocationMode: sub.allocation_mode,
              maxCapitalAtCycle: sub.max_capital,
            } as Record<string, unknown>,
            status: 'planned' as const,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      receipts = await this.receiptsRepository.insertMany(inserts);

      // PER fan-out: write each follower's sanitized allocation into the
      // private runtime. Failures are isolated per receipt so one bad write
      // does not abort the cycle.
      receipts = await Promise.all(
        receipts.map(async (receipt) => {
          const sub = subscriptions.find((s) => s.id === receipt.subscription_id);
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
            },
          });
          try {
            return await this.receiptsRepository.updateStatus(receipt.id, {
              status: fanoutResult.status,
              privateStateRevision: fanoutResult.privateStateRevision,
            });
          } catch (err) {
            this.logger.warn(
              `Receipt status update failed for ${receipt.id}: ${err instanceof Error ? err.message : err}`,
            );
            return { ...receipt, status: fanoutResult.status };
          }
        }),
      );

      const totalAllocated = allocations.reduce((acc, a) => acc + BigInt(a.allocationAmount), 0n);
      const appliedCount = receipts.filter((r) => r.status === 'applied').length;
      const failedCount = receipts.filter((r) => r.status === 'failed').length;
      const completed = await this.cyclesRepository.update(cycle.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        metricsSummary: {
          followerCount: receipts.length,
          appliedCount,
          failedCount,
          totalAllocated: totalAllocated.toString(),
          notional: notional.toString(),
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
