import { WorkflowsController } from './workflows.controller';

describe('WorkflowsController', () => {
  it('returns active instances from lifecycle manager', () => {
    const instances = [
      {
        accountId: 'acc-1',
        executionId: 'exec-1',
        workflowName: 'WF',
        isRunning: true,
        nodeCount: 2,
        startedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const lifecycleManager = {
      getActiveInstances: jest.fn().mockReturnValue(instances),
    } as any;
    const controller = new WorkflowsController(lifecycleManager);

    const result = controller.getActiveInstances();

    expect(result).toEqual({
      success: true,
      count: 1,
      data: instances,
    });
  });
});
