import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { StrategyDeploymentsRepository } from '../../strategy-deployments/strategy-deployments.repository';
import {
  FollowerVaultsRepository,
  type FollowerVaultRow,
} from '../../follower-vaults/follower-vaults.repository';
import {
  StrategySubscriptionsRepository,
} from '../../follower-vaults/subscriptions.repository';
import {
  FollowerVisibilityGrantsRepository,
  type FollowerVisibilityGrantRow,
} from '../../follower-vaults/follower-visibility-grants.repository';
import {
  PrivateExecutionCyclesRepository,
  type PrivateExecutionCycleRow,
} from '../../follower-vaults/private-execution-cycles.repository';
import {
  PrivateExecutionCyclesService,
  type PrivateCycleView,
} from '../../follower-vaults/private-execution-cycles.service';

/**
 * Admin write-path facade for the Phase-1 follower-vault domain. Mirrors the
 * idiom of `AdminOpsService` — each method validates inputs, performs the
 * mutation through the existing domain repos/services, and returns a small
 * DTO. Audit logging is wired at controller level via `@AdminAudit`.
 *
 * Every method here is meant to be reachable only from
 * `AdminPrivacyOpsController` under `AdminJwtGuard + AdminRolesGuard`.
 */
@Injectable()
export class AdminFollowerVaultsOpsService {
  private readonly logger = new Logger(AdminFollowerVaultsOpsService.name);

  constructor(
    private readonly grantsRepo: FollowerVisibilityGrantsRepository,
    private readonly vaultsRepo: FollowerVaultsRepository,
    private readonly subsRepo: StrategySubscriptionsRepository,
    private readonly cyclesRepo: PrivateExecutionCyclesRepository,
    private readonly cyclesService: PrivateExecutionCyclesService,
    private readonly deploymentsRepo: StrategyDeploymentsRepository,
  ) {}

  // -------------------------------------------------------- visibility grants

  async revokeVisibilityGrant(grantId: string): Promise<FollowerVisibilityGrantRow> {
    const grant = await this.grantsRepo.getById(grantId);
    if (grant.status === 'revoked') {
      throw new BadRequestException('Grant is already revoked');
    }
    if (grant.status === 'expired') {
      throw new BadRequestException('Grant is already expired; nothing to revoke');
    }
    return this.grantsRepo.revoke(grantId);
  }

  // ------------------------------------------------------------ follower vaults

  async pauseFollowerVault(vaultId: string): Promise<FollowerVaultRow> {
    const vault = await this.vaultsRepo.getById(vaultId);
    if (vault.lifecycle_status === 'paused') {
      throw new BadRequestException('Vault is already paused');
    }
    if (vault.lifecycle_status === 'closed') {
      throw new BadRequestException('Closed vaults cannot be paused');
    }
    if (vault.lifecycle_status === 'exiting') {
      throw new BadRequestException(
        'Vault is exiting; complete or revert the exit before pausing',
      );
    }

    // Pause both the vault and the parent subscription so the cycle scaffold
    // skips this follower until an admin recovers it.
    const updated = await this.vaultsRepo.update(vaultId, { lifecycleStatus: 'paused' });
    try {
      const sub = await this.subsRepo.getById(vault.subscription_id);
      if (sub.status === 'active') {
        await this.subsRepo.update(sub.id, { status: 'paused' });
      }
    } catch (err) {
      this.logger.warn(
        `Subscription pause skipped for vault=${vaultId}: ${err instanceof Error ? err.message : err}`,
      );
    }
    return updated;
  }

  async recoverFollowerVault(vaultId: string): Promise<FollowerVaultRow> {
    const vault = await this.vaultsRepo.getById(vaultId);
    if (vault.lifecycle_status !== 'paused') {
      throw new BadRequestException(
        `Vault is not paused (status=${vault.lifecycle_status}); nothing to recover`,
      );
    }
    const updated = await this.vaultsRepo.update(vaultId, { lifecycleStatus: 'active' });
    try {
      const sub = await this.subsRepo.getById(vault.subscription_id);
      if (sub.status === 'paused') {
        await this.subsRepo.update(sub.id, { status: 'active' });
      }
    } catch (err) {
      this.logger.warn(
        `Subscription resume skipped for vault=${vaultId}: ${err instanceof Error ? err.message : err}`,
      );
    }
    return updated;
  }

  // ----------------------------------------------------------- private cycles

  async retryPrivateCycle(cycleId: string): Promise<{
    originalCycleId: string;
    newCycle: PrivateExecutionCycleRow;
    receiptCount: number;
  }> {
    const original = await this.cyclesRepo.getById(cycleId);
    if (original.status === 'running' || original.status === 'accepted') {
      throw new BadRequestException(
        `Cycle is still ${original.status}; only completed/failed cycles can be retried`,
      );
    }

    // Re-derive notional from the original metrics summary so the retry
    // produces an equivalent fan-out unless an operator overrides via a
    // separate endpoint later.
    const originalMetrics = (original.metrics_summary ?? {}) as Record<string, unknown>;
    const notional =
      typeof originalMetrics.notional === 'string' ? originalMetrics.notional : undefined;

    const deployment = await this.deploymentsRepo.getById(original.deployment_id);
    const newKey = `${original.idempotency_key}-retry-${randomBytes(4).toString('hex')}`;

    let view: PrivateCycleView;
    try {
      view = await this.cyclesService.startCycle(
        original.deployment_id,
        deployment.creator_wallet_address,
        {
          triggerType: original.trigger_type,
          triggerRef: original.trigger_ref ?? undefined,
          idempotencyKey: newKey,
          notional,
        },
      );
    } catch (err) {
      this.logger.error(
        `Admin retry failed for cycle=${cycleId}: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }

    return {
      originalCycleId: original.id,
      newCycle: view.cycle,
      receiptCount: view.receipts.length,
    };
  }
}
