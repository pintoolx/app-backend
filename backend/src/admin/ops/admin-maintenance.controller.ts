import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { AdminAudit } from '../audit/audit.interceptor';
import { AdminOpsService } from './admin-ops.service';
import { SetMaintenanceDto } from './dto/maintenance.dto';
import type { AdminAccessClaims } from '../auth/admin-token.service';

@ApiTags('Admin Ops · System')
@ApiBearerAuth()
@Controller('admin/system/maintenance')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminMaintenanceController {
  constructor(private readonly opsService: AdminOpsService) {}

  @Get()
  @ApiOperation({ summary: 'Read the current maintenance-mode state (any admin role).' })
  async get() {
    const data = await this.opsService.getMaintenance();
    return { success: true, data };
  }

  @Post()
  @HttpCode(200)
  @AdminRoles('superadmin')
  @AdminAudit({ action: 'system.maintenance', targetType: 'system_config' })
  @ApiOperation({
    summary:
      'Toggle maintenance mode (superadmin only). Affects user-facing routes via MaintenanceModeGuard. Admin paths always bypass.',
  })
  async set(@Body() dto: SetMaintenanceDto, @CurrentAdmin() claims: AdminAccessClaims) {
    const data = await this.opsService.setMaintenance({
      enabled: dto.enabled,
      message: dto.message ?? null,
      actor: { id: claims.sub, email: claims.email, role: claims.role },
    });
    return { success: true, data };
  }
}
