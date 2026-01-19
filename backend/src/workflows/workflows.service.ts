import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { TelegramNotifierService } from '../telegram/telegram-notifier.service';
import { CrossmintService } from '../crossmint/crossmint.service';
import { AgentKitService } from '../web3/services/agent-kit.service';
import { WorkflowExecutor } from './executor.service';
import { PriceFeedNode } from '../web3/nodes/price-feed.node';
import { SwapNode } from '../web3/nodes/swap.node';
import { KaminoNode } from '../web3/nodes/kamino.node';
import { TransferNode } from '../web3/nodes/transfer.node';
import { BalanceNode } from '../web3/nodes/balance.node';
import { LimitOrderNode } from '../web3/nodes/limit-order.node';
import { WorkflowDefinition } from '../web3/workflow-types';

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(forwardRef(() => SupabaseService))
    private supabaseService: SupabaseService,
    private telegramNotifier: TelegramNotifierService,
    private crossmintService: CrossmintService,
    private agentKitService: AgentKitService,
  ) {}

  async getWorkflows(walletAddress: string) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .select('*')
      .eq('owner_wallet_address', walletAddress)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Failed to fetch workflows:', error);
      throw new Error('Failed to fetch workflows');
    }

    return data;
  }

  async createWorkflow(walletAddress: string, createDto: any) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .insert({
        owner_wallet_address: walletAddress,
        name: createDto.name,
        description: createDto.description,
        definition: createDto.definition,
        is_active: createDto.isActive ?? true,
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Failed to create workflow:', error);
      throw new Error('Failed to create workflow');
    }

    console.log(`✅ Workflow created: ${data.name}`);
    return data;
  }

  async getWorkflow(id: string, walletAddress: string) {
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

  async updateWorkflow(id: string, walletAddress: string, updateDto: any) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .update({
        name: updateDto.name,
        description: updateDto.description,
        definition: updateDto.definition,
        is_active: updateDto.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('owner_wallet_address', walletAddress)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Workflow not found');
    }

    console.log(`✅ Workflow updated: ${data.name}`);
    return data;
  }

  async deleteWorkflow(id: string, walletAddress: string) {
    const { error } = await this.supabaseService.client
      .from('workflows')
      .delete()
      .eq('id', id)
      .eq('owner_wallet_address', walletAddress);

    if (error) {
      throw new NotFoundException('Workflow not found');
    }

    console.log(`✅ Workflow deleted: ${id}`);
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

    // Initialize Executor with injected services
    const executor = new WorkflowExecutor({
      telegramNotifier: this.telegramNotifier,
      workflowName: workflow.name,
      chatId,
      executionId: execution.id,
      crossmintService: this.crossmintService,
      agentKitService: this.agentKitService,
    });

    // Register Nodes
    executor.registerNodeType('pythPriceFeed', PriceFeedNode);
    executor.registerNodeType('jupiterSwap', SwapNode);
    executor.registerNodeType('kamino', KaminoNode);
    executor.registerNodeType('transfer', TransferNode);
    executor.registerNodeType('getBalance', BalanceNode);
    executor.registerNodeType('jupiterLimitOrder', LimitOrderNode);

    // Execute asynchronously (fire and forget from API perspective, but we await here to catch immediate errors)
    // In a production app, this should be offloaded to a queue.
    (async () => {
      try {
        await executor.execute(workflow.definition as WorkflowDefinition);

        // Update status to completed
        await this.supabaseService.client
          .from('workflow_executions')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', execution.id);

        console.log(`✅ Workflow execution completed successfully: ${execution.id}`);
      } catch (err) {
        console.error(`❌ Workflow execution failed: ${execution.id}`, err);

        // Update status to failed
        await this.supabaseService.client
          .from('workflow_executions')
          .update({
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          })
          .eq('id', execution.id);
      }
    })();

    return execution;
  }
}
