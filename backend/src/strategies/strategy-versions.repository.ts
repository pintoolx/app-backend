import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { type CompiledStrategyIR } from '../strategy-compiler/strategy-compiler.service';

export type StrategyVersionStatus = 'published' | 'deprecated';

export interface StrategyVersionRow {
  id: string;
  strategy_id: string;
  version: number;
  public_metadata_hash: string;
  private_definition_commitment: string;
  compiled_ir: CompiledStrategyIR;
  status: StrategyVersionStatus;
  published_at: string;
}

export interface InsertVersionInput {
  strategyId: string;
  version: number;
  publicMetadataHash: string;
  privateDefinitionCommitment: string;
  compiledIr: CompiledStrategyIR;
}

const VERSION_COLUMNS =
  'id, strategy_id, version, public_metadata_hash, private_definition_commitment, compiled_ir, status, published_at';

@Injectable()
export class StrategyVersionsRepository {
  private readonly logger = new Logger(StrategyVersionsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insertVersion(input: InsertVersionInput): Promise<StrategyVersionRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_versions')
      .insert({
        strategy_id: input.strategyId,
        version: input.version,
        public_metadata_hash: input.publicMetadataHash,
        private_definition_commitment: input.privateDefinitionCommitment,
        compiled_ir: input.compiledIr,
        status: 'published',
      })
      .select(VERSION_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to insert strategy version', error);
      throw new InternalServerErrorException('Failed to insert strategy version');
    }

    return data as StrategyVersionRow;
  }

  async getLatestPublished(strategyId: string): Promise<StrategyVersionRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_versions')
      .select(VERSION_COLUMNS)
      .eq('strategy_id', strategyId)
      .eq('status', 'published')
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      throw new NotFoundException('No published version for strategy');
    }
    return data as StrategyVersionRow;
  }

  async getById(versionId: string): Promise<StrategyVersionRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_versions')
      .select(VERSION_COLUMNS)
      .eq('id', versionId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Strategy version not found');
    }
    return data as StrategyVersionRow;
  }
}
