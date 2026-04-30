import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type StrategyRole = 'creator' | 'operator' | 'viewer' | 'subscriber' | 'auditor';

/**
 * Role hierarchy: higher index = more privileges.
 * A user with a higher-privilege role can access endpoints that require
 * lower-privilege roles.
 */
const ROLE_HIERARCHY: Record<StrategyRole, number> = {
  auditor: 0,
  subscriber: 1,
  viewer: 2,
  operator: 3,
  creator: 4,
};

export interface PermissionCheckResult {
  allowed: boolean;
  actualRole: StrategyRole | null;
  requiredRole: StrategyRole;
}

@Injectable()
export class StrategyPermissionsService {
  private readonly logger = new Logger(StrategyPermissionsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Check whether a wallet has at least the required role for a deployment.
   *
   * Special cases:
   * - The creator of the deployment always passes (implicit creator role).
   * - If the permissions table has no row, only the creator passes.
   */
  async checkPermission(
    deploymentId: string,
    walletAddress: string,
    requiredRole: StrategyRole,
  ): Promise<PermissionCheckResult> {
    // 1. Check if wallet is the deployment creator
    const { data: deployment, error: deploymentError } = await this.supabaseService.client
      .from('strategy_deployments')
      .select('creator_wallet_address')
      .eq('id', deploymentId)
      .single();

    if (deploymentError) {
      this.logger.warn(`Failed to fetch deployment ${deploymentId}: ${deploymentError.message}`);
    }

    if (deployment?.creator_wallet_address === walletAddress) {
      return { allowed: true, actualRole: 'creator', requiredRole };
    }

    // 2. Check explicit permissions table
    const { data: permission, error: permError } = await this.supabaseService.client
      .from('strategy_permissions')
      .select('role')
      .eq('deployment_id', deploymentId)
      .eq('member_wallet', walletAddress)
      .maybeSingle();

    if (permError) {
      this.logger.warn(
        `Failed to fetch permission for ${walletAddress} on ${deploymentId}: ${permError.message}`,
      );
    }

    const actualRole = (permission?.role as StrategyRole) ?? null;

    if (!actualRole) {
      return { allowed: false, actualRole: null, requiredRole };
    }

    const allowed = ROLE_HIERARCHY[actualRole] >= ROLE_HIERARCHY[requiredRole];
    return { allowed, actualRole, requiredRole };
  }

  /**
   * Grant a role to a wallet for a deployment.
   * Returns the created/updated permission row.
   */
  async grantPermission(
    deploymentId: string,
    walletAddress: string,
    role: StrategyRole,
  ): Promise<{ id: string; role: StrategyRole } | null> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_permissions')
      .upsert(
        {
          deployment_id: deploymentId,
          member_wallet: walletAddress,
          role,
        },
        { onConflict: 'deployment_id,member_wallet,role' },
      )
      .select('id, role')
      .single();

    if (error) {
      this.logger.error(`Failed to grant permission: ${error.message}`);
      return null;
    }

    return data as { id: string; role: StrategyRole };
  }

  /**
   * Revoke a specific role from a wallet for a deployment.
   */
  async revokePermission(
    deploymentId: string,
    walletAddress: string,
    role: StrategyRole,
  ): Promise<boolean> {
    const { error } = await this.supabaseService.client
      .from('strategy_permissions')
      .delete()
      .eq('deployment_id', deploymentId)
      .eq('member_wallet', walletAddress)
      .eq('role', role);

    if (error) {
      this.logger.error(`Failed to revoke permission: ${error.message}`);
      return false;
    }

    return true;
  }

  /**
   * List all explicit permissions for a deployment (excluding implicit creator).
   */
  async listPermissions(deploymentId: string): Promise<
    Array<{
      id: string;
      memberWallet: string;
      role: StrategyRole;
      createdAt: string;
    }>
  > {
    const { data, error } = await this.supabaseService.client
      .from('strategy_permissions')
      .select('id, member_wallet, role, created_at')
      .eq('deployment_id', deploymentId);

    if (error) {
      this.logger.error(`Failed to list permissions: ${error.message}`);
      return [];
    }

    return (data ?? []).map((row: any) => ({
      id: row.id,
      memberWallet: row.member_wallet,
      role: row.role as StrategyRole,
      createdAt: row.created_at,
    }));
  }
}
