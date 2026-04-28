import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type SubscriptionStatus = 'pending_funding' | 'active' | 'paused' | 'exiting' | 'closed';

export type AllocationMode = 'proportional' | 'fixed' | 'mirror';

export interface StrategySubscriptionRow {
  id: string;
  deployment_id: string;
  follower_wallet: string;
  subscription_pda: string | null;
  follower_vault_pda: string | null;
  vault_authority_pda: string | null;
  status: SubscriptionStatus;
  visibility_preset: string;
  max_capital: string | null;
  allocation_mode: AllocationMode;
  max_drawdown_bps: number | null;
  per_member_ref: string | null;
  umbra_identity_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertSubscriptionInput {
  id?: string;
  deploymentId: string;
  followerWallet: string;
  subscriptionPda: string | null;
  followerVaultPda: string | null;
  vaultAuthorityPda: string | null;
  visibilityPreset?: string;
  maxCapital?: string | null;
  allocationMode?: AllocationMode;
  maxDrawdownBps?: number | null;
  perMemberRef?: string | null;
}

export interface UpdateSubscriptionInput {
  status?: SubscriptionStatus;
  visibilityPreset?: string;
  maxCapital?: string | null;
  allocationMode?: AllocationMode;
  maxDrawdownBps?: number | null;
  perMemberRef?: string | null;
  umbraIdentityRef?: string | null;
  subscriptionPda?: string | null;
  followerVaultPda?: string | null;
  vaultAuthorityPda?: string | null;
}

const COLUMNS = [
  'id',
  'deployment_id',
  'follower_wallet',
  'subscription_pda',
  'follower_vault_pda',
  'vault_authority_pda',
  'status',
  'visibility_preset',
  'max_capital',
  'allocation_mode',
  'max_drawdown_bps',
  'per_member_ref',
  'umbra_identity_ref',
  'created_at',
  'updated_at',
].join(', ');

@Injectable()
export class StrategySubscriptionsRepository {
  private readonly logger = new Logger(StrategySubscriptionsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insert(input: InsertSubscriptionInput): Promise<StrategySubscriptionRow> {
    const payload: Record<string, unknown> = {
      deployment_id: input.deploymentId,
      follower_wallet: input.followerWallet,
      subscription_pda: input.subscriptionPda,
      follower_vault_pda: input.followerVaultPda,
      vault_authority_pda: input.vaultAuthorityPda,
      visibility_preset: input.visibilityPreset ?? 'subscriber-self',
      max_capital: input.maxCapital ?? null,
      allocation_mode: input.allocationMode ?? 'proportional',
      max_drawdown_bps: input.maxDrawdownBps ?? null,
      per_member_ref: input.perMemberRef ?? null,
    };
    if (input.id) payload.id = input.id;

    const { data, error } = await this.supabaseService.client
      .from('strategy_subscriptions')
      .insert(payload)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert strategy subscription', error);
      throw new InternalServerErrorException('Failed to create subscription');
    }
    return data as unknown as StrategySubscriptionRow;
  }

  async getById(id: string): Promise<StrategySubscriptionRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_subscriptions')
      .select(COLUMNS)
      .eq('id', id)
      .single();
    if (error || !data) {
      throw new NotFoundException('Subscription not found');
    }
    return data as unknown as StrategySubscriptionRow;
  }

  async getForFollower(id: string, walletAddress: string): Promise<StrategySubscriptionRow> {
    const row = await this.getById(id);
    if (row.follower_wallet !== walletAddress) {
      throw new ForbiddenException('Subscription does not belong to the authenticated follower');
    }
    return row;
  }

  async getByDeploymentAndFollower(
    deploymentId: string,
    followerWallet: string,
  ): Promise<StrategySubscriptionRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_subscriptions')
      .select(COLUMNS)
      .eq('deployment_id', deploymentId)
      .eq('follower_wallet', followerWallet)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch subscription', error);
      throw new InternalServerErrorException('Failed to fetch subscription');
    }
    return (data as unknown as StrategySubscriptionRow) ?? null;
  }

  async listByDeployment(deploymentId: string): Promise<StrategySubscriptionRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_subscriptions')
      .select(COLUMNS)
      .eq('deployment_id', deploymentId)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list subscriptions', error);
      throw new InternalServerErrorException('Failed to list subscriptions');
    }
    return (data ?? []) as unknown as StrategySubscriptionRow[];
  }

  async listActiveByDeployment(deploymentId: string): Promise<StrategySubscriptionRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_subscriptions')
      .select(COLUMNS)
      .eq('deployment_id', deploymentId)
      .eq('status', 'active');
    if (error) {
      this.logger.error('Failed to list active subscriptions', error);
      throw new InternalServerErrorException('Failed to list active subscriptions');
    }
    return (data ?? []) as unknown as StrategySubscriptionRow[];
  }

  async update(id: string, input: UpdateSubscriptionInput): Promise<StrategySubscriptionRow> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.status !== undefined) updates.status = input.status;
    if (input.visibilityPreset !== undefined) updates.visibility_preset = input.visibilityPreset;
    if (input.maxCapital !== undefined) updates.max_capital = input.maxCapital;
    if (input.allocationMode !== undefined) updates.allocation_mode = input.allocationMode;
    if (input.maxDrawdownBps !== undefined) updates.max_drawdown_bps = input.maxDrawdownBps;
    if (input.perMemberRef !== undefined) updates.per_member_ref = input.perMemberRef;
    if (input.umbraIdentityRef !== undefined) updates.umbra_identity_ref = input.umbraIdentityRef;
    if (input.subscriptionPda !== undefined) updates.subscription_pda = input.subscriptionPda;
    if (input.followerVaultPda !== undefined) updates.follower_vault_pda = input.followerVaultPda;
    if (input.vaultAuthorityPda !== undefined)
      updates.vault_authority_pda = input.vaultAuthorityPda;

    const { data, error } = await this.supabaseService.client
      .from('strategy_subscriptions')
      .update(updates)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to update subscription', error);
      throw new InternalServerErrorException('Failed to update subscription');
    }
    return data as unknown as StrategySubscriptionRow;
  }
}
