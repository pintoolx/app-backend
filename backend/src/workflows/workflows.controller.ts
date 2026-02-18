import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WorkflowLifecycleManager } from './workflow-lifecycle.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@ApiTags('Workflows')
@Controller('workflows')
export class WorkflowsController {
  constructor(private lifecycleManager: WorkflowLifecycleManager) {}

  @Get('active')
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'List active workflow instances',
    description: 'Returns all workflow instances currently held in-memory by the lifecycle manager.',
  })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiResponse({ status: 200, description: 'List of active instances' })
  getActiveInstances() {
    const instances = this.lifecycleManager.getActiveInstances();
    return {
      success: true,
      count: instances.length,
      data: instances,
    };
  }
}
