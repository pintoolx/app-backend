import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { AdminAudit } from '../audit/audit.interceptor';
import { AdminOpsService } from './admin-ops.service';
import { KillExecutionDto } from './dto/kill-execution.dto';
import type { AdminAccessClaims } from '../auth/admin-token.service';

@ApiTags('Admin Ops · Executions')
@ApiBearerAuth()
@Controller('admin/executions')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminExecutionsController {
  constructor(private readonly opsService: AdminOpsService) {}

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
