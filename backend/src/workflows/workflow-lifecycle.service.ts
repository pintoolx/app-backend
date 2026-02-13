import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { WorkflowExecutorFactory } from './workflow-executor.factory';
import { WorkflowInstance } from './workflow-instance';
import { WorkflowDefinition } from '../web3/workflow-types';

@Injectable()
export class WorkflowLifecycleManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowLifecycleManager.name);
  private activeInstances = new Map<string, WorkflowInstance>(); // Map<AccountId, WorkflowInstance>
  private pollingTimeout: NodeJS.Timeout | null = null;
  private syncInProgress = false;
  private readonly POLLING_MS = 60 * 1000;

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
    if (this.pollingTimeout) return;
    this.pollingTimeout = setTimeout(() => {
      this.pollingLoop();
    }, 0);
  }

  private stopPolling() {
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
  }

  private async pollingLoop() {
    if (!this.pollingTimeout) return;
    await this.runSyncOnce();
    if (!this.pollingTimeout) return;
    this.pollingTimeout = setTimeout(() => {
      this.pollingLoop();
    }, this.POLLING_MS);
  }

  private async runSyncOnce() {
    if (this.syncInProgress) return;
    this.syncInProgress = true;
    try {
      await this.syncInstances();
    } finally {
      this.syncInProgress = false;
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
          users!owner_wallet_address ( wallet_address, telegram_mappings ( chat_id ) ),
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

          const userMappings = (account as any)?.users?.telegram_mappings;
          const chatId = Array.isArray(userMappings)
            ? userMappings[0]?.chat_id
            : userMappings?.chat_id;

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
          this.activeInstances.set(account.id, instance);

          instance.execute().catch((err) => {
            this.logger.error(`Failed to execute workflow for account ${account.id}`, err);
          });
        }
      }
    } catch (err) {
      this.logger.error('Error in syncInstances', err);
    }
  }

  /**
   * 列出所有目前在記憶體中的 active workflow instances
   */
  getActiveInstances(): Array<{
    accountId: string;
    executionId: string;
    workflowName: string;
    ownerWalletAddress?: string;
    isRunning: boolean;
    nodeCount: number;
    startedAt: string;
  }> {
    const results: Array<{
      accountId: string;
      executionId: string;
      workflowName: string;
      ownerWalletAddress?: string;
      isRunning: boolean;
      nodeCount: number;
      startedAt: string;
    }> = [];

    for (const [accountId, instance] of this.activeInstances.entries()) {
      results.push({
        accountId,
        executionId: instance.executionId,
        workflowName: instance.workflowName,
        ownerWalletAddress: instance.ownerWalletAddress,
        isRunning: instance.running,
        nodeCount: instance.nodeCount,
        startedAt: instance.startedAt.toISOString(),
      });
    }

    return results;
  }

  /**
   * Start a workflow for a specific account (best-effort, no-throw).
   * Called after account creation to immediately trigger execution.
   */
  async startWorkflowForAccount(accountId: string): Promise<void> {
    try {
      if (this.activeInstances.has(accountId)) {
        this.logger.debug(`Account ${accountId} already has an active instance, skipping.`);
        return;
      }

      const { data: account, error } = await this.supabaseService.client
        .from('accounts')
        .select(
          `
          id,
          owner_wallet_address,
          name,
          current_workflow_id,
          crossmint_wallet_address,
          users!owner_wallet_address ( wallet_address, telegram_mappings ( chat_id ) ),
          workflows!current_workflow_id (
             id,
             name,
             definition
          )
        `,
        )
        .eq('id', accountId)
        .eq('is_active', true)
        .not('current_workflow_id', 'is', null)
        .single();

      if (error || !account) {
        this.logger.debug(`Account ${accountId} not ready for workflow execution.`);
        return;
      }

      const workflow = account.workflows as any;

      if (!workflow || !workflow.definition) {
        this.logger.debug(`Account ${accountId} has no workflow definition, skipping.`);
        return;
      }

      this.logger.log(
        `Starting workflow for account ${accountId} (Workflow: ${workflow.name})`,
      );

      const userMappings = (account as any)?.users?.telegram_mappings;
      const chatId = Array.isArray(userMappings)
        ? userMappings[0]?.chat_id
        : userMappings?.chat_id;

      const instance = this.executorFactory.createInstance({
        workflowDefinition: workflow.definition as WorkflowDefinition,
        executionId: `auto-${accountId}-${Date.now()}`,
        workflowName: workflow.name,
        chatId,
        accountId: account.id,
        ownerWalletAddress: account.owner_wallet_address,
        crossmintWalletAddress: account.crossmint_wallet_address,
      });

      this.activeInstances.set(accountId, instance);

      instance.execute().catch((err) => {
        this.logger.error(`Failed to execute workflow for account ${accountId}`, err);
      });
    } catch (err) {
      this.logger.error(`Error starting workflow for account ${accountId}`, err);
    }
  }
}
