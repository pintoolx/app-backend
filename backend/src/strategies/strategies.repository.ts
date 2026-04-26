import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { type WorkflowDefinition } from '../web3/workflow-types';
import {
  type CompiledStrategyIR,
  type StrategyPublicMetadata,
} from '../strategy-compiler/strategy-compiler.service';

export type StrategyVisibilityMode = 'private' | 'public';
export type StrategyLifecycleState = 'draft' | 'published' | 'archived';

export interface StrategyRow {
  id: string;
  creator_wallet_address: string;
  source_workflow_id: string | null;
  name: string;
  description: string | null;
  visibility_mode: StrategyVisibilityMode;
  lifecycle_state: StrategyLifecycleState;
  current_version: number;
  public_metadata: StrategyPublicMetadata | Record<string, unknown>;
  compiled_ir: CompiledStrategyIR | null;
  private_definition_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowSummaryRow {
  id: string;
  owner_wallet_address: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  is_public: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface InsertStrategyInput {
  creatorWalletAddress: string;
  sourceWorkflowId: string | null;
  name: string;
  description: string | null;
  visibilityMode: StrategyVisibilityMode;
  publicMetadata: StrategyPublicMetadata;
  compiledIr: CompiledStrategyIR;
}

export interface UpdateStrategyInput {
  name?: string;
  description?: string | null;
  visibilityMode?: StrategyVisibilityMode;
  lifecycleState?: StrategyLifecycleState;
  publicMetadata?: StrategyPublicMetadata;
  compiledIr?: CompiledStrategyIR;
  privateDefinitionRef?: string | null;
  currentVersion?: number;
}

const STRATEGY_COLUMNS =
  'id, creator_wallet_address, source_workflow_id, name, description, visibility_mode, lifecycle_state, current_version, public_metadata, compiled_ir, private_definition_ref, created_at, updated_at';

@Injectable()
export class StrategiesRepository {
  private readonly logger = new Logger(StrategiesRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insertStrategy(input: InsertStrategyInput): Promise<StrategyRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategies')
      .insert({
        creator_wallet_address: input.creatorWalletAddress,
        source_workflow_id: input.sourceWorkflowId,
        name: input.name,
        description: input.description,
        visibility_mode: input.visibilityMode,
        lifecycle_state: 'draft',
        current_version: 0,
        public_metadata: input.publicMetadata,
        compiled_ir: input.compiledIr,
      })
      .select(STRATEGY_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to insert strategy', error);
      throw new InternalServerErrorException('Failed to create strategy');
    }

    return data as StrategyRow;
  }

  async listPublicStrategies(): Promise<StrategyRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('strategies')
      .select(STRATEGY_COLUMNS)
      .eq('visibility_mode', 'public')
      .eq('lifecycle_state', 'published')
      .order('updated_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list public strategies', error);
      throw new InternalServerErrorException('Failed to fetch public strategies');
    }

    return (data ?? []) as StrategyRow[];
  }

  async listStrategiesForCreator(walletAddress: string): Promise<StrategyRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('strategies')
      .select(STRATEGY_COLUMNS)
      .eq('creator_wallet_address', walletAddress)
      .order('updated_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list strategies for creator', error);
      throw new InternalServerErrorException('Failed to fetch strategies for creator');
    }

    return (data ?? []) as StrategyRow[];
  }

  async getStrategyById(id: string): Promise<StrategyRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategies')
      .select(STRATEGY_COLUMNS)
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Strategy not found');
    }

    return data as StrategyRow;
  }

  async getStrategyForCreator(id: string, walletAddress: string): Promise<StrategyRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategies')
      .select(STRATEGY_COLUMNS)
      .eq('id', id)
      .eq('creator_wallet_address', walletAddress)
      .single();

    if (error || !data) {
      throw new NotFoundException('Strategy not found');
    }

    return data as StrategyRow;
  }

  async updateStrategy(
    id: string,
    walletAddress: string,
    input: UpdateStrategyInput,
  ): Promise<StrategyRow> {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.visibilityMode !== undefined) updates.visibility_mode = input.visibilityMode;
    if (input.lifecycleState !== undefined) updates.lifecycle_state = input.lifecycleState;
    if (input.publicMetadata !== undefined) updates.public_metadata = input.publicMetadata;
    if (input.compiledIr !== undefined) updates.compiled_ir = input.compiledIr;
    if (input.privateDefinitionRef !== undefined)
      updates.private_definition_ref = input.privateDefinitionRef;
    if (input.currentVersion !== undefined) updates.current_version = input.currentVersion;

    const { data, error } = await this.supabaseService.client
      .from('strategies')
      .update(updates)
      .eq('id', id)
      .eq('creator_wallet_address', walletAddress)
      .select(STRATEGY_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to update strategy', error);
      throw new InternalServerErrorException('Failed to update strategy');
    }

    return data as StrategyRow;
  }

  async getWorkflowForCreator(
    workflowId: string,
    walletAddress: string,
  ): Promise<WorkflowSummaryRow> {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .select(
        'id, owner_wallet_address, name, description, definition, is_public, created_at, updated_at',
      )
      .eq('id', workflowId)
      .eq('owner_wallet_address', walletAddress)
      .single();

    if (error || !data) {
      throw new NotFoundException('Source workflow not found');
    }

    return data as WorkflowSummaryRow;
  }

  async upsertTelegramMapping(walletAddress: string, chatId: string): Promise<void> {
    const { error } = await this.supabaseService.client.from('telegram_mappings').upsert({
      wallet_address: walletAddress,
      chat_id: chatId,
      notifications_enabled: true,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw new InternalServerErrorException('Failed to link Telegram chat to strategy');
    }
  }
}
