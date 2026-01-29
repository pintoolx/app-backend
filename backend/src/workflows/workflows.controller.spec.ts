import { UnauthorizedException } from '@nestjs/common';
import { WorkflowsController } from './workflows.controller';

describe('WorkflowsController', () => {
  it('throws when signature invalid', async () => {
    const workflowsService = {
      executeWorkflow: jest.fn(),
    } as any;
    const authService = {
      verifyAndConsumeChallenge: jest.fn().mockResolvedValue(false),
    } as any;
    const controller = new WorkflowsController(workflowsService, authService);

    await expect(
      controller.executeWorkflow('wf-1', {
        walletAddress: 'wallet-1',
        signature: 'sig',
      } as any),
    ).rejects.toThrow(UnauthorizedException);
    expect(workflowsService.executeWorkflow).not.toHaveBeenCalled();
  });

  it('returns execution when signature valid', async () => {
    const workflowsService = {
      executeWorkflow: jest.fn().mockResolvedValue({ id: 'exec-1' }),
    } as any;
    const authService = {
      verifyAndConsumeChallenge: jest.fn().mockResolvedValue(true),
    } as any;
    const controller = new WorkflowsController(workflowsService, authService);

    const result = await controller.executeWorkflow('wf-1', {
      walletAddress: 'wallet-1',
      signature: 'sig',
    } as any);

    expect(workflowsService.executeWorkflow).toHaveBeenCalledWith(
      'wf-1',
      'wallet-1',
      expect.objectContaining({ walletAddress: 'wallet-1', signature: 'sig' }),
    );
    expect(result).toEqual({
      success: true,
      data: { id: 'exec-1' },
    });
  });
});
