import { WorkflowLifecycleManager } from './workflow-lifecycle.service';

describe('WorkflowLifecycleManager', () => {
  it('runs polling loop serially', async () => {
    jest.useFakeTimers();
    const supabaseService = { client: {} } as any;
    const executorFactory = { createInstance: jest.fn() } as any;
    const manager = new WorkflowLifecycleManager(supabaseService, executorFactory);

    const runSyncOnce = jest.fn().mockResolvedValue(undefined);
    (manager as any).runSyncOnce = runSyncOnce;

    manager.onModuleInit();

    await jest.runOnlyPendingTimersAsync();
    expect(runSyncOnce).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync((manager as any).POLLING_MS);
    expect(runSyncOnce).toHaveBeenCalledTimes(2);

    manager.onModuleDestroy();
  });

  it('prevents overlapping sync runs', async () => {
    jest.useFakeTimers();
    const supabaseService = { client: {} } as any;
    const executorFactory = { createInstance: jest.fn() } as any;
    const manager = new WorkflowLifecycleManager(supabaseService, executorFactory);

    const syncInstances = jest.fn(() => new Promise((resolve) => setTimeout(resolve, 10)));
    (manager as any).syncInstances = syncInstances;

    const first = (manager as any).runSyncOnce();
    const second = (manager as any).runSyncOnce();

    jest.advanceTimersByTime(20);

    await first;
    await second;

    expect(syncInstances).toHaveBeenCalledTimes(1);
  });
});
