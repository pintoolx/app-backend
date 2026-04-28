import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminAudit } from '../audit/audit.interceptor';
import { AdminOpsService } from './admin-ops.service';
import { AdminFollowerVaultsOpsService } from './admin-follower-vaults-ops.service';

@ApiTags('Admin Ops · Privacy')
@ApiBearerAuth()
@Controller('admin/privacy')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminPrivacyOpsController {
  constructor(
    private readonly opsService: AdminOpsService,
    private readonly followerVaultsOps: AdminFollowerVaultsOpsService,
  ) {}

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

  // -------- Phase 1 follower-vault mutation operations --------

  @Post('visibility-grants/:id/revoke')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({
    action: 'visibility_grant.revoke',
    targetType: 'visibility_grant',
    targetIdParam: 'id',
  })
  @ApiOperation({ summary: 'Revoke a follower visibility grant (operator+).' })
  async revokeVisibilityGrant(@Param('id') id: string) {
    const data = await this.followerVaultsOps.revokeVisibilityGrant(id);
    return { success: true, data };
  }

  @Post('follower-vaults/:id/pause')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({
    action: 'follower_vault.pause',
    targetType: 'follower_vault',
    targetIdParam: 'id',
  })
  @ApiOperation({
    summary:
      'Pause a follower vault and its parent subscription. Cycle fan-out skips paused vaults.',
  })
  async pauseFollowerVault(@Param('id') id: string) {
    const data = await this.followerVaultsOps.pauseFollowerVault(id);
    return { success: true, data };
  }

  @Post('follower-vaults/:id/recover')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({
    action: 'follower_vault.recover',
    targetType: 'follower_vault',
    targetIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Recover a paused follower vault back to active (and the parent subscription).',
  })
  async recoverFollowerVault(@Param('id') id: string) {
    const data = await this.followerVaultsOps.recoverFollowerVault(id);
    return { success: true, data };
  }

  @Post('private-cycles/:id/retry')
  @HttpCode(200)
  @AdminRoles('operator', 'superadmin')
  @AdminAudit({
    action: 'private_cycle.retry',
    targetType: 'private_cycle',
    targetIdParam: 'id',
  })
  @ApiOperation({
    summary:
      'Retry a completed/failed private execution cycle by spawning a new cycle with the same trigger and notional.',
  })
  async retryPrivateCycle(@Param('id') id: string) {
    const data = await this.followerVaultsOps.retryPrivateCycle(id);
    return { success: true, data };
  }
}
