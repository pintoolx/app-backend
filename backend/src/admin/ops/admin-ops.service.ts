import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { StrategyDeploymentsService } from '../../strategy-deployments/strategy-deployments.service';
import { StrategyDeploymentsRepository } from '../../strategy-deployments/strategy-deployments.repository';
import { PerAuthTokensRepository } from '../../magicblock/per-auth-tokens.repository';
import type { AdminAccessClaims } from '../auth/admin-token.service';
import { BannedWalletsRepository, type BannedWalletRow } from './banned-wallets.repository';
import { MaintenanceModeService, type MaintenanceState } from './maintenance-mode.service';

export interface AdminActor {
  id: string;
  email: string;
  role: AdminAccessClaims['role'];
}

/**
 * Admin write-path facade. Each method:
 *   1. Re-reads the canonical row from the relevant repository
 *   2. Calls the existing user-facing service "on behalf of" the creator,
 *      so domain rules (lifecycle constraints, ER undelegate, PER revoke)
 *      run unchanged.
 *   3. Returns a small DTO. Audit logging is done by `AdminAuditInterceptor`
 *      around the controller, not here, so service callers can be reused
 *      from background jobs without double-logging.
 */
@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger(AdminOpsService.name);

  constructor(
    private readonly deploymentsRepo: StrategyDeploymentsRepository,
    private readonly deploymentsService: StrategyDeploymentsService,
    private readonly perTokensRepo: PerAuthTokensRepository,
    private readonly bannedRepo: BannedWalletsRepository,
    private readonly maintenance: MaintenanceModeService,
    private readonly supabaseService: SupabaseService,
  ) {}

  // ---------------------------------------------------------------- deployments

  async pauseDeployment(id: string) {
    return this.actAsCreator(id, (creator) => this.deploymentsService.pauseDeployment(id, creator));
  }

  async resumeDeployment(id: string) {
    return this.actAsCreator(id, (creator) =>
      this.deploymentsService.resumeDeployment(id, creator),
    );
  }

  async stopDeployment(id: string) {
    return this.actAsCreator(id, (creator) => this.deploymentsService.stopDeployment(id, creator));
  }

  async forceCloseDeployment(id: string, actor: AdminActor) {
    const view = await this.actAsCreator(id, (creator) =>
      this.deploymentsService.closeDeployment(id, creator),
    );
    this.logger.warn(
      `Admin force-close: deployment=${id} by admin=${actor.email} role=${actor.role}`,
    );
    return view;
  }

  // ------------------------------------------------------------------ PER tokens

  async revokePerToken(token: string) {
    const row = await this.perTokensRepo.getByToken(token);
    if (!row) throw new NotFoundException('PER token not found');
    if (row.status === 'revoked') {
      throw new BadRequestException('PER token is already revoked');
    }
    await this.perTokensRepo.revokeToken(token);
    return { token, deploymentId: row.deployment_id, revoked: true };
  }

  async revokeAllPerTokensForDeployment(deploymentId: string) {
    await this.perTokensRepo.revokeAllForDeployment(deploymentId);
    return { deploymentId, revoked: true };
  }

  // ---------------------------------------------------------------- executions

  async killExecution(executionId: string, actor: AdminActor, reason: string | null) {
    const { data: row, error } = await this.supabaseService.client
      .from('workflow_executions')
      .select('id, status, owner_wallet_address')
      .eq('id', executionId)
      .maybeSingle();
    if (error || !row) throw new NotFoundException('Execution not found');
    if (row.status !== 'pending' && row.status !== 'running') {
      throw new BadRequestException(
        `Execution is in status='${row.status}'; only pending/running executions can be killed`,
      );
    }
    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await this.supabaseService.client
      .from('workflow_executions')
      .update({
        status: 'cancelled',
        completed_at: now,
        killed_by: actor.id,
        killed_at: now,
        killed_reason: reason,
        error_message: reason ?? 'Killed by admin',
      })
      .eq('id', executionId)
      .in('status', ['pending', 'running'])
      .select('id, status, killed_at')
      .maybeSingle();
    if (updErr || !updated) {
      throw new BadRequestException('Execution status changed while being killed; retry');
    }
    return { id: updated.id, status: updated.status, killedAt: updated.killed_at };
  }

  // -------------------------------------------------------------- banned wallets

  async banWallet(input: {
    wallet: string;
    actor: AdminActor;
    reason: string | null;
    expiresAt: string | null;
  }): Promise<BannedWalletRow> {
    if (!input.wallet || input.wallet.length < 32) {
      throw new BadRequestException('Wallet address looks invalid');
    }
    return this.bannedRepo.ban({
      wallet: input.wallet,
      bannedBy: input.actor.id,
      reason: input.reason,
      expiresAt: input.expiresAt,
    });
  }

  async unbanWallet(wallet: string): Promise<{ wallet: string; unbanned: boolean }> {
    await this.bannedRepo.unban(wallet);
    return { wallet, unbanned: true };
  }

  async listBannedWallets(): Promise<BannedWalletRow[]> {
    return this.bannedRepo.listAll();
  }

  // ------------------------------------------------------------------ maintenance

  async getMaintenance(): Promise<MaintenanceState> {
    return this.maintenance.getState();
  }

  async setMaintenance(input: {
    enabled: boolean;
    message: string | null;
    actor: AdminActor;
  }): Promise<MaintenanceState> {
    return this.maintenance.setState({
      enabled: input.enabled,
      message: input.message,
      startedBy: input.actor.email,
    });
  }

  // ---------------------------------------------------------------- helpers

  private async actAsCreator<T>(
    deploymentId: string,
    callback: (creatorWallet: string) => Promise<T>,
  ): Promise<T> {
    const row = await this.deploymentsRepo.getById(deploymentId);
    if (!row.creator_wallet_address) {
      throw new ForbiddenException('Deployment has no creator wallet recorded');
    }
    return callback(row.creator_wallet_address);
  }
}
