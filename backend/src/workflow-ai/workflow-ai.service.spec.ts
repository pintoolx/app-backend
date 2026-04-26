import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConversationStoreService } from './conversation-store.service';
import { PromptBuilderService } from './prompt-builder.service';
import { WorkflowAiService } from './workflow-ai.service';
import { StrategyCompilerService } from '../strategy-compiler/strategy-compiler.service';

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
  const strategiesService = {
    createStrategy: jest.fn(),
  };
  const strategyCompilerService = new StrategyCompilerService();

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
      strategiesService as any,
      strategyCompilerService,
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

  it('returns a draft strategy preview without leaking sensitive parameters', () => {
    const conversation = service.createConversation('wallet-1');
    conversation.generatedWorkflow = {
      nodes: [
        {
          id: 'guard-1',
          name: 'Guard',
          type: 'getBalance',
          parameters: { token: 'USDC', condition: 'gte', threshold: '1000' },
        },
      ],
      connections: {},
    } as any;

    const preview = service.draftStrategyFromConversation(conversation.id, 'wallet-1');
    const previewJson = JSON.stringify(preview);

    expect(preview.workflow).toBeDefined();
    expect(preview.proposedStrategy.publicMetadata.privacyModel.hidesImplementation).toBe(true);
    // The sanitized publicDefinition must not leak threshold values.
    const publicJson = JSON.stringify(preview.proposedStrategy.publicDefinition);
    expect(publicJson).not.toContain('1000');
    // The raw workflow is still returned so the FE can show the creator their own draft
    // — this is fine because draft-strategy is owner-only.
    expect(previewJson).toContain('1000');
  });

  it('rejects draft preview when no workflow is generated yet', () => {
    const conversation = service.createConversation('wallet-1');
    expect(() => service.draftStrategyFromConversation(conversation.id, 'wallet-1')).toThrow(
      new BadRequestException('No workflow has been generated in this conversation yet'),
    );
  });

  it('confirm-strategy persists via StrategiesService and marks conversation confirmed', async () => {
    const conversation = service.createConversation('wallet-1');
    conversation.generatedWorkflow = {
      nodes: [{ id: 'guard-1', name: 'G', type: 'getBalance', parameters: {} }],
      connections: {},
    } as any;

    strategiesService.createStrategy = jest.fn().mockResolvedValue({ id: 'strategy-1' });

    const result = await service.confirmStrategyFromConversation(conversation.id, 'wallet-1', {
      name: 'Test Strategy',
      description: 'desc',
      visibilityMode: 'private',
    });

    expect(result).toEqual({ id: 'strategy-1' });
    expect(strategiesService.createStrategy).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({
        name: 'Test Strategy',
        description: 'desc',
        visibilityMode: 'private',
      }),
    );
    expect(conversation.status).toBe('confirmed');
  });
});
