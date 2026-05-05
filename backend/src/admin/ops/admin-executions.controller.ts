import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { AdminAudit } from '../audit/audit.interceptor';
import { AdminOpsService } from './admin-ops.service';
import { AdminExecutionsService } from '../executions/admin-executions.service';
import { KillExecutionDto } from './dto/kill-execution.dto';
import type { AdminAccessClaims } from '../auth/admin-token.service';

@ApiTags('Admin Ops · Executions')
@ApiBearerAuth()
@Controller('admin/executions')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminExecutionsController {
  constructor(
    private readonly opsService: AdminOpsService,
    private readonly executionsService: AdminExecutionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List workflow executions (newest first)' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
  })
  @ApiQuery({ name: 'wallet', required: false })
  @ApiQuery({ name: 'workflowId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('status') status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
    @Query('wallet') wallet?: string,
    @Query('workflowId') workflowId?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.executionsService.listExecutions({
      status,
      wallet,
      workflowId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Post(':id/kill')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({ action: 'execution.kill', targetType: 'workflow_execution', targetIdParam: 'id' })
  @ApiOperation({
    summary:
      'Cancel a running workflow_execution. The row is updated in-place; pending/running only.',
  })
  async kill(
    @Param('id') id: string,
    @Body() dto: KillExecutionDto,
    @CurrentAdmin() claims: AdminAccessClaims,
  ) {
    const data = await this.opsService.killExecution(
      id,
      { id: claims.sub, email: claims.email, role: claims.role },
      dto.reason ?? null,
    );
    return { success: true, data };
  }
}
