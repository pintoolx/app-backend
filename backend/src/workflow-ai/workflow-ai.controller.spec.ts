import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkflowAiController } from './workflow-ai.controller';

describe('WorkflowAiController', () => {
  const workflowAiService = {
    createConversation: jest.fn(),
    getActiveConversationForWallet: jest.fn(),
    getConversationForWallet: jest.fn(),
    chat: jest.fn(),
    confirmWorkflow: jest.fn(),
  };

  const createResponse = () =>
    ({
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails before opening SSE when conversation belongs to another wallet', async () => {
    const controller = new WorkflowAiController(workflowAiService as any);
    const res = createResponse();
    workflowAiService.getActiveConversationForWallet.mockImplementation(() => {
      throw new ForbiddenException('Conversation does not belong to the authenticated wallet');
    });

    await expect(
      controller.chat('conv-1', 'wallet-1', { message: 'hello' } as any, res),
    ).rejects.toThrow(
      new ForbiddenException('Conversation does not belong to the authenticated wallet'),
    );

    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(workflowAiService.chat).not.toHaveBeenCalled();
  });

  it('fails before opening SSE when conversation is inactive', async () => {
    const controller = new WorkflowAiController(workflowAiService as any);
    const res = createResponse();
    workflowAiService.getActiveConversationForWallet.mockImplementation(() => {
      throw new BadRequestException('Conversation is no longer active');
    });

    await expect(
      controller.chat('conv-1', 'wallet-1', { message: 'hello' } as any, res),
    ).rejects.toThrow(new BadRequestException('Conversation is no longer active'));

    expect(res.flushHeaders).not.toHaveBeenCalled();
  });

  it('fails before opening SSE when conversation is missing', async () => {
    const controller = new WorkflowAiController(workflowAiService as any);
    const res = createResponse();
    workflowAiService.getActiveConversationForWallet.mockImplementation(() => {
      throw new NotFoundException('Conversation conv-1 not found');
    });

    await expect(
      controller.chat('conv-1', 'wallet-1', { message: 'hello' } as any, res),
    ).rejects.toThrow(new NotFoundException('Conversation conv-1 not found'));

    expect(res.flushHeaders).not.toHaveBeenCalled();
  });
});
