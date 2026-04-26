import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminAudit } from '../audit/audit.interceptor';
import { AdminOpsService } from './admin-ops.service';

@ApiTags('Admin Ops · Privacy')
@ApiBearerAuth()
@Controller('admin/privacy')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminPrivacyOpsController {
  constructor(private readonly opsService: AdminOpsService) {}

  @Post('per-tokens/:token/revoke')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({ action: 'per_token.revoke', targetType: 'per_token', targetIdParam: 'token' })
  @ApiOperation({ summary: 'Revoke a single PER auth token (operator+).' })
  async revokeToken(@Param('token') token: string) {
    const data = await this.opsService.revokePerToken(token);
    return { success: true, data };
  }

  @Post('deployments/:id/revoke-all-tokens')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({
    action: 'per_token.revoke_all',
    targetType: 'deployment',
    targetIdParam: 'id',
  })
  @ApiOperation({ summary: 'Revoke every active PER token for a deployment (operator+).' })
  async revokeAll(@Param('id') id: string) {
    const data = await this.opsService.revokeAllPerTokensForDeployment(id);
    return { success: true, data };
  }
}
