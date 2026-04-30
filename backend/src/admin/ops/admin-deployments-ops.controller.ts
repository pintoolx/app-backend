import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { AdminAudit } from '../audit/audit.interceptor';
import { AdminOpsService } from './admin-ops.service';
import { AdminConfirmDto } from './dto/confirm.dto';
import type { AdminAccessClaims } from '../auth/admin-token.service';

@ApiTags('Admin Ops · Deployments')
@ApiBearerAuth()
@Controller('admin/deployments')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminDeploymentsOpsController {
  constructor(private readonly opsService: AdminOpsService) {}

  @Post(':id/pause')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({ action: 'deployment.pause', targetType: 'deployment', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Pause an active deployment (operator+).' })
  async pause(@Param('id') id: string) {
    const data = await this.opsService.pauseDeployment(id);
    return { success: true, data };
  }

  @Post(':id/resume')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({ action: 'deployment.resume', targetType: 'deployment', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Resume a paused deployment (operator+).' })
  async resume(@Param('id') id: string) {
    const data = await this.opsService.resumeDeployment(id);
    return { success: true, data };
  }

  @Post(':id/stop')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({ action: 'deployment.stop', targetType: 'deployment', targetIdParam: 'id' })
  @ApiOperation({
    summary: 'Stop a deployment. Body must echo the deployment id in `confirmTargetId`.',
  })
  async stop(@Param('id') id: string, @Body() dto: AdminConfirmDto) {
    if (dto.confirmTargetId !== id) {
      throw new BadRequestException('confirmTargetId must equal the path :id');
    }
    const data = await this.opsService.stopDeployment(id);
    return { success: true, data };
  }

  @Post(':id/force-close')
  @HttpCode(200)
  @AdminRoles('superadmin')
  @AdminAudit({ action: 'deployment.force_close', targetType: 'deployment', targetIdParam: 'id' })
  @ApiOperation({
    summary:
      'Force-close a deployment via the on-chain adapter and revoke PER tokens. Superadmin only. Body must echo the deployment id in `confirmTargetId`.',
  })
  async forceClose(
    @Param('id') id: string,
    @Body() dto: AdminConfirmDto,
    @CurrentAdmin() claims: AdminAccessClaims,
  ) {
    if (dto.confirmTargetId !== id) {
      throw new BadRequestException('confirmTargetId must equal the path :id');
    }
    const data = await this.opsService.forceCloseDeployment(id, {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
    });
    return { success: true, data };
  }

  @Post(':id/emergency-pause')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({ action: 'deployment.emergency_pause', targetType: 'deployment', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Emergency pause a deployed deployment (operator+).' })
  async emergencyPause(
    @Param('id') id: string,
    @CurrentAdmin() claims: AdminAccessClaims,
  ) {
    const data = await this.opsService.emergencyPauseDeployment(id, {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
    });
    return { success: true, data };
  }

  @Post(':id/emergency-resume')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({ action: 'deployment.emergency_resume', targetType: 'deployment', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Emergency resume a paused deployment (operator+).' })
  async emergencyResume(
    @Param('id') id: string,
    @CurrentAdmin() claims: AdminAccessClaims,
  ) {
    const data = await this.opsService.emergencyResumeDeployment(id, {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
    });
    return { success: true, data };
  }

  @Post(':id/collect-fees')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({ action: 'deployment.collect_fees', targetType: 'deployment', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Collect accumulated fees from the vault authority (operator+).' })
  async collectFees(
    @Param('id') id: string,
    @CurrentAdmin() claims: AdminAccessClaims,
  ) {
    const data = await this.opsService.collectFees(id, {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
    });
    return { success: true, data };
  }
}
