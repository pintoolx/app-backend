import { Controller, Post, Get, Param, Body, Res, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { WorkflowAiService } from './workflow-ai.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ConfirmWorkflowDto } from './dto/confirm-workflow.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AgentWallet } from '../common/decorators/agent-wallet.decorator';

@ApiTags('Workflow AI')
@ApiHeader({ name: 'X-API-Key', description: 'Agent API key', required: true })
@Controller('workflow-ai')
@UseGuards(ApiKeyGuard)
export class WorkflowAiController {
  constructor(private readonly workflowAiService: WorkflowAiService) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Create a new AI conversation for workflow generation' })
  @ApiResponse({ status: 201, description: 'Conversation created successfully' })
  createConversation(@AgentWallet() walletAddress: string) {
    const conversation = this.workflowAiService.createConversation(walletAddress);
    return {
      id: conversation.id,
      status: conversation.status,
      createdAt: conversation.createdAt,
    };
  }

  @Post('conversations/:id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a message and stream AI response via SSE' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'SSE stream with text chunks and optional workflow_ready event' })
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

  @Post('conversations/:id/confirm')
  @ApiOperation({ summary: 'Confirm and save the generated workflow' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({ status: 201, description: 'Workflow confirmed and saved' })
  @ApiResponse({ status: 400, description: 'No workflow generated yet or wallet mismatch' })
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

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get conversation history and status' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Conversation details' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  getConversation(@Param('id') id: string) {
    return this.workflowAiService.getConversation(id);
  }
}
