import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type StrategyRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ExecutionLayer = 'offchain' | 'er' | 'per';

export interface StrategyRunRow {
  id: string;
  deployment_id: string;
  strategy_version_id: string | null;
  execution_layer: ExecutionLayer;
  status: StrategyRunStatus;
  public_outcome: Record<string, unknown>;
  private_state_ref: string | null;
  er_session_id: string | null;
  per_session_id: string | null;
  workflow_execution_id: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface InsertStrategyRunInput {
  deploymentId: string;
  strategyVersionId?: string | null;
  executionLayer: ExecutionLayer;
  publicOutcome?: Record<string, unknown>;
}

export interface UpdateStrategyRunInput {
  status?: StrategyRunStatus;
  publicOutcome?: Record<string, unknown>;
  privateStateRef?: string | null;
  erSessionId?: string | null;
  perSessionId?: string | null;
  workflowExecutionId?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
}

const RUN_COLUMNS = [
  'id',
  'deployment_id',
  'strategy_version_id',
  'execution_layer',
  'status',
  'public_outcome',
  'private_state_ref',
  'er_session_id',
  'per_session_id',
  'workflow_execution_id',
  'started_at',
  'completed_at',
  'error_message',
].join(', ');

@Injectable()
export class StrategyRunsRepository {
  private readonly logger = new Logger(StrategyRunsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insertRun(input: InsertStrategyRunInput): Promise<StrategyRunRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_runs')
      .insert({
        deployment_id: input.deploymentId,
        strategy_version_id: input.strategyVersionId ?? null,
        execution_layer: input.executionLayer,
        status: 'pending',
        public_outcome: input.publicOutcome ?? {},
      })
      .select(RUN_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to insert strategy run', error);
      throw new InternalServerErrorException('Failed to create strategy run');
    }
    return data as unknown as StrategyRunRow;
  }

  async getById(id: string): Promise<StrategyRunRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_runs')
      .select(RUN_COLUMNS)
      .eq('id', id)
      .single();

    if (error) {
      this.logger.warn(`Failed to get strategy run ${id}: ${error.message}`);
      return null;
    }
    return data as unknown as StrategyRunRow | null;
  }

  async updateRun(id: string, input: UpdateStrategyRunInput): Promise<StrategyRunRow> {
    const updates: Record<string, unknown> = {};
    if (input.status !== undefined) updates.status = input.status;
    if (input.publicOutcome !== undefined) updates.public_outcome = input.publicOutcome;
    if (input.privateStateRef !== undefined) updates.private_state_ref = input.privateStateRef;
    if (input.erSessionId !== undefined) updates.er_session_id = input.erSessionId;
    if (input.perSessionId !== undefined) updates.per_session_id = input.perSessionId;
    if (input.workflowExecutionId !== undefined)
      updates.workflow_execution_id = input.workflowExecutionId;
    if (input.completedAt !== undefined) updates.completed_at = input.completedAt;
    if (input.errorMessage !== undefined) updates.error_message = input.errorMessage;

    const { data, error } = await this.supabaseService.client
      .from('strategy_runs')
      .update(updates)
      .eq('id', id)
      .select(RUN_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update strategy run ${id}`, error);
      throw new InternalServerErrorException('Failed to update strategy run');
    }
    return data as unknown as StrategyRunRow;
  }

  async listByDeployment(deploymentId: string, limit = 50): Promise<StrategyRunRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_runs')
      .select(RUN_COLUMNS)
      .eq('deployment_id', deploymentId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error('Failed to list strategy runs', error);
      throw new InternalServerErrorException('Failed to list strategy runs');
    }
    return (data ?? []) as unknown as StrategyRunRow[];
  }
}
