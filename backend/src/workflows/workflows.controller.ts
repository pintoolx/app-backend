import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkflowsService } from './workflows.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { ExecuteWorkflowDto } from './dto/execute-workflow.dto';

@ApiTags('Workflows')
@ApiBearerAuth('JWT-auth')
@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private workflowsService: WorkflowsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all workflows',
    description: 'Retrieve all workflows owned by the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflows retrieved successfully',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'SOL Price Monitor',
            description: 'Monitor SOL price',
            is_active: true,
            created_at: '2024-01-01T00:00:00Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getWorkflows(@CurrentUser('walletAddress') walletAddress: string) {
    const workflows = await this.workflowsService.getWorkflows(walletAddress);
    return {
      success: true,
      data: workflows,
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new workflow',
    description: 'Create a new workflow with nodes and connections',
  })
  @ApiResponse({
    status: 201,
    description: 'Workflow created successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid workflow definition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createWorkflow(
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() createDto: CreateWorkflowDto,
  ) {
    const workflow = await this.workflowsService.createWorkflow(walletAddress, createDto);
    return {
      success: true,
      data: workflow,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get workflow by ID',
    description: 'Retrieve a specific workflow by its ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Workflow ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getWorkflow(@Param('id') id: string, @CurrentUser('walletAddress') walletAddress: string) {
    const workflow = await this.workflowsService.getWorkflow(id, walletAddress);
    return {
      success: true,
      data: workflow,
    };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update workflow',
    description: 'Update an existing workflow',
  })
  @ApiParam({
    name: 'id',
    description: 'Workflow ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateWorkflow(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() updateDto: UpdateWorkflowDto,
  ) {
    const workflow = await this.workflowsService.updateWorkflow(id, walletAddress, updateDto);
    return {
      success: true,
      data: workflow,
    };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete workflow',
    description: 'Delete a workflow by ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Workflow ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteWorkflow(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    await this.workflowsService.deleteWorkflow(id, walletAddress);
    return {
      success: true,
      message: 'Workflow deleted successfully',
    };
  }

  @Post(':id/execute')
  @ApiOperation({
    summary: 'Execute workflow',
    description: 'Execute a workflow manually',
  })
  @ApiParam({
    name: 'id',
    description: 'Workflow ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow execution started',
    schema: {
      example: {
        success: true,
        data: {
          executionId: '987e6543-e21b-12d3-a456-426614174000',
          status: 'running',
          startedAt: '2024-01-01T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async executeWorkflow(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() executeDto: ExecuteWorkflowDto,
  ) {
    const execution = await this.workflowsService.executeWorkflow(id, walletAddress, executeDto);
    return {
      success: true,
      data: execution,
    };
  }
}
