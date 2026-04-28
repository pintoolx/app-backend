import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type FollowerVaultLifecycleStatus =
  | 'pending_funding'
  | 'active'
  | 'paused'
  | 'exiting'
  | 'closed';

export type FollowerVaultCustodyMode = 'program_owned' | 'self_custody' | 'private_payments_relay';

export interface FollowerVaultRow {
  id: string;
  subscription_id: string;
  deployment_id: string;
  vault_pda: string | null;
  authority_pda: string | null;
  lifecycle_status: FollowerVaultLifecycleStatus;
  private_state_ref: string | null;
  public_snapshot_ref: string | null;
  custody_mode: FollowerVaultCustodyMode;
  created_at: string;
  updated_at: string;
}

export interface InsertFollowerVaultInput {
  id?: string;
  subscriptionId: string;
  deploymentId: string;
  vaultPda: string | null;
  authorityPda: string | null;
  custodyMode?: FollowerVaultCustodyMode;
}

export interface UpdateFollowerVaultInput {
  lifecycleStatus?: FollowerVaultLifecycleStatus;
  privateStateRef?: string | null;
  publicSnapshotRef?: string | null;
  custodyMode?: FollowerVaultCustodyMode;
  vaultPda?: string | null;
  authorityPda?: string | null;
}

const COLUMNS = [
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

@Injectable()
export class FollowerVaultsRepository {
  private readonly logger = new Logger(FollowerVaultsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insert(input: InsertFollowerVaultInput): Promise<FollowerVaultRow> {
    const payload: Record<string, unknown> = {
      subscription_id: input.subscriptionId,
      deployment_id: input.deploymentId,
      vault_pda: input.vaultPda,
      authority_pda: input.authorityPda,
      custody_mode: input.custodyMode ?? 'program_owned',
    };
    if (input.id) payload.id = input.id;

    const { data, error } = await this.supabaseService.client
      .from('follower_vaults')
      .insert(payload)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert follower vault', error);
      throw new InternalServerErrorException('Failed to create follower vault');
    }
    return data as unknown as FollowerVaultRow;
  }

  async getBySubscriptionId(subscriptionId: string): Promise<FollowerVaultRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('follower_vaults')
      .select(COLUMNS)
      .eq('subscription_id', subscriptionId)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch follower vault by subscription', error);
      throw new InternalServerErrorException('Failed to fetch follower vault');
    }
    return (data as unknown as FollowerVaultRow) ?? null;
  }

  async getBySubscriptionIdOrThrow(subscriptionId: string): Promise<FollowerVaultRow> {
    const row = await this.getBySubscriptionId(subscriptionId);
    if (!row) throw new NotFoundException('Follower vault not found for subscription');
    return row;
  }

  async listByDeployment(deploymentId: string): Promise<FollowerVaultRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('follower_vaults')
      .select(COLUMNS)
      .eq('deployment_id', deploymentId)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list follower vaults', error);
      throw new InternalServerErrorException('Failed to list follower vaults');
    }
    return (data ?? []) as unknown as FollowerVaultRow[];
  }

  async update(id: string, input: UpdateFollowerVaultInput): Promise<FollowerVaultRow> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.lifecycleStatus !== undefined) updates.lifecycle_status = input.lifecycleStatus;
    if (input.privateStateRef !== undefined) updates.private_state_ref = input.privateStateRef;
    if (input.publicSnapshotRef !== undefined)
      updates.public_snapshot_ref = input.publicSnapshotRef;
    if (input.custodyMode !== undefined) updates.custody_mode = input.custodyMode;
    if (input.vaultPda !== undefined) updates.vault_pda = input.vaultPda;
    if (input.authorityPda !== undefined) updates.authority_pda = input.authorityPda;

    const { data, error } = await this.supabaseService.client
      .from('follower_vaults')
      .update(updates)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to update follower vault', error);
      throw new InternalServerErrorException('Failed to update follower vault');
    }
    return data as unknown as FollowerVaultRow;
  }
}
