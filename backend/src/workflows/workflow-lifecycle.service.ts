import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';
import { WorkflowExecutorFactory } from './workflow-executor.factory';
import { WorkflowInstance } from './workflow-instance';
import { WorkflowDefinition } from '../web3/workflow-types';

@Injectable()
export class WorkflowLifecycleManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowLifecycleManager.name);
  private activeInstances = new Map<string, WorkflowInstance>();
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

      // Remove instances that are no longer active
      for (const [accountId, instance] of this.activeInstances.entries()) {
        if (!activeAccountIds.has(accountId)) {
          this.logger.log(`Account ${accountId} is no longer active. Stopping instance.`);
          instance.stop();
          this.activeInstances.delete(accountId);
        }
      }

      // Launch new instances for accounts that don't have one
      for (const account of accounts) {
        if (!this.activeInstances.has(account.id)) {
          await this.launchInstance(account);
        }
      }
    } catch (err) {
      this.logger.error('Error in syncInstances', err);
    }
  }

  /**
   * List all in-memory active workflow instances
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

      await this.launchInstance(account);
    } catch (err) {
      this.logger.error(`Error starting workflow for account ${accountId}`, err);
    }
  }

  /**
   * Stop a workflow instance for a specific account.
   * Called when an account is being deleted.
   */
  stopWorkflowForAccount(accountId: string): void {
    const instance = this.activeInstances.get(accountId);
    if (instance) {
      this.logger.log(`Stopping workflow instance for account ${accountId}`);
      instance.stop();
      this.activeInstances.delete(accountId);
    }
  }

  /**
   * Launch a workflow instance for an account:
   * 1. Create execution record in DB
   * 2. Create and register instance
   * 3. Execute async with cleanup on completion
   */
  private async launchInstance(account: any): Promise<void> {
    const workflow = account.workflows as any;

    if (!workflow || !workflow.definition) {
      this.logger.warn(`Account ${account.id} has workflow ID but no definition found.`);
      return;
    }

    // 1. Create execution record in DB
    const { data: execution, error: execError } = await this.supabaseService.client
      .from('workflow_executions')
      .insert({
        workflow_id: account.current_workflow_id,
        owner_wallet_address: account.owner_wallet_address,
        account_id: account.id,
        status: 'running',
        trigger_type: 'auto',
        definition_snapshot: workflow.definition,
        execution_data: { steps: [], summary: 'Started by lifecycle manager' },
      })
      .select()
      .single();

    if (execError || !execution) {
      this.logger.error(`Failed to create execution record for account ${account.id}`, execError);
      return;
    }

    this.logger.log(
      `Starting instance for Account ${account.id} (Workflow: ${workflow.name}, Execution: ${execution.id})`,
    );

    // 2. Create instance with real execution ID
    const userMappings = account?.users?.telegram_mappings;
    const chatId = Array.isArray(userMappings)
      ? userMappings[0]?.chat_id
      : userMappings?.chat_id;

    const instance = this.executorFactory.createInstance({
      workflowDefinition: workflow.definition as WorkflowDefinition,
      executionId: execution.id,
      workflowName: workflow.name,
      chatId,
      accountId: account.id,
      ownerWalletAddress: account.owner_wallet_address,
      crossmintWalletAddress: account.crossmint_wallet_address,
    });

    this.activeInstances.set(account.id, instance);

    // 3. Execute async with DB status updates and cleanup
    (async () => {
      try {
        await instance.execute();

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

        this.logger.log(`Workflow execution completed: ${execution.id} (Account: ${account.id})`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';

        await this.supabaseService.client
          .from('workflow_executions')
          .update({
            status: 'failed',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
            execution_data: {
              steps: instance.getExecutionLogs(),
              summary: `Failed: ${errorMessage}`,
            },
          })
          .eq('id', execution.id)
          .eq('status', 'running');

        this.logger.error(`Workflow execution failed: ${execution.id} (Account: ${account.id})`, err);
      } finally {
        // Remove from active instances so next polling cycle can restart if needed
        this.activeInstances.delete(account.id);
      }
    })();
  }
}
