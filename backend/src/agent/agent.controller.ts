import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { CrossmintService } from '../crossmint/crossmint.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { SupabaseService } from '../database/supabase.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AgentWallet } from '../common/decorators/agent-wallet.decorator';
import { AgentRegisterDto } from './dto/agent-register.dto';
import { AgentInitWalletDto } from './dto/agent-init-wallet.dto';
import { AgentExecuteWorkflowDto } from './dto/agent-execute-workflow.dto';
import { CreateWorkflowDto } from '../workflows/dto/create-workflow.dto';

@ApiTags('Agent')
@Controller('agent')
export class AgentController {
  constructor(
    private agentService: AgentService,
    private crossmintService: CrossmintService,
    private workflowsService: WorkflowsService,
    private supabaseService: SupabaseService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register agent and get API key',
    description: 'Agent authenticates with wallet signature (same challenge flow as humans) and receives an API key for subsequent requests.',
  })
  @ApiResponse({ status: 201, description: 'Agent registered, API key returned' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async register(@Body() dto: AgentRegisterDto) {
    const result = await this.agentService.registerAgent(dto.walletAddress, dto.signature);
    return { success: true, data: result };
  }

  @Get('accounts')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'List agent accounts' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 200, description: 'List of accounts' })
  async listAccounts(@AgentWallet() walletAddress: string) {
    const accounts = await this.agentService.getAgentAccounts(walletAddress);
    return { success: true, data: accounts };
  }

  @Post('wallets/init')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Create account with Crossmint wallet' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 201, description: 'Account created' })
  async initWallet(@AgentWallet() walletAddress: string, @Body() dto: AgentInitWalletDto) {
    const account = await this.crossmintService.createAccountWithWallet(walletAddress, dto.accountName);
    return { success: true, data: account };
  }

  @Delete('wallets/:id')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Close account (withdraws all assets to owner wallet)' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 200, description: 'Account closed' })
  async deleteWallet(@Param('id') id: string, @AgentWallet() walletAddress: string) {
    const result = await this.crossmintService.deleteWallet(id, walletAddress);
    return { success: true, message: 'Account closed and assets withdrawn', data: result.withdrawResult };
  }

  @Post('workflows')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Create a workflow' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 201, description: 'Workflow created' })
  async createWorkflow(@AgentWallet() walletAddress: string, @Body() dto: CreateWorkflowDto) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .insert({
        owner_wallet_address: walletAddress,
        name: dto.name,
        description: dto.description || null,
        definition: dto.definition,
        is_public: false,
      })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(`Failed to create workflow: ${error.message}`);
    }

    return { success: true, data };
  }

  @Post('workflows/:id/execute')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Execute a workflow' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 200, description: 'Workflow execution started' })
  async executeWorkflow(
    @Param('id') id: string,
    @AgentWallet() walletAddress: string,
    @Body() dto: AgentExecuteWorkflowDto,
  ) {
    const execution = await this.workflowsService.executeWorkflow(id, walletAddress, dto);
    return { success: true, data: execution };
  }

  @Get('workflows/:id/executions/:executionId')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Get workflow execution status' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 200, description: 'Execution status' })
  async getExecutionStatus(
    @Param('id') id: string,
    @Param('executionId') executionId: string,
    @AgentWallet() walletAddress: string,
  ) {
    const { data, error } = await this.supabaseService.client
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .eq('workflow_id', id)
      .eq('owner_wallet_address', walletAddress)
      .single();

    if (error || !data) {
      throw new NotFoundException('Execution not found');
    }

    return { success: true, data };
  }
}
