import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

export interface AdminFollowerVaultRow {
  id: string;
  subscription_id: string;
  deployment_id: string;
  vault_pda: string | null;
  authority_pda: string | null;
  lifecycle_status: string;
  private_state_ref: string | null;
  public_snapshot_ref: string | null;
  custody_mode: string;
  created_at: string;
  updated_at: string;
}

export interface AdminSubscriptionRow {
  id: string;
  deployment_id: string;
  follower_wallet: string;
  status: string;
  visibility_preset: string;
  allocation_mode: string;
  max_capital: string | null;
  max_drawdown_bps: number | null;
  subscription_pda: string | null;
  follower_vault_pda: string | null;
  vault_authority_pda: string | null;
  per_member_ref: string | null;
  umbra_identity_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminPrivateCycleRow {
  id: string;
  deployment_id: string;
  idempotency_key: string;
  trigger_type: string;
  trigger_ref: string | null;
  status: string;
  metrics_summary: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface AdminFollowerExecutionReceiptRow {
  id: string;
  cycle_id: string;
  subscription_id: string;
  follower_vault_id: string;
  allocation_amount: string | null;
  allocation_pct_bps: number | null;
  private_state_revision: number | null;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AdminUmbraIdentityRow {
  id: string;
  follower_vault_id: string;
  signer_pubkey: string;
  x25519_public_key: string | null;
  encrypted_user_account: string | null;
  registration_status: string | null;
  register_queue_signature: string | null;
  register_callback_signature: string | null;
  /**
   * The hex HKDF salt is intentionally surfaced for admin diagnostics — it is
   * not secret on its own (the keeper master key never leaves the keeper
   * service). We surface only the first 12 chars so the table stays compact;
   * the full value can be inspected via the row id when needed.
   */
  derivation_salt_prefix: string;
  created_at: string;
}

export interface AdminVisibilityGrantRow {
  id: string;
  subscription_id: string;
  grantee_wallet: string;
  scope: string;
  status: string;
  expires_at: string | null;
  revoked_at: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AdminPrivateCycleDetail {
  cycle: AdminPrivateCycleRow;
  receipts: AdminFollowerExecutionReceiptRow[];
}

const SUBSCRIPTION_COLUMNS = [
  'id',
  'deployment_id',
  'follower_wallet',
  'status',
  'visibility_preset',
  'allocation_mode',
  'max_capital',
  'max_drawdown_bps',
  'subscription_pda',
  'follower_vault_pda',
  'vault_authority_pda',
  'per_member_ref',
  'umbra_identity_ref',
  'created_at',
  'updated_at',
].join(', ');

const FOLLOWER_VAULT_COLUMNS = [
  'id',
  'subscription_id',
  'deployment_id',
  'vault_pda',
  'authority_pda',
  'lifecycle_status',
  'private_state_ref',
  'public_snapshot_ref',
  'custody_mode',
  'created_at',
  'updated_at',
].join(', ');

const CYCLE_COLUMNS = [
  'id',
  'deployment_id',
  'idempotency_key',
  'trigger_type',
  'trigger_ref',
  'status',
  'metrics_summary',
  'started_at',
  'completed_at',
  'error_message',
].join(', ');

const RECEIPT_COLUMNS = [
  'id',
  'cycle_id',
  'subscription_id',
  'follower_vault_id',
  'allocation_amount',
  'allocation_pct_bps',
  'private_state_revision',
  'status',
  'payload',
  'created_at',
].join(', ');

const UMBRA_IDENTITY_COLUMNS = [
  'id',
  'follower_vault_id',
  'signer_pubkey',
  'x25519_public_key',
  'encrypted_user_account',
  'derivation_salt',
  'registration_status',
  'register_queue_signature',
  'register_callback_signature',
  'created_at',
].join(', ');

const GRANT_COLUMNS = [
  'id',
  'subscription_id',
  'grantee_wallet',
  'scope',
  'status',
  'expires_at',
  'revoked_at',
  'payload',
  'created_at',
  'updated_at',
].join(', ');

const clampLimit = (raw?: number, fallback = 100, max = 500): number => {
  const n = raw ?? fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), max));
};

/**
 * Read-only admin view over the Phase-1 follower-vault domain.
 *
 * The service deliberately bypasses domain repositories and queries Supabase
 * directly so it can offer admin-flavoured filters (status, since, deployment,
 * follower wallet) without polluting the per-tenant repos.
 *
 * Privacy contract:
 *  - Never exposes the keeper master secret or the per-vault Ed25519 secret.
 *  - Surfaces only a 12-char prefix of the HKDF salt for diagnostics.
 *  - Receipt payload comes back as-is because the cycles service guarantees
 *    only sanitized fields are persisted there.
 */
@Injectable()
export class AdminFollowerVaultsService {
  private readonly logger = new Logger(AdminFollowerVaultsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async listFollowerVaults(params: {
    deploymentId?: string;
    status?: string;
    limit?: number;
  }): Promise<AdminFollowerVaultRow[]> {
    let q = this.supabaseService.client
      .from('follower_vaults')
      .select(FOLLOWER_VAULT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(clampLimit(params.limit));
    if (params.deploymentId) q = q.eq('deployment_id', params.deploymentId);
    if (params.status) q = q.eq('lifecycle_status', params.status);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list follower vaults (admin)', error);
      return [];
    }
    return (data ?? []) as unknown as AdminFollowerVaultRow[];
  }

  async listSubscriptions(params: {
    deploymentId?: string;
    followerWallet?: string;
    status?: string;
    limit?: number;
  }): Promise<AdminSubscriptionRow[]> {
    let q = this.supabaseService.client
      .from('strategy_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(clampLimit(params.limit));
    if (params.deploymentId) q = q.eq('deployment_id', params.deploymentId);
    if (params.followerWallet) q = q.eq('follower_wallet', params.followerWallet);
    if (params.status) q = q.eq('status', params.status);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list subscriptions (admin)', error);
      return [];
    }
    return (data ?? []) as unknown as AdminSubscriptionRow[];
  }

  async listPrivateCycles(params: {
    deploymentId?: string;
    status?: string;
    since?: string;
    limit?: number;
  }): Promise<AdminPrivateCycleRow[]> {
    let q = this.supabaseService.client
      .from('private_execution_cycles')
      .select(CYCLE_COLUMNS)
      .order('started_at', { ascending: false })
      .limit(clampLimit(params.limit));
    if (params.deploymentId) q = q.eq('deployment_id', params.deploymentId);
    if (params.status) q = q.eq('status', params.status);
    if (params.since) q = q.gte('started_at', params.since);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list private cycles (admin)', error);
      return [];
    }
    return (data ?? []) as unknown as AdminPrivateCycleRow[];
  }

  async getPrivateCycle(cycleId: string): Promise<AdminPrivateCycleDetail> {
    const { data: cycle, error: cycleErr } = await this.supabaseService.client
      .from('private_execution_cycles')
      .select(CYCLE_COLUMNS)
      .eq('id', cycleId)
      .maybeSingle();
    if (cycleErr) {
      this.logger.error('Failed to fetch private cycle (admin)', cycleErr);
      throw new NotFoundException('Private execution cycle not found');
    }
    if (!cycle) {
      throw new NotFoundException('Private execution cycle not found');
    }

    const { data: receipts, error: receiptsErr } = await this.supabaseService.client
      .from('follower_execution_receipts')
      .select(RECEIPT_COLUMNS)
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: true });
    if (receiptsErr) {
      this.logger.error('Failed to fetch cycle receipts (admin)', receiptsErr);
    }

    return {
      cycle: cycle as unknown as AdminPrivateCycleRow,
      receipts: (receipts ?? []) as unknown as AdminFollowerExecutionReceiptRow[],
    };
  }

  async listUmbraIdentities(params: {
    deploymentId?: string;
    registrationStatus?: 'pending' | 'confirmed' | 'failed';
    limit?: number;
  }): Promise<AdminUmbraIdentityRow[]> {
    // When filtering by deployment we need to narrow to vault ids that belong
    // to that deployment first.
    let vaultIds: string[] | null = null;
    if (params.deploymentId) {
      const { data: vaults, error } = await this.supabaseService.client
        .from('follower_vaults')
        .select('id')
        .eq('deployment_id', params.deploymentId);
      if (error) {
        this.logger.error('Failed to list vaults for deployment (admin)', error);
        return [];
      }
      vaultIds = (vaults ?? []).map((v: Record<string, unknown>) => v.id as string);
      if (vaultIds.length === 0) return [];
    }

    let q = this.supabaseService.client
      .from('follower_vault_umbra_identities')
      .select(UMBRA_IDENTITY_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(clampLimit(params.limit));
    if (vaultIds) q = q.in('follower_vault_id', vaultIds);
    if (params.registrationStatus) q = q.eq('registration_status', params.registrationStatus);

    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list Umbra identities (admin)', error);
      return [];
    }
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      follower_vault_id: row.follower_vault_id as string,
      signer_pubkey: row.signer_pubkey as string,
      x25519_public_key: (row.x25519_public_key as string | null) ?? null,
      encrypted_user_account: (row.encrypted_user_account as string | null) ?? null,
      registration_status: (row.registration_status as string | null) ?? null,
      register_queue_signature: (row.register_queue_signature as string | null) ?? null,
      register_callback_signature: (row.register_callback_signature as string | null) ?? null,
      derivation_salt_prefix:
        typeof row.derivation_salt === 'string'
          ? `${(row.derivation_salt as string).slice(0, 12)}…`
          : '',
      created_at: row.created_at as string,
    }));
  }

  async listVisibilityGrants(params: {
    subscriptionId?: string;
    granteeWallet?: string;
    status?: 'active' | 'revoked' | 'expired';
    limit?: number;
  }): Promise<AdminVisibilityGrantRow[]> {
    let q = this.supabaseService.client
      .from('follower_visibility_grants')
      .select(GRANT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(clampLimit(params.limit));
    if (params.subscriptionId) q = q.eq('subscription_id', params.subscriptionId);
    if (params.granteeWallet) q = q.eq('grantee_wallet', params.granteeWallet);
    if (params.status) q = q.eq('status', params.status);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list visibility grants (admin)', error);
      return [];
    }
    return (data ?? []) as unknown as AdminVisibilityGrantRow[];
  }
}
