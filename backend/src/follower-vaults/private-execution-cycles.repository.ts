import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type PrivateExecutionCycleStatus = 'accepted' | 'running' | 'completed' | 'failed';

export interface PrivateExecutionCycleRow {
  id: string;
  deployment_id: string;
  idempotency_key: string;
  trigger_type: string;
  trigger_ref: string | null;
  status: PrivateExecutionCycleStatus;
  metrics_summary: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface InsertCycleInput {
  id?: string;
  deploymentId: string;
  idempotencyKey: string;
  triggerType: string;
  triggerRef?: string | null;
  status?: PrivateExecutionCycleStatus;
}

export interface UpdateCycleInput {
  status?: PrivateExecutionCycleStatus;
  metricsSummary?: Record<string, unknown>;
  completedAt?: string | null;
  errorMessage?: string | null;
}

const COLUMNS = [
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

@Injectable()
export class PrivateExecutionCyclesRepository {
  private readonly logger = new Logger(PrivateExecutionCyclesRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insert(input: InsertCycleInput): Promise<PrivateExecutionCycleRow> {
    const payload: Record<string, unknown> = {
      deployment_id: input.deploymentId,
      idempotency_key: input.idempotencyKey,
      trigger_type: input.triggerType,
      trigger_ref: input.triggerRef ?? null,
      status: input.status ?? 'accepted',
    };
    if (input.id) payload.id = input.id;

    const { data, error } = await this.supabaseService.client
      .from('private_execution_cycles')
      .insert(payload)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert private execution cycle', error);
      throw new InternalServerErrorException('Failed to create execution cycle');
    }
    return data as unknown as PrivateExecutionCycleRow;
  }

  async getByIdAndDeployment(
    deploymentId: string,
    cycleId: string,
  ): Promise<PrivateExecutionCycleRow> {
    const { data, error } = await this.supabaseService.client
      .from('private_execution_cycles')
      .select(COLUMNS)
      .eq('deployment_id', deploymentId)
      .eq('id', cycleId)
      .single();
    if (error || !data) {
      throw new NotFoundException('Execution cycle not found');
    }
    return data as unknown as PrivateExecutionCycleRow;
  }

  async getByIdempotencyKey(
    deploymentId: string,
    idempotencyKey: string,
  ): Promise<PrivateExecutionCycleRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('private_execution_cycles')
      .select(COLUMNS)
      .eq('deployment_id', deploymentId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch cycle by idempotency key', error);
      throw new InternalServerErrorException('Failed to fetch execution cycle');
    }
    return (data as unknown as PrivateExecutionCycleRow) ?? null;
  }

  async listByDeployment(deploymentId: string, limit = 50): Promise<PrivateExecutionCycleRow[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const { data, error } = await this.supabaseService.client
      .from('private_execution_cycles')
      .select(COLUMNS)
      .eq('deployment_id', deploymentId)
      .order('started_at', { ascending: false })
      .limit(safeLimit);
    if (error) {
      this.logger.error('Failed to list execution cycles', error);
      throw new InternalServerErrorException('Failed to list execution cycles');
    }
    return (data ?? []) as unknown as PrivateExecutionCycleRow[];
  }

  async update(id: string, input: UpdateCycleInput): Promise<PrivateExecutionCycleRow> {
    const updates: Record<string, unknown> = {};
    if (input.status !== undefined) updates.status = input.status;
    if (input.metricsSummary !== undefined) updates.metrics_summary = input.metricsSummary;
    if (input.completedAt !== undefined) updates.completed_at = input.completedAt;
    if (input.errorMessage !== undefined) updates.error_message = input.errorMessage;

    const { data, error } = await this.supabaseService.client
      .from('private_execution_cycles')
      .update(updates)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to update execution cycle', error);
      throw new InternalServerErrorException('Failed to update execution cycle');
    }
    return data as unknown as PrivateExecutionCycleRow;
  }
}
