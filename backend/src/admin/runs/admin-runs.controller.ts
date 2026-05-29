import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import {
  AdminRunsService,
  type ExecutionLayer,
  type StrategyRunStatus,
} from './admin-runs.service';

@ApiTags('Admin Runs')
@ApiBearerAuth()
@Controller('admin/runs')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminRunsController {
  constructor(private readonly runsService: AdminRunsService) {}

  @Get('health')
  @ApiOperation({
    summary:
      'Scheduler health for the live strategy_runs layer: 24h totals + success rate, currently-running, stuck (pending/running >10m), and retry-exhausted failures.',
  })
  async health() {
    const data = await this.runsService.getHealth();
    return { success: true, data };
  }

  @Get()
  @ApiOperation({
    summary:
      'List strategy runs (the live keeper scheduling layer that drives follower copy-trading), newest first.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
  })
  @ApiQuery({ name: 'executionLayer', required: false, enum: ['offchain', 'er', 'per'] })
  @ApiQuery({ name: 'deploymentId', required: false })
  @ApiQuery({
    name: 'stuckOnly',
    required: false,
    type: Boolean,
    description: 'Only pending/running runs older than 10 minutes',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('status') status?: StrategyRunStatus,
    @Query('executionLayer') executionLayer?: ExecutionLayer,
    @Query('deploymentId') deploymentId?: string,
    @Query('stuckOnly') stuckOnly?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.runsService.listRuns({
      status,
      executionLayer,
      deploymentId,
      stuckOnly: stuckOnly === 'true' || stuckOnly === '1',
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }
}
