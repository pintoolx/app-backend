import { WorkflowInstance } from './workflow-instance';
import { type WorkflowDefinition, type INodeType } from '../web3/workflow-types';

describe('WorkflowInstance', () => {
  it('prevents concurrent execute calls', async () => {
    jest.useFakeTimers();
    const definition: WorkflowDefinition = {
      nodes: [
        {
          id: 'n1',
          name: 'Node 1',
          type: 'test',
          parameters: {},
        },
      ],
      connections: {},
    };

    const nodeType: INodeType = {
      description: {
        displayName: 'Test',
        name: 'test',
        group: [],
        version: 1,
        description: '',
        inputs: [],
        outputs: [],
        telegramNotify: false,
        properties: [],
      },
      execute: jest.fn(
        () => new Promise((resolve) => setTimeout(() => resolve([[{ json: { ok: true } }]]), 10)),
      ),
    };

    const instance = new WorkflowInstance({
      workflowDefinition: definition,
      executionId: 'exec-1',
      workflowName: 'Test Workflow',
    });
    instance.registerNodeType('test', nodeType);

    const first = instance.execute();
    await expect(instance.execute()).rejects.toThrow('Workflow execution already running');
    jest.advanceTimersByTime(20);
    await first;
  });
});
