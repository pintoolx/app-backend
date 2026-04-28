import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type VisibilityGrantScope =
  | 'vault-balance'
  | 'vault-state'
  | 'metrics-window'
  | 'auditor-window'
  | 'creator-only'
  | 'subscriber-self'
  | 'coarse-public';

export type VisibilityGrantStatus = 'active' | 'revoked' | 'expired';

export interface FollowerVisibilityGrantRow {
  id: string;
  subscription_id: string;
  grantee_wallet: string;
  scope: VisibilityGrantScope;
  status: VisibilityGrantStatus;
  expires_at: string | null;
  revoked_at: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface InsertVisibilityGrantInput {
  subscriptionId: string;
  granteeWallet: string;
  scope: VisibilityGrantScope;
  expiresAt?: string | null;
  payload?: Record<string, unknown>;
}

const COLUMNS = [
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

@Injectable()
export class FollowerVisibilityGrantsRepository {
  private readonly logger = new Logger(FollowerVisibilityGrantsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insert(input: InsertVisibilityGrantInput): Promise<FollowerVisibilityGrantRow> {
    const { data, error } = await this.supabaseService.client
      .from('follower_visibility_grants')
      .insert({
        subscription_id: input.subscriptionId,
        grantee_wallet: input.granteeWallet,
        scope: input.scope,
        expires_at: input.expiresAt ?? null,
        payload: input.payload ?? {},
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert visibility grant', error);
      throw new InternalServerErrorException('Failed to create visibility grant');
    }
    return data as unknown as FollowerVisibilityGrantRow;
  }

  async getById(id: string): Promise<FollowerVisibilityGrantRow> {
    const { data, error } = await this.supabaseService.client
      .from('follower_visibility_grants')
      .select(COLUMNS)
      .eq('id', id)
      .single();
    if (error || !data) {
      throw new NotFoundException('Visibility grant not found');
    }
    return data as unknown as FollowerVisibilityGrantRow;
  }

  async listBySubscription(subscriptionId: string): Promise<FollowerVisibilityGrantRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('follower_visibility_grants')
      .select(COLUMNS)
      .eq('subscription_id', subscriptionId)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list visibility grants', error);
      throw new InternalServerErrorException('Failed to list visibility grants');
    }
    return (data ?? []) as unknown as FollowerVisibilityGrantRow[];
  }

  async revoke(id: string): Promise<FollowerVisibilityGrantRow> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabaseService.client
      .from('follower_visibility_grants')
      .update({ status: 'revoked', revoked_at: now, updated_at: now })
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to revoke visibility grant', error);
      throw new InternalServerErrorException('Failed to revoke visibility grant');
    }
    return data as unknown as FollowerVisibilityGrantRow;
  }
}
