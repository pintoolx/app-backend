import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

const STRATEGY_LIST_COLUMNS =
  'id, creator_wallet_address, name, description, visibility_mode, lifecycle_state, current_version, created_at, updated_at';

const STRATEGY_DETAIL_COLUMNS =
  'id, creator_wallet_address, source_workflow_id, name, description, visibility_mode, lifecycle_state, current_version, public_metadata, private_definition_ref, created_at, updated_at';

const VERSION_COLUMNS =
  'id, strategy_id, version, public_metadata_hash, private_definition_commitment, status, published_at';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AdminStrategiesService {
  private readonly logger = new Logger(AdminStrategiesService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async listStrategies(params: {
    lifecycle?: 'draft' | 'published' | 'archived';
    visibility?: 'public' | 'private';
    creator?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    let q = this.supabaseService.client
      .from('strategies')
      .select(STRATEGY_LIST_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (params.lifecycle) q = q.eq('lifecycle_state', params.lifecycle);
    if (params.visibility) q = q.eq('visibility_mode', params.visibility);
    if (params.creator) q = q.eq('creator_wallet_address', params.creator);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list strategies (admin)', error);
      return [];
    }
    return data ?? [];
  }

  async getStrategyDetail(id: string) {
    const { data: row, error } = await this.supabaseService.client
      .from('strategies')
      .select(STRATEGY_DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error || !row) {
      throw new NotFoundException('Strategy not found');
    }
    const { data: versions } = await this.supabaseService.client
      .from('strategy_versions')
      .select(VERSION_COLUMNS)
      .eq('strategy_id', id)
      .order('version', { ascending: false });
    return { ...row, versions: versions ?? [] };
  }
}
