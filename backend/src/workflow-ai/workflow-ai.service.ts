import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { ConversationStoreService, Conversation } from './conversation-store.service';
import { PromptBuilderService } from './prompt-builder.service';
import { WorkflowValidatorService } from './workflow-validator.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowDefinition } from '../web3/workflow-types';
import { StrategiesService } from '../strategies/strategies.service';
import { StrategyCompilerService } from '../strategy-compiler/strategy-compiler.service';

@Injectable()
export class WorkflowAiService {
  private readonly logger = new Logger(WorkflowAiService.name);
  private nvidia: ReturnType<typeof createOpenAI>;
  private modelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly conversationStore: ConversationStoreService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly validator: WorkflowValidatorService,
    private readonly workflowsService: WorkflowsService,
    private readonly strategiesService: StrategiesService,
    private readonly strategyCompilerService: StrategyCompilerService,
  ) {
    const apiKey = this.configService.get<string>('nvidia.apiKey');
    const baseURL =
      this.configService.get<string>('nvidia.baseURL') || 'https://integrate.api.nvidia.com/v1';
    this.modelName = this.configService.get<string>('nvidia.model') || 'deepseek-ai/deepseek-v3.2';

    if (!apiKey) {
      this.logger.warn('NVIDIA_API_KEY is not configured. Workflow AI features will not work.');
    }
    this.nvidia = createOpenAI({
      apiKey: apiKey || '',
      baseURL,
    });
  }

  createConversation(walletAddress: string): Conversation {
    return this.conversationStore.create(walletAddress);
  }

  getConversation(id: string): Conversation {
    const conv = this.conversationStore.get(id);
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  getConversationForWallet(id: string, walletAddress: string): Conversation {
    const conversation = this.getConversation(id);
    if (conversation.walletAddress !== walletAddress) {
      throw new ForbiddenException('Conversation does not belong to the authenticated wallet');
    }
    return conversation;
  }

  getActiveConversationForWallet(id: string, walletAddress: string): Conversation {
    const conversation = this.getConversationForWallet(id, walletAddress);
    if (conversation.status !== 'active') {
      throw new BadRequestException('Conversation is no longer active');
    }
    return conversation;
  }

  /**
   * Chat with the AI — returns an async iterable of text chunks for SSE streaming.
   * After streaming completes, checks if the response contains a workflow JSON and validates it.
   */
  async *chat(
    conversationId: string,
    walletAddress: string,
    userMessage: string,
  ): AsyncGenerator<string> {
    const conversation = this.getActiveConversationForWallet(conversationId, walletAddress);

    // Add the user message
    this.conversationStore.addMessage(conversationId, { role: 'user', content: userMessage });

    const result = streamText({
      model: this.nvidia(this.modelName),
      system: this.promptBuilder.getSystemPrompt(),
      messages: conversation.messages,
    });

    // Stream chunks to the client while collecting the full response
    let fullResponse = '';
    for await (const chunk of result.textStream) {
      fullResponse += chunk;
      yield chunk;
    }

    // Store the assistant's full response
    this.conversationStore.addMessage(conversationId, { role: 'assistant', content: fullResponse });

    // Check if the response contains a workflow definition JSON
    const workflow = this.extractWorkflowFromResponse(fullResponse);
    if (workflow) {
      const validation = this.validator.validate(workflow);
      if (validation.valid) {
        this.conversationStore.setGeneratedWorkflow(conversationId, workflow);
        this.logger.log(`Valid workflow generated in conversation ${conversationId}`);
      } else {
        // Append validation errors to conversation so LLM can self-correct on next turn
        const errorMsg = `The generated workflow has validation errors:\n${validation.errors.join('\n')}\n\nPlease fix these issues and regenerate the workflow.`;
        this.conversationStore.addMessage(conversationId, { role: 'user', content: errorMsg });
        this.logger.warn(
          `Workflow validation failed in conversation ${conversationId}: ${validation.errors.join('; ')}`,
        );
      }
    }
  }

  /**
   * Confirm and save the generated workflow
   */
  async confirmWorkflow(
    conversationId: string,
    walletAddress: string,
    name: string,
    description?: string,
    telegramChatId?: string,
  ) {
    const conversation = this.getConversationForWallet(conversationId, walletAddress);
    if (!conversation.generatedWorkflow) {
      throw new BadRequestException('No workflow has been generated in this conversation yet');
    }

    const saved = await this.workflowsService.createWorkflow(walletAddress, {
      name,
      description,
      definition: conversation.generatedWorkflow,
      telegramChatId,
    });

    this.conversationStore.setStatus(conversationId, 'confirmed');
    this.logger.log(
      `Workflow confirmed and saved: ${saved.id} from conversation ${conversationId}`,
    );

    return saved;
  }

  /**
   * Preview the AI-generated workflow as a draft strategy proposal.
   * Sanitises sensitive parameters via the strategy compiler so the caller
   * receives only the public surface plus suggested deployment hints.
   */
  draftStrategyFromConversation(conversationId: string, walletAddress: string) {
    const conversation = this.getConversationForWallet(conversationId, walletAddress);
    if (!conversation.generatedWorkflow) {
      throw new BadRequestException('No workflow has been generated in this conversation yet');
    }

    const compiled = this.strategyCompilerService.compileStrategyIR(conversation.generatedWorkflow);
    return {
      conversationId,
      workflow: conversation.generatedWorkflow,
      proposedStrategy: {
        visibilityMode: 'private' as const,
        publicMetadata: compiled.publicMetadata,
        publicDefinition: compiled.publicDefinition,
        deploymentHints: compiled.deploymentHints,
        executionRequirements: compiled.executionRequirements,
      },
    };
  }

  /**
   * Confirm a conversation and persist the generated workflow as a strategy.
   * Marks the conversation as confirmed (idempotent with confirmWorkflow).
   */
  async confirmStrategyFromConversation(
    conversationId: string,
    walletAddress: string,
    dto: {
      name: string;
      description?: string;
      visibilityMode?: 'private' | 'public';
      telegramChatId?: string;
    },
  ) {
    const conversation = this.getConversationForWallet(conversationId, walletAddress);
    if (!conversation.generatedWorkflow) {
      throw new BadRequestException('No workflow has been generated in this conversation yet');
    }

    const created = await this.strategiesService.createStrategy(walletAddress, {
      name: dto.name,
      description: dto.description,
      definition: conversation.generatedWorkflow,
      visibilityMode: dto.visibilityMode,
      telegramChatId: dto.telegramChatId,
    });

    this.conversationStore.setStatus(conversationId, 'confirmed');
    this.logger.log(
      `Strategy ${created.id} created from conversation ${conversationId} (wallet ${walletAddress})`,
    );

    return created;
  }

  /**
   * Extract a WorkflowDefinition JSON from the LLM's response text.
   * Looks for JSON inside ```json code fences.
   */
  private extractWorkflowFromResponse(response: string): WorkflowDefinition | null {
    // Match ```json ... ``` blocks
    const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;

    while ((match = jsonBlockRegex.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        // Check if it looks like a WorkflowDefinition (has nodes array)
        if (parsed && Array.isArray(parsed.nodes)) {
          return parsed as WorkflowDefinition;
        }
      } catch {
        // Not valid JSON, try next match
        continue;
      }
    }

    return null;
  }
}
