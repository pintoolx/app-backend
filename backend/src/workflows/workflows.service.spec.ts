import { WorkflowsService } from './workflows.service';
import { type WorkflowDefinition } from '../web3/workflow-types';

const createSupabaseClient = (options: { runningExecution?: any }) => {
  const workflowRow = {
    id: 'wf-1',
    name: 'WF',
    definition: { nodes: [], connections: {} } as WorkflowDefinition,
  };

  const workflowTable = {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: workflowRow, error: null }),
  };

  const updateQuery = {
    eq: jest.fn().mockReturnThis(),
  };

  const workflowExecutionsTable = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnValue(updateQuery),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({
      data: options.runningExecution ? [options.runningExecution] : [],
      error: null,
    }),
    single: jest.fn().mockResolvedValue({ data: { id: 'exec-1' }, error: null }),
  };

  const telegramTable = {
    upsert: jest.fn().mockResolvedValue({ error: null }),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { chat_id: 'chat-1' }, error: null }),
  };

  const accountsTable = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest
      .fn()
      .mockResolvedValue({ data: { crossmint_wallet_address: 'cross-1' }, error: null }),
  };

  const from = jest.fn((table: string) => {
    if (table === 'workflows') return workflowTable;
    if (table === 'workflow_executions') return workflowExecutionsTable;
    if (table === 'telegram_mappings') return telegramTable;
    if (table === 'accounts') return accountsTable;
    return {};
  });

  return {
    from,
    workflowTable,
    workflowExecutionsTable,
    telegramTable,
    updateQuery,
  };
};

describe('WorkflowsService', () => {
  it('creates workflow with isPublic and telegram mapping support', async () => {
    const { from, workflowTable, telegramTable } = createSupabaseClient({});
    const supabaseService = { client: { from } } as any;
    const executorFactory = { createInstance: jest.fn() } as any;
    const service = new WorkflowsService(supabaseService, executorFactory);

    const definition = { nodes: [], connections: {} } as WorkflowDefinition;
    const result = await service.createWorkflow('wallet-1', {
      name: 'WF',
      description: 'desc',
      definition,
      isPublic: true,
      telegramChatId: '123456',
    });

    expect(telegramTable.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet_address: 'wallet-1',
        chat_id: '123456',
        notifications_enabled: true,
      }),
    );
    expect(workflowTable.insert).toHaveBeenCalledWith({
      owner_wallet_address: 'wallet-1',
      name: 'WF',
      description: 'desc',
      definition,
      is_public: true,
    });
    expect(result.id).toBe('wf-1');
  });

  it('returns existing running execution without creating a new one', async () => {
    const running = { id: 'running-1', status: 'running' };
    const { from, workflowExecutionsTable } = createSupabaseClient({ runningExecution: running });

    const supabaseService = { client: { from } } as any;
    const executorFactory = { createInstance: jest.fn() } as any;
    const service = new WorkflowsService(supabaseService, executorFactory);

    const result = await service.executeWorkflow('wf-1', 'wallet-1', { accountId: 'acc-1' });

    expect(result).toBe(running);
    expect(workflowExecutionsTable.insert).not.toHaveBeenCalled();
    expect(executorFactory.createInstance).not.toHaveBeenCalled();
  });

  it('creates execution and updates status with running guard', async () => {
    const { from, workflowExecutionsTable, updateQuery } = createSupabaseClient({});
    const supabaseService = { client: { from } } as any;
    const instance = {
      execute: jest.fn().mockResolvedValue(new Map()),
      getExecutionLogs: jest.fn().mockReturnValue([]),
    };
    const executorFactory = { createInstance: jest.fn().mockReturnValue(instance) } as any;
    const service = new WorkflowsService(supabaseService, executorFactory);

    const result = await service.executeWorkflow('wf-1', 'wallet-1', { accountId: 'acc-1' });

    await new Promise((resolve) => setImmediate(resolve));

    expect(result.id).toBe('exec-1');
    expect(workflowExecutionsTable.insert).toHaveBeenCalled();
    expect(executorFactory.createInstance).toHaveBeenCalled();
    expect(updateQuery.eq).toHaveBeenCalledWith('status', 'running');
  });
});
