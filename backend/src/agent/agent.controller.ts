import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { CrossmintService } from '../crossmint/crossmint.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AgentWallet } from '../common/decorators/agent-wallet.decorator';
import { AgentRegisterDto } from './dto/agent-register.dto';
import { AgentInitWalletDto } from './dto/agent-init-wallet.dto';
import { CreateWorkflowDto } from '../workflows/dto/create-workflow.dto';
import { getRegisteredNodes } from '../web3/nodes/node-registry';

@ApiTags('Agent')
@Controller('agent')
export class AgentController {
  constructor(
    private agentService: AgentService,
    private crossmintService: CrossmintService,
    private workflowsService: WorkflowsService,
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

  @Get('nodes')
  @ApiOperation({ summary: 'List all available node types and their parameters' })
  @ApiResponse({ status: 200, description: 'List of node type schemas' })
  async listNodes() {
    const registry = getRegisteredNodes();
    const nodes = Array.from(registry.entries()).map(([type, factory]) => {
      const node = factory();
      const desc = node.description;
      return {
        type,
        displayName: desc.displayName,
        description: desc.description,
        group: desc.group,
        inputs: desc.inputs,
        outputs: desc.outputs,
        isTrigger: desc.isTrigger ?? false,
        telegramNotify: desc.telegramNotify,
        parameters: desc.properties.map((p) => ({
          name: p.name,
          type: p.type,
          default: p.default,
          description: p.description,
          ...(p.options ? { options: p.options } : {}),
        })),
      };
    });
    return { success: true, data: nodes };
  }

  @Post('workflows')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Create a workflow' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 201, description: 'Workflow created' })
  async createWorkflow(@AgentWallet() walletAddress: string, @Body() dto: CreateWorkflowDto) {
    const workflow = await this.workflowsService.createWorkflow(walletAddress, dto);
    return { success: true, data: workflow };
  }

  @Post('wallets/init')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Create account with Crossmint wallet' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 201, description: 'Account created' })
  async initWallet(@AgentWallet() walletAddress: string, @Body() dto: AgentInitWalletDto) {
    const account = await this.crossmintService.createAccountWithWallet(walletAddress, dto.accountName, dto.workflowId);
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
}
