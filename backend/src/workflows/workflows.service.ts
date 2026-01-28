import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { WorkflowExecutorFactory } from './workflow-executor.factory';
import { WorkflowDefinition } from '../web3/workflow-types';

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(forwardRef(() => SupabaseService))
    private supabaseService: SupabaseService,
    private executorFactory: WorkflowExecutorFactory,
  ) {}

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

  async executeWorkflow(id: string, walletAddress: string, executeDto: any) {
    const workflow = await this.getWorkflow(id, walletAddress);

    console.log(`⚙️ Executing workflow: ${workflow.name}`);

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
      console.error('❌ Failed to create execution:', error);
      throw new Error('Failed to start workflow execution');
    }

    console.log(`✅ Workflow execution started: ${execution.id}`);

    // Get Telegram Chat ID
    const { data: telegramMapping } = await this.supabaseService.client
      .from('telegram_mappings')
      .select('chat_id')
      .eq('wallet_address', walletAddress)
      .single();

    const chatId = telegramMapping?.chat_id;

    if (chatId) {
      console.log(`📱 Found linked Telegram chat: ${chatId}`);
    } else {
      console.log('⚠️ No linked Telegram chat found for notifications');
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
          .eq('id', execution.id);

        console.log(`✅ Workflow execution completed successfully: ${execution.id}`);
      } catch (err) {
        console.error(`❌ Workflow execution failed: ${execution.id}`, err);

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
          .eq('id', execution.id);
      }
    })();

    return execution;
  }
}
