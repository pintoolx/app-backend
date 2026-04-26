import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { WorkflowExecutorFactory } from './workflow-executor.factory';
import { WorkflowDefinition } from '../web3/workflow-types';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    @Inject(forwardRef(() => SupabaseService))
    private supabaseService: SupabaseService,
    private executorFactory: WorkflowExecutorFactory,
  ) {}

  private inflightExecutionKeys = new Set<string>();

  private validateWorkflowDefinition(definition: any): void {
    if (!definition || typeof definition !== 'object') {
      throw new BadRequestException('Workflow definition must be a non-null object');
    }
    if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
      throw new BadRequestException('Workflow definition must contain a non-empty nodes array');
    }
    for (const node of definition.nodes) {
      if (typeof node.id !== 'string' || !node.id) {
        throw new BadRequestException('Each workflow node must have a non-empty string "id"');
      }
      if (typeof node.name !== 'string' || !node.name) {
        throw new BadRequestException('Each workflow node must have a non-empty string "name"');
      }
      if (typeof node.type !== 'string' || !node.type) {
        throw new BadRequestException('Each workflow node must have a non-empty string "type"');
      }
    }
    if (
      definition.connections !== undefined &&
      (typeof definition.connections !== 'object' ||
        definition.connections === null ||
        Array.isArray(definition.connections))
    ) {
      throw new BadRequestException('Workflow connections must be an object');
    }
  }

  private buildExecutionKey(workflowId: string, walletAddress: string, accountId?: string) {
    return `${workflowId}:${walletAddress}:${accountId ?? 'none'}`;
  }

  private async findRunningExecution(
    workflowId: string,
    walletAddress: string,
    accountId?: string,
  ) {
    const query = this.supabaseService.client
      .from('workflow_executions')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('owner_wallet_address', walletAddress)
      .eq('status', 'running');

    if (accountId) {
      query.eq('account_id', accountId);
    } else {
      query.is('account_id', null);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
    if (error) {
      return null;
    }
    return data?.[0] ?? null;
  }

  private async getWorkflow(id: string, walletAddress: string) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .select('*')
      .eq('id', id)
      .eq('owner_wallet_address', walletAddress)
      .single();

    if (error || !data) {
      throw new NotFoundException('Workflow not found');
    }

    return data;
  }

  async createWorkflow(
    ownerWalletAddress: string,
    dto: {
      name: string;
      description?: string;
      definition: any;
      isPublic?: boolean;
      telegramChatId?: string;
    },
  ) {
    this.validateWorkflowDefinition(dto.definition);

    if (dto.telegramChatId) {
      await this.upsertTelegramMapping(ownerWalletAddress, dto.telegramChatId);
    }

    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .insert({
        owner_wallet_address: ownerWalletAddress,
        name: dto.name,
        description: dto.description,
        definition: dto.definition,
        is_public: dto.isPublic ?? false,
      })
      .select()
      .single();

    if (error || !data) {
      throw new InternalServerErrorException('Failed to create workflow');
    }

    return data;
  }

  private async upsertTelegramMapping(walletAddress: string, chatId: string): Promise<void> {
    const { error } = await this.supabaseService.client.from('telegram_mappings').upsert({
      wallet_address: walletAddress,
      chat_id: chatId,
      notifications_enabled: true,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw new InternalServerErrorException('Failed to link Telegram chat to workflow');
    }
  }

  async executeWorkflow(id: string, walletAddress: string, executeDto: any) {
    const workflow = await this.getWorkflow(id, walletAddress);

    this.logger.log(`Executing workflow: ${workflow.name}`);

    const executionKey = this.buildExecutionKey(id, walletAddress, executeDto.accountId);
    const runningExecution = await this.findRunningExecution(
      id,
      walletAddress,
      executeDto.accountId,
    );
    if (runningExecution) {
      return runningExecution;
    }
    if (this.inflightExecutionKeys.has(executionKey)) {
      const inflightExecution = await this.findRunningExecution(
        id,
        walletAddress,
        executeDto.accountId,
      );
      if (inflightExecution) {
        return inflightExecution;
      }
    }
    this.inflightExecutionKeys.add(executionKey);

    // Create execution record
    const { data: execution, error } = await this.supabaseService.client
      .from('workflow_executions')
      .insert({
        workflow_id: id,
        owner_wallet_address: walletAddress,
        account_id: executeDto.accountId,
        status: 'running',
        trigger_type: 'manual',
        definition_snapshot: workflow.definition,
        execution_data: { steps: [], summary: 'Started' },
      })
      .select()
      .single();

    if (error) {
      this.inflightExecutionKeys.delete(executionKey);
      this.logger.error('Failed to create execution', error);
      throw new Error('Failed to start workflow execution');
    }

    this.logger.log(`Workflow execution started: ${execution.id}`);

    // Get Telegram Chat ID
    const { data: telegramMapping } = await this.supabaseService.client
      .from('telegram_mappings')
      .select('chat_id')
      .eq('wallet_address', walletAddress)
      .single();

    const chatId = telegramMapping?.chat_id;

    if (chatId) {
      this.logger.log(`Found linked Telegram chat: ${chatId}`);
    } else {
      this.logger.warn('No linked Telegram chat found for notifications');
    }

    // Get Crossmint Wallet Address if accountId is provided
    let crossmintWalletAddress: string | undefined;
    if (executeDto.accountId) {
      const { data: account } = await this.supabaseService.client
        .from('accounts')
        .select('crossmint_wallet_address')
        .eq('id', executeDto.accountId)
        .single();
      if (account) {
        crossmintWalletAddress = account.crossmint_wallet_address;
      }
    }

    // Create Instance using Factory
    const instance = this.executorFactory.createInstance({
      workflowDefinition: workflow.definition as WorkflowDefinition,
      executionId: execution.id,
      workflowName: workflow.name,
      chatId: chatId,
      accountId: executeDto.accountId,
      ownerWalletAddress: walletAddress,
      crossmintWalletAddress: crossmintWalletAddress,
    });

    // Execute asynchronously (fire and forget from API perspective)
    (async () => {
      try {
        await instance.execute();

        // Update status to completed with logs
        await this.supabaseService.client
          .from('workflow_executions')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            execution_data: {
              steps: instance.getExecutionLogs(),
              summary: 'Completed successfully',
            },
          })
          .eq('id', execution.id)
          .eq('status', 'running');

        this.logger.log(`Workflow execution completed: ${execution.id}`);
      } catch (err) {
        this.logger.error(
          `Workflow execution failed: ${execution.id}`,
          err instanceof Error ? err.stack : err,
        );

        // Update status to failed with logs
        await this.supabaseService.client
          .from('workflow_executions')
          .update({
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Unknown error',
            completed_at: new Date().toISOString(),
            execution_data: {
              steps: instance.getExecutionLogs(),
              summary: `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            },
          })
          .eq('id', execution.id)
          .eq('status', 'running');
      } finally {
        this.inflightExecutionKeys.delete(executionKey);
      }
    })();

    return execution;
  }
}
