import { Controller, Post, Get, Param, Body, Res, HttpCode, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { WorkflowAiService } from './workflow-ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ConfirmWorkflowDto } from './dto/confirm-workflow.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AgentWallet } from '../common/decorators/agent-wallet.decorator';

@Controller('workflow-ai')
@UseGuards(ApiKeyGuard)
export class WorkflowAiController {
  constructor(private readonly workflowAiService: WorkflowAiService) {}

  /**
   * POST /workflow-ai/conversations
   * Start a new AI conversation. Expects walletAddress in body (or from auth).
   * For now, accept walletAddress in body for simplicity.
   */
  @Post('conversations')
  createConversation(@AgentWallet() walletAddress: string) {
    const conversation = this.workflowAiService.createConversation(walletAddress);
    return {
      id: conversation.id,
      status: conversation.status,
      createdAt: conversation.createdAt,
    };
  }

  /**
   * POST /workflow-ai/conversations/:id/messages
   * Send a message and stream the AI response via SSE.
   */
  @Post('conversations/:id/messages')
  @HttpCode(200)
  async chat(@Param('id') id: string, @Body() dto: ChatMessageDto, @Res() res: Response) {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const stream = this.workflowAiService.chat(id, dto.message);
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
      }

      // Check if a workflow was generated after streaming
      const conversation = this.workflowAiService.getConversation(id);
      if (conversation.generatedWorkflow) {
        res.write(
          `data: ${JSON.stringify({ type: 'workflow_ready', workflow: conversation.generatedWorkflow })}\n\n`,
        );
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      res.end();
    }
  }

  /**
   * POST /workflow-ai/conversations/:id/confirm
   * Confirm and save the generated workflow.
   */
  @Post('conversations/:id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmWorkflowDto,
    @AgentWallet() walletAddress: string,
  ) {
    return this.workflowAiService.confirmWorkflow(
      id,
      walletAddress,
      dto.name,
      dto.description,
      dto.telegramChatId,
    );
  }

  /**
   * GET /workflow-ai/conversations/:id
   * Get conversation history and status.
   */
  @Get('conversations/:id')
  getConversation(@Param('id') id: string) {
    return this.workflowAiService.getConversation(id);
  }
}
