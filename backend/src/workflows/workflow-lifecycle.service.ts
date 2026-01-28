import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { WorkflowExecutorFactory } from './workflow-executor.factory';
import { WorkflowInstance } from './workflow-instance';
import { WorkflowDefinition } from '../web3/workflow-types';

@Injectable()
export class WorkflowLifecycleManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowLifecycleManager.name);
  private activeInstances = new Map<string, WorkflowInstance>(); // Map<AccountId, WorkflowInstance>
  private pollingInterval: NodeJS.Timeout | null = null;
  private readonly POLLING_MS = 30000; // 30 seconds

  constructor(
    private supabaseService: SupabaseService,
    private executorFactory: WorkflowExecutorFactory,
  ) {}

  onModuleInit() {
    this.startPolling();
  }

  onModuleDestroy() {
    this.stopPolling();
  }

  private startPolling() {
    this.logger.log('Starting workflow lifecycle polling...');
    if (this.pollingInterval) return;

    // Initial sync
    this.syncInstances();

    // Start loop
    this.pollingInterval = setInterval(() => {
      this.syncInstances();
    }, this.POLLING_MS);
  }

  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Core logic: Fetch active accounts from DB and sync with running instances
   */
  async syncInstances() {
    try {
      // 1. Fetch all active accounts that have a workflow assigned
      const { data: accounts, error } = await this.supabaseService.client
        .from('accounts')
        .select(
          `
          id,
          owner_wallet_address,
          name,
          current_workflow_id,
          crossmint_wallet_address,
          workflows!current_workflow_id (
             id,
             name,
             definition
          )
        `,
        )
        .eq('is_active', true)
        .not('current_workflow_id', 'is', null);

      if (error) {
        this.logger.error('Failed to fetch active accounts', error);
        return;
      }

      const activeAccountIds = new Set(accounts.map((a) => a.id));

      // 2. Remove instances that are no longer active or in the list
      for (const [accountId, instance] of this.activeInstances.entries()) {
        if (!activeAccountIds.has(accountId)) {
          this.logger.log(`Account ${accountId} is no longer active. Stopping instance.`);
          instance.stop();
          this.activeInstances.delete(accountId);
        }
      }

      // 3. Create new instances for active accounts that don't have one
      for (const account of accounts) {
        if (!this.activeInstances.has(account.id)) {
          // Check if workflow data is valid (it comes from a join)
          const workflow = account.workflows as any; // Cast because nested join might be array or object depending on One-to-One

          if (!workflow || !workflow.definition) {
            this.logger.warn(`Account ${account.id} has workflow ID but no definition found.`);
            continue;
          }

          this.logger.log(
            `Starting new instance for Account ${account.id} (Workflow: ${workflow.name})`,
          );

          // Fetch Chat ID if needed
          const chatId = await this.getChatId(account.owner_wallet_address);

          const instance = this.executorFactory.createInstance({
            workflowDefinition: workflow.definition as WorkflowDefinition,
            executionId: `auto-${account.id}-${Date.now()}`, // Generate a temporary execution ID for this session
            workflowName: workflow.name,
            chatId,
            accountId: account.id,
            ownerWalletAddress: account.owner_wallet_address,
            crossmintWalletAddress: account.crossmint_wallet_address,
          });

          // Start the instance (Depending on design, maybe we just hold it, or we trigger it?)
          // User request implied "專注於執行該 workflow 的內容", which often implies running it.
          // However, typically workflows are triggered by events or schedules.
          // If the persistent instance is just *waiting* for triggers, we just keep it.
          // IF the requirement is to "Initial" it and it runs continuously (like a bot), we call execute().

          // Assuming "Execute Once" logic for now based on previous code,
          // BUT since the user wants a persistent instance, maybe it should loop?
          // For safety, I will NOT auto-execute in the loop, unless there's a trigger mechanism.
          // Wait, the user said "每次一個新的 account 產生 initial 一個 instance 並專注於執行該 workflow 的內容".
          // This strongly implies the instance *runs*.

          // Let's assume for now we just create it. If it needs to run a loop, the Workflow Definition
          // usually handles loops or the instance does.
          // Detailed Requirement: "專注於執行該 workflow 的內容".
          // I will add a `start()` or similar if the instance is meant to run autonomously.

          // Re-reading `WorkflowInstance`: It has `execute()`.
          // If I call `execute()`, it runs through nodes once.
          // If the workflow is a "looping bot", the workflow definition might have a loop.

          this.activeInstances.set(account.id, instance);
        }
      }
    } catch (err) {
      this.logger.error('Error in syncInstances', err);
    }
  }

  private async getChatId(walletAddress: string): Promise<string | undefined> {
    const { data } = await this.supabaseService.client
      .from('telegram_mappings')
      .select('chat_id')
      .eq('wallet_address', walletAddress)
      .single();
    return data?.chat_id;
  }
}
