import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

const DEPLOYMENT_LIST_COLUMNS =
  'id, strategy_id, creator_wallet_address, account_id, execution_mode, treasury_mode, lifecycle_status, state_revision, created_at, updated_at';

const DEPLOYMENT_DETAIL_COLUMNS =
  'id, strategy_id, strategy_version_id, creator_wallet_address, account_id, execution_mode, treasury_mode, lifecycle_status, state_revision, private_state_account, public_snapshot_account, er_session_id, per_session_id, umbra_user_account, metadata, created_at, updated_at, er_router_url, er_committed_at, umbra_registration_status, per_endpoint_url, pp_endpoint_url';

const RUN_COLUMNS =
  'id, deployment_id, execution_layer, status, started_at, completed_at, error_message';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AdminDeploymentsService {
  private readonly logger = new Logger(AdminDeploymentsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async listDeployments(params: {
    status?: 'draft' | 'deployed' | 'paused' | 'stopped' | 'closed';
    creator?: string;
    strategyId?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    let q = this.supabaseService.client
      .from('strategy_deployments')
      .select(DEPLOYMENT_LIST_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (params.status) q = q.eq('lifecycle_status', params.status);
    if (params.creator) q = q.eq('creator_wallet_address', params.creator);
    if (params.strategyId) q = q.eq('strategy_id', params.strategyId);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list deployments (admin)', error);
      return [];
    }
    return data ?? [];
  }

  async getDeploymentDetail(id: string) {
    const { data: row, error } = await this.supabaseService.client
      .from('strategy_deployments')
      .select(DEPLOYMENT_DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error || !row) {
      throw new NotFoundException('Deployment not found');
    }
    const { data: runs } = await this.supabaseService.client
      .from('strategy_runs')
      .select(RUN_COLUMNS)
      .eq('deployment_id', id)
      .order('started_at', { ascending: false })
      .limit(20);
    return { ...row, recentRuns: runs ?? [] };
  }
}
