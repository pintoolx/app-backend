import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminPrivacyService } from './admin-privacy.service';

@ApiTags('Admin Privacy')
@ApiBearerAuth()
@Controller('admin/privacy')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminPrivacyController {
  constructor(private readonly privacyService: AdminPrivacyService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Aggregated privacy and encryption status: adapter modes, PER token health, snapshot freshness, Umbra registrations, ER delegation counts',
  })
  async overview() {
    const data = await this.privacyService.getOverview();
    return { success: true, data };
  }

  @Get('per-tokens')
  @ApiOperation({
    summary: 'List PER auth tokens (token value redacted; only the first 8 chars shown)',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['challenge', 'active', 'revoked'] })
  @ApiQuery({ name: 'wallet', required: false })
  @ApiQuery({ name: 'deploymentId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listPerTokens(
    @Query('status') status?: 'challenge' | 'active' | 'revoked',
    @Query('wallet') wallet?: string,
    @Query('deploymentId') deploymentId?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.privacyService.listPerTokens({
      status,
      wallet,
      deploymentId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('snapshots')
  @ApiOperation({
    summary: 'List recent strategy_public_snapshots (newest first), optionally per-deployment',
  })
  @ApiQuery({ name: 'deploymentId', required: false })
  @ApiQuery({ name: 'since', required: false, description: 'ISO timestamp lower bound' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listSnapshots(
    @Query('deploymentId') deploymentId?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.privacyService.listSnapshots({
      deploymentId,
      since,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('keys')
  @AdminRoles('superadmin')
  @ApiOperation({
    summary:
      'Encryption-key inventory: presence + source + fingerprint for ADMIN_TOTP_ENC_KEY, UMBRA_MASTER_SEED, ADMIN_JWT_SECRET, keeper keypair. Secret material is never returned. Superadmin only.',
  })
  async keys() {
    const data = await this.privacyService.getKeyReport();
    return { success: true, data };
  }

  @Get('deployments/:id')
  @ApiOperation({
    summary:
      'Per-deployment privacy view: ER session, PER session + tokens, PP session, Umbra registration + on-chain pubkeys, recent public snapshots',
  })
  async deploymentView(@Param('id') id: string) {
    const data = await this.privacyService.getDeploymentPrivacyView(id);
    if (!data) {
      throw new NotFoundException('Deployment not found');
    }
    return { success: true, data };
  }
}
