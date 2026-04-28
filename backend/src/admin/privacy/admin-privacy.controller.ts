import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { AdminPrivacyService } from './admin-privacy.service';
import { AdminFollowerVaultsService } from './admin-follower-vaults.service';

@ApiTags('Admin Privacy')
@ApiBearerAuth()
@Controller('admin/privacy')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminPrivacyController {
  constructor(
    private readonly privacyService: AdminPrivacyService,
    private readonly followerVaultsService: AdminFollowerVaultsService,
  ) {}

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
      'Encryption-key inventory: presence + source + fingerprint for ADMIN_TOTP_ENC_KEY, Umbra keeper identity, ADMIN_JWT_SECRET, keeper keypair. Secret material is never returned. Superadmin only.',
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

  // -------- Phase 1 follower-vault observability --------

  @Get('deployments/:id/follower-vaults')
  @ApiOperation({ summary: 'List follower vaults for a deployment' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending_funding', 'active', 'paused', 'exiting', 'closed'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async deploymentFollowerVaults(
    @Param('id') deploymentId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.followerVaultsService.listFollowerVaults({
      deploymentId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('deployments/:id/subscriptions')
  @ApiOperation({ summary: 'List follower subscriptions for a deployment' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending_funding', 'active', 'paused', 'exiting', 'closed'],
  })
  @ApiQuery({ name: 'follower', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async deploymentSubscriptions(
    @Param('id') deploymentId: string,
    @Query('status') status?: string,
    @Query('follower') followerWallet?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.followerVaultsService.listSubscriptions({
      deploymentId,
      status,
      followerWallet,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('deployments/:id/private-cycles')
  @ApiOperation({ summary: 'List private execution cycles for a deployment' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['accepted', 'running', 'completed', 'failed'],
  })
  @ApiQuery({ name: 'since', required: false, description: 'ISO timestamp lower bound' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async deploymentPrivateCycles(
    @Param('id') deploymentId: string,
    @Query('status') status?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.followerVaultsService.listPrivateCycles({
      deploymentId,
      status,
      since,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('follower-vaults')
  @ApiOperation({ summary: 'List follower vaults across all deployments' })
  @ApiQuery({ name: 'deploymentId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending_funding', 'active', 'paused', 'exiting', 'closed'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listFollowerVaults(
    @Query('deploymentId') deploymentId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.followerVaultsService.listFollowerVaults({
      deploymentId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'List follower subscriptions across all deployments' })
  @ApiQuery({ name: 'deploymentId', required: false })
  @ApiQuery({ name: 'follower', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending_funding', 'active', 'paused', 'exiting', 'closed'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listSubscriptions(
    @Query('deploymentId') deploymentId?: string,
    @Query('follower') followerWallet?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.followerVaultsService.listSubscriptions({
      deploymentId,
      followerWallet,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('private-cycles')
  @ApiOperation({ summary: 'List private execution cycles across all deployments' })
  @ApiQuery({ name: 'deploymentId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['accepted', 'running', 'completed', 'failed'],
  })
  @ApiQuery({ name: 'since', required: false, description: 'ISO timestamp lower bound' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listPrivateCycles(
    @Query('deploymentId') deploymentId?: string,
    @Query('status') status?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.followerVaultsService.listPrivateCycles({
      deploymentId,
      status,
      since,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('private-cycles/:cycleId')
  @ApiOperation({
    summary: 'Get a single private execution cycle plus its sanitized per-follower receipts',
  })
  async getPrivateCycle(@Param('cycleId') cycleId: string) {
    const data = await this.followerVaultsService.getPrivateCycle(cycleId);
    return { success: true, data };
  }

  @Get('umbra-identities')
  @ApiOperation({
    summary:
      'Inventory of per-follower-vault Umbra identities. Surfaces signer pubkey and a 12-char salt prefix; the keeper master secret is never exposed.',
  })
  @ApiQuery({ name: 'deploymentId', required: false })
  @ApiQuery({
    name: 'registrationStatus',
    required: false,
    enum: ['pending', 'confirmed', 'failed'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listUmbraIdentities(
    @Query('deploymentId') deploymentId?: string,
    @Query('registrationStatus') registrationStatus?: 'pending' | 'confirmed' | 'failed',
    @Query('limit') limit?: string,
  ) {
    const data = await this.followerVaultsService.listUmbraIdentities({
      deploymentId,
      registrationStatus,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('visibility-grants')
  @ApiOperation({ summary: 'List follower visibility grants' })
  @ApiQuery({ name: 'subscriptionId', required: false })
  @ApiQuery({ name: 'grantee', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'revoked', 'expired'],
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listVisibilityGrants(
    @Query('subscriptionId') subscriptionId?: string,
    @Query('grantee') granteeWallet?: string,
    @Query('status') status?: 'active' | 'revoked' | 'expired',
    @Query('limit') limit?: string,
  ) {
    const data = await this.followerVaultsService.listVisibilityGrants({
      subscriptionId,
      granteeWallet,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }
}
