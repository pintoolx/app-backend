import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type FollowerReceiptStatus =
  | 'planned'
  | 'applied'
  | 'skipped'
  | 'failed'
  | 'superseded';

export interface FollowerExecutionReceiptRow {
  id: string;
  cycle_id: string;
  subscription_id: string;
  follower_vault_id: string;
  allocation_amount: string | null;
  allocation_pct_bps: number | null;
  private_state_revision: number | null;
  status: FollowerReceiptStatus;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface InsertReceiptInput {
  cycleId: string;
  subscriptionId: string;
  followerVaultId: string;
  allocationAmount?: string | null;
  allocationPctBps?: number | null;
  privateStateRevision?: number | null;
  status?: FollowerReceiptStatus;
  payload?: Record<string, unknown>;
}

const COLUMNS = [
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

@Injectable()
export class FollowerExecutionReceiptsRepository {
  private readonly logger = new Logger(FollowerExecutionReceiptsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insertMany(inputs: InsertReceiptInput[]): Promise<FollowerExecutionReceiptRow[]> {
    if (inputs.length === 0) return [];
    const payload = inputs.map((input) => ({
      cycle_id: input.cycleId,
      subscription_id: input.subscriptionId,
      follower_vault_id: input.followerVaultId,
      allocation_amount: input.allocationAmount ?? null,
      allocation_pct_bps: input.allocationPctBps ?? null,
      private_state_revision: input.privateStateRevision ?? null,
      status: input.status ?? 'planned',
      payload: input.payload ?? {},
    }));
    const { data, error } = await this.supabaseService.client
      .from('follower_execution_receipts')
      .insert(payload)
      .select(COLUMNS);
    if (error || !data) {
      this.logger.error('Failed to insert follower execution receipts', error);
      throw new InternalServerErrorException('Failed to create execution receipts');
    }
    return data as unknown as FollowerExecutionReceiptRow[];
  }

  async listByCycle(cycleId: string): Promise<FollowerExecutionReceiptRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('follower_execution_receipts')
      .select(COLUMNS)
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: true });
    if (error) {
      this.logger.error('Failed to list receipts by cycle', error);
      throw new InternalServerErrorException('Failed to list execution receipts');
    }
    return (data ?? []) as unknown as FollowerExecutionReceiptRow[];
  }

  async updateStatus(
    id: string,
    input: {
      status: FollowerReceiptStatus;
      privateStateRevision?: number | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<FollowerExecutionReceiptRow> {
    const updates: Record<string, unknown> = { status: input.status };
    if (input.privateStateRevision !== undefined) {
      updates.private_state_revision = input.privateStateRevision;
    }
    if (input.payload !== undefined) {
      updates.payload = input.payload;
    }
    const { data, error } = await this.supabaseService.client
      .from('follower_execution_receipts')
      .update(updates)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to update execution receipt', error);
      throw new InternalServerErrorException('Failed to update execution receipt');
    }
    return data as unknown as FollowerExecutionReceiptRow;
  }

  async listLatestForSubscription(
    subscriptionId: string,
    limit = 10,
  ): Promise<FollowerExecutionReceiptRow[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const { data, error } = await this.supabaseService.client
      .from('follower_execution_receipts')
      .select(COLUMNS)
      .eq('subscription_id', subscriptionId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) {
      this.logger.error('Failed to list receipts by subscription', error);
      throw new InternalServerErrorException('Failed to list execution receipts');
    }
    return (data ?? []) as unknown as FollowerExecutionReceiptRow[];
  }

  /**
   * Phase-4 replan flow: mark every non-terminal receipt of a cycle as
   * superseded so a new plan can be applied without losing audit trail.
   * Returns the number of receipts touched.
   */
  async supersedeUnappliedForCycle(cycleId: string): Promise<number> {
    const { data, error } = await this.supabaseService.client
      .from('follower_execution_receipts')
      .update({ status: 'superseded' })
      .eq('cycle_id', cycleId)
      .in('status', ['planned', 'failed'])
      .select('id');
    if (error) {
      this.logger.error('Failed to supersede receipts', error);
      throw new InternalServerErrorException('Failed to supersede receipts');
    }
    return (data ?? []).length;
  }
}
