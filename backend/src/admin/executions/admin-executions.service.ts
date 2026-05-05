import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

export interface AdminExecutionRow {
  id: string;
  workflow_id: string;
  account_id: string | null;
  owner_wallet_address: string;
  status: string;
  trigger_type: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ExecutionQuery {
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  wallet?: string;
  workflowId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AdminExecutionsService {
  private readonly logger = new Logger(AdminExecutionsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async listExecutions(query: ExecutionQuery): Promise<AdminExecutionRow[]> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    let q = this.supabaseService.client
      .from('workflow_executions')
      .select(
        'id, workflow_id, account_id, owner_wallet_address, status, trigger_type, started_at, completed_at, duration_ms, error_message, metadata',
      )
      .order('started_at', { ascending: false })
      .limit(limit);

    if (query.status) q = q.eq('status', query.status);
    if (query.wallet) q = q.eq('owner_wallet_address', query.wallet);
    if (query.workflowId) q = q.eq('workflow_id', query.workflowId);

    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list workflow executions', error);
      return [];
    }
    return (data ?? []) as unknown as AdminExecutionRow[];
  }
}
