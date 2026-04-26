import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type DeploymentLifecycleStatus = 'draft' | 'deployed' | 'paused' | 'stopped' | 'closed';

export type DeploymentExecutionMode = 'offchain' | 'er' | 'per';
export type DeploymentTreasuryMode = 'public' | 'private_payments' | 'umbra';

export type UmbraRegistrationStatus = 'pending' | 'confirmed' | 'failed';

export interface StrategyDeploymentRow {
  id: string;
  strategy_id: string;
  strategy_version_id: string | null;
  creator_wallet_address: string;
  account_id: string | null;
  execution_mode: DeploymentExecutionMode;
  treasury_mode: DeploymentTreasuryMode;
  lifecycle_status: DeploymentLifecycleStatus;
  state_revision: number;
  private_state_account: string | null;
  public_snapshot_account: string | null;
  er_session_id: string | null;
  per_session_id: string | null;
  umbra_user_account: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Week 4 privacy adapter columns (nullable; populated only when ER / Umbra
  // are active for the deployment).
  er_delegate_signature: string | null;
  er_undelegate_signature: string | null;
  er_router_url: string | null;
  er_committed_at: string | null;
  umbra_x25519_pubkey: string | null;
  umbra_signer_pubkey: string | null;
  umbra_registration_status: UmbraRegistrationStatus | null;
  umbra_register_queue_signature: string | null;
  umbra_register_callback_signature: string | null;
  umbra_master_seed_ref: string | null;
  // Week 5 PER + Private Payments tracking (nullable).
  per_endpoint_url: string | null;
  pp_session_id: string | null;
  pp_endpoint_url: string | null;
}

export interface InsertDeploymentInput {
  /** Optional client-generated UUID. When omitted Postgres generates one. */
  id?: string;
  strategyId: string;
  strategyVersionId: string | null;
  creatorWalletAddress: string;
  accountId: string;
  executionMode: DeploymentExecutionMode;
  treasuryMode: DeploymentTreasuryMode;
  lifecycleStatus: DeploymentLifecycleStatus;
  privateStateAccount: string | null;
  publicSnapshotAccount: string | null;
  metadata: Record<string, unknown>;
}

export interface UpdateDeploymentInput {
  lifecycleStatus?: DeploymentLifecycleStatus;
  stateRevision?: number;
  privateStateAccount?: string | null;
  publicSnapshotAccount?: string | null;
  erSessionId?: string | null;
  perSessionId?: string | null;
  umbraUserAccount?: string | null;
  metadata?: Record<string, unknown>;
  erDelegateSignature?: string | null;
  erUndelegateSignature?: string | null;
  erRouterUrl?: string | null;
  erCommittedAt?: string | null;
  umbraX25519Pubkey?: string | null;
  umbraSignerPubkey?: string | null;
  umbraRegistrationStatus?: UmbraRegistrationStatus | null;
  umbraRegisterQueueSignature?: string | null;
  umbraRegisterCallbackSignature?: string | null;
  umbraMasterSeedRef?: string | null;
  perEndpointUrl?: string | null;
  ppSessionId?: string | null;
  ppEndpointUrl?: string | null;
}

const DEPLOYMENT_COLUMNS = [
  'id',
  'strategy_id',
  'strategy_version_id',
  'creator_wallet_address',
  'account_id',
  'execution_mode',
  'treasury_mode',
  'lifecycle_status',
  'state_revision',
  'private_state_account',
  'public_snapshot_account',
  'er_session_id',
  'per_session_id',
  'umbra_user_account',
  'metadata',
  'created_at',
  'updated_at',
  'er_delegate_signature',
  'er_undelegate_signature',
  'er_router_url',
  'er_committed_at',
  'umbra_x25519_pubkey',
  'umbra_signer_pubkey',
  'umbra_registration_status',
  'umbra_register_queue_signature',
  'umbra_register_callback_signature',
  'umbra_master_seed_ref',
  'per_endpoint_url',
  'pp_session_id',
  'pp_endpoint_url',
].join(', ');

@Injectable()
export class StrategyDeploymentsRepository {
  private readonly logger = new Logger(StrategyDeploymentsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insertDeployment(input: InsertDeploymentInput): Promise<StrategyDeploymentRow> {
    const insertPayload: Record<string, unknown> = {
      strategy_id: input.strategyId,
      strategy_version_id: input.strategyVersionId,
      creator_wallet_address: input.creatorWalletAddress,
      account_id: input.accountId,
      execution_mode: input.executionMode,
      treasury_mode: input.treasuryMode,
      lifecycle_status: input.lifecycleStatus,
      private_state_account: input.privateStateAccount,
      public_snapshot_account: input.publicSnapshotAccount,
      metadata: input.metadata,
    };
    if (input.id) {
      insertPayload.id = input.id;
    }
    const { data, error } = await this.supabaseService.client
      .from('strategy_deployments')
      .insert(insertPayload)
      .select(DEPLOYMENT_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to insert strategy deployment', error);
      throw new InternalServerErrorException('Failed to create strategy deployment');
    }

    return data as unknown as StrategyDeploymentRow;
  }

  async getById(id: string): Promise<StrategyDeploymentRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_deployments')
      .select(DEPLOYMENT_COLUMNS)
      .eq('id', id)
      .single();
    if (error || !data) {
      throw new NotFoundException('Deployment not found');
    }
    return data as unknown as StrategyDeploymentRow;
  }

  async getForCreator(id: string, walletAddress: string): Promise<StrategyDeploymentRow> {
    const row = await this.getById(id);
    if (row.creator_wallet_address !== walletAddress) {
      throw new ForbiddenException('Deployment does not belong to the authenticated wallet');
    }
    return row;
  }

  async listForCreator(walletAddress: string): Promise<StrategyDeploymentRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_deployments')
      .select(DEPLOYMENT_COLUMNS)
      .eq('creator_wallet_address', walletAddress)
      .order('updated_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list deployments for creator', error);
      throw new InternalServerErrorException('Failed to list deployments');
    }
    return (data ?? []) as unknown as StrategyDeploymentRow[];
  }

  async updateDeployment(
    id: string,
    walletAddress: string,
    input: UpdateDeploymentInput,
  ): Promise<StrategyDeploymentRow> {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.lifecycleStatus !== undefined) updates.lifecycle_status = input.lifecycleStatus;
    if (input.stateRevision !== undefined) updates.state_revision = input.stateRevision;
    if (input.privateStateAccount !== undefined)
      updates.private_state_account = input.privateStateAccount;
    if (input.publicSnapshotAccount !== undefined)
      updates.public_snapshot_account = input.publicSnapshotAccount;
    if (input.erSessionId !== undefined) updates.er_session_id = input.erSessionId;
    if (input.perSessionId !== undefined) updates.per_session_id = input.perSessionId;
    if (input.umbraUserAccount !== undefined) updates.umbra_user_account = input.umbraUserAccount;
    if (input.metadata !== undefined) updates.metadata = input.metadata;
    if (input.erDelegateSignature !== undefined)
      updates.er_delegate_signature = input.erDelegateSignature;
    if (input.erUndelegateSignature !== undefined)
      updates.er_undelegate_signature = input.erUndelegateSignature;
    if (input.erRouterUrl !== undefined) updates.er_router_url = input.erRouterUrl;
    if (input.erCommittedAt !== undefined) updates.er_committed_at = input.erCommittedAt;
    if (input.umbraX25519Pubkey !== undefined)
      updates.umbra_x25519_pubkey = input.umbraX25519Pubkey;
    if (input.umbraSignerPubkey !== undefined)
      updates.umbra_signer_pubkey = input.umbraSignerPubkey;
    if (input.umbraRegistrationStatus !== undefined)
      updates.umbra_registration_status = input.umbraRegistrationStatus;
    if (input.umbraRegisterQueueSignature !== undefined)
      updates.umbra_register_queue_signature = input.umbraRegisterQueueSignature;
    if (input.umbraRegisterCallbackSignature !== undefined)
      updates.umbra_register_callback_signature = input.umbraRegisterCallbackSignature;
    if (input.umbraMasterSeedRef !== undefined)
      updates.umbra_master_seed_ref = input.umbraMasterSeedRef;
    if (input.perEndpointUrl !== undefined) updates.per_endpoint_url = input.perEndpointUrl;
    if (input.ppSessionId !== undefined) updates.pp_session_id = input.ppSessionId;
    if (input.ppEndpointUrl !== undefined) updates.pp_endpoint_url = input.ppEndpointUrl;

    const { data, error } = await this.supabaseService.client
      .from('strategy_deployments')
      .update(updates)
      .eq('id', id)
      .eq('creator_wallet_address', walletAddress)
      .select(DEPLOYMENT_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to update strategy deployment', error);
      throw new InternalServerErrorException('Failed to update deployment');
    }
    return data as unknown as StrategyDeploymentRow;
  }

  async assertAccountOwnership(accountId: string, walletAddress: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('accounts')
      .select('id, owner_wallet_address, status')
      .eq('id', accountId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Account not found');
    }
    if (data.owner_wallet_address !== walletAddress) {
      throw new ForbiddenException('Account does not belong to the authenticated wallet');
    }
    if (data.status === 'closed') {
      throw new ForbiddenException('Account is closed and cannot host a new deployment');
    }
  }
}
