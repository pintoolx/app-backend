import { Controller, Post, Get, Body, Param, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { WorkflowsService } from './workflows.service';
import { WorkflowLifecycleManager } from './workflow-lifecycle.service';
import { ExecuteWorkflowDto } from './dto/execute-workflow.dto';
import { AuthService } from '../auth/auth.service';

@ApiTags('Workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private workflowsService: WorkflowsService,
    private lifecycleManager: WorkflowLifecycleManager,
    private authService: AuthService,
  ) {}

  @Get('active')
  @ApiOperation({
    summary: 'List active workflow instances',
    description: 'Returns all workflow instances currently held in-memory by the lifecycle manager.',
  })
  @ApiResponse({ status: 200, description: 'List of active instances' })
  getActiveInstances() {
    const instances = this.lifecycleManager.getActiveInstances();
    return {
      success: true,
      count: instances.length,
      data: instances,
    };
  }

  @Post(':id/execute')
  @ApiOperation({
    summary: 'Execute workflow',
    description: 'Execute a workflow manually. Requires signature verification.',
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
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async executeWorkflow(@Param('id') id: string, @Body() executeDto: ExecuteWorkflowDto) {
    // 1. Verify Signature
    const isValid = await this.authService.verifyAndConsumeChallenge(
      executeDto.walletAddress,
      executeDto.signature,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature or challenge expired');
    }

    // 2. Execute with verified wallet address
    const execution = await this.workflowsService.executeWorkflow(
      id,
      executeDto.walletAddress,
      executeDto,
    );
    return {
      success: true,
      data: execution,
    };
  }
}
