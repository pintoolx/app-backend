import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConversationStoreService } from './conversation-store.service';
import { PromptBuilderService } from './prompt-builder.service';
import { WorkflowAiService } from './workflow-ai.service';

describe('WorkflowAiService', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'nvidia.baseURL') return 'https://integrate.api.nvidia.com/v1';
      if (key === 'nvidia.model') return 'deepseek-ai/deepseek-v3.2';
      return undefined;
    }),
  };
  const promptBuilder = {
    getSystemPrompt: jest.fn().mockReturnValue('prompt'),
  } as unknown as PromptBuilderService;
  const validator = {
    validate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  };
  const workflowsService = {
    createWorkflow: jest.fn(),
  };

  let conversationStore: ConversationStoreService;
  let service: WorkflowAiService;

  beforeEach(() => {
    jest.clearAllMocks();
    conversationStore = new ConversationStoreService();
    service = new WorkflowAiService(
      configService as any,
      conversationStore,
      promptBuilder,
      validator as any,
      workflowsService as any,
    );
  });

  it('returns conversation for the owning wallet', () => {
    const conversation = service.createConversation('wallet-1');

    expect(service.getConversationForWallet(conversation.id, 'wallet-1')).toBe(conversation);
  });

  it('blocks reading a conversation from a different wallet', () => {
    const conversation = service.createConversation('wallet-1');

    expect(() => service.getConversationForWallet(conversation.id, 'wallet-2')).toThrow(
      new ForbiddenException('Conversation does not belong to the authenticated wallet'),
    );
  });

  it('blocks chatting on a conversation from a different wallet', async () => {
    const conversation = service.createConversation('wallet-1');

    const stream = service.chat(conversation.id, 'wallet-2', 'hello');

    await expect(stream.next()).rejects.toThrow(
      new ForbiddenException('Conversation does not belong to the authenticated wallet'),
    );
  });

  it('blocks chatting on an inactive conversation before streaming', () => {
    const conversation = service.createConversation('wallet-1');
    conversation.status = 'confirmed';

    expect(() => service.getActiveConversationForWallet(conversation.id, 'wallet-1')).toThrow(
      new BadRequestException('Conversation is no longer active'),
    );
  });

  it('blocks confirming a conversation from a different wallet', async () => {
    const conversation = service.createConversation('wallet-1');
    conversation.generatedWorkflow = {
      nodes: [],
      connections: {},
    } as any;

    await expect(
      service.confirmWorkflow(conversation.id, 'wallet-2', 'Test Workflow'),
    ).rejects.toThrow(
      new ForbiddenException('Conversation does not belong to the authenticated wallet'),
    );
  });

  it('passes telegramChatId through when confirming a workflow', async () => {
    const conversation = service.createConversation('wallet-1');
    conversation.generatedWorkflow = {
      nodes: [],
      connections: {},
    } as any;
    workflowsService.createWorkflow = jest.fn().mockResolvedValue({ id: 'wf-1' });

    await expect(
      service.confirmWorkflow(conversation.id, 'wallet-1', 'Test Workflow', 'desc', '123456'),
    ).resolves.toEqual({ id: 'wf-1' });

    expect(workflowsService.createWorkflow).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({
        name: 'Test Workflow',
        description: 'desc',
        telegramChatId: '123456',
      }),
    );
  });
});
