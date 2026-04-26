import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminDeploymentsService } from './admin-deployments.service';

@ApiTags('Admin Deployments')
@ApiBearerAuth()
@Controller('admin/deployments')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminDeploymentsController {
  constructor(private readonly deploymentsService: AdminDeploymentsService) {}

  @Get()
  @ApiOperation({ summary: 'List strategy deployments (admin scope; bypasses creator filter)' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['draft', 'deployed', 'paused', 'stopped', 'closed'],
  })
  @ApiQuery({ name: 'creator', required: false })
  @ApiQuery({ name: 'strategyId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('status') status?: 'draft' | 'deployed' | 'paused' | 'stopped' | 'closed',
    @Query('creator') creator?: string,
    @Query('strategyId') strategyId?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.deploymentsService.listDeployments({
      status,
      creator,
      strategyId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Deployment detail with recent strategy_runs' })
  async detail(@Param('id') id: string) {
    const data = await this.deploymentsService.getDeploymentDetail(id);
    return { success: true, data };
  }
}
