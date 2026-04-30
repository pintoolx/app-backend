import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PerAuthGuard } from '../magicblock/per-auth.guard';
import { type PerAuthTokenRow } from '../magicblock/per-auth-tokens.repository';
import { StrategyDeploymentsService } from './strategy-deployments.service';
import { StrategyRunsService } from '../strategy-keeper/strategy-runs.service';
import { StrategyDeploymentsRepository } from './strategy-deployments.repository';
import {
  StrategyPermissionsService,
  StrategyRole,
} from '../strategies/strategy-permissions.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { ErDelegateDto, ErRouteDto, ErUndelegateDto } from './dto/er-route.dto';
import {
  UmbraBalanceQueryDto,
  UmbraDepositDto,
  UmbraGrantDto,
  UmbraRegisterDto,
  UmbraTransferDto,
  UmbraWithdrawDto,
} from './dto/umbra.dto';
import { PerChallengeQueryDto, PerReplaceMembersDto, PerVerifyDto } from './dto/per.dto';
import {
  PpBalanceQueryDto,
  PpDepositDto,
  PpTransferDto,
  PpWithdrawDto,
} from './dto/private-payments.dto';

@ApiTags('Strategy Deployments')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class StrategyDeploymentsController {
  constructor(
    private readonly deploymentsService: StrategyDeploymentsService,
    private readonly strategyRunsService: StrategyRunsService,
    private readonly deploymentsRepository: StrategyDeploymentsRepository,
    private readonly permissionsService: StrategyPermissionsService,
  ) {}

  @Post('strategies/:id/deploy')
  @ApiOperation({ summary: 'Create a strategy deployment bound to an existing account/vault' })
  @ApiResponse({ status: 201, description: 'Deployment created successfully' })
  async createDeployment(
    @Param('id') strategyId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: CreateDeploymentDto,
  ) {
    const data = await this.deploymentsService.createDeployment(walletAddress, strategyId, dto);
    return { success: true, data };
  }

  @Get('deployments/me')
  @ApiOperation({ summary: 'List all deployments owned by the authenticated wallet' })
  async listMyDeployments(@CurrentUser('walletAddress') walletAddress: string) {
    const data = await this.deploymentsService.listDeploymentsForCreator(walletAddress);
    return { success: true, count: data.length, data };
  }

  @Get('deployments/:id')
  @ApiOperation({ summary: 'Get a single deployment owned by the authenticated wallet' })
  async getDeployment(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.deploymentsService.getDeploymentForCreator(id, walletAddress);
    return { success: true, data };
  }

  @Post('deployments/:id/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause a deployed strategy' })
  async pauseDeployment(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.deploymentsService.pauseDeployment(id, walletAddress);
    return { success: true, data };
  }

  @Post('deployments/:id/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume a paused deployment' })
  async resumeDeployment(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.deploymentsService.resumeDeployment(id, walletAddress);
    return { success: true, data };
  }

  @Post('deployments/:id/stop')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop a deployment (must already be deployed or paused)' })
  async stopDeployment(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.deploymentsService.stopDeployment(id, walletAddress);
    return { success: true, data };
  }

  @Post('deployments/:id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a stopped deployment (terminal state)' })
  async closeDeployment(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.deploymentsService.closeDeployment(id, walletAddress);
    return { success: true, data };
  }

  @Post('deployments/:id/collect-fees')
  @HttpCode(200)
  @ApiOperation({ summary: 'Collect accumulated fees from the vault authority' })
  async collectFees(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.deploymentsService.collectFees(id, walletAddress);
    return { success: true, data };
  }

  // -------- Phase 3.2 — Permission management --------

  @Post('deployments/:id/permissions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Grant a role to a wallet for this deployment (creator only)' })
  async grantPermission(
    @Param('id') deploymentId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: { memberWallet: string; role: StrategyRole },
  ) {
    // Only creator can grant permissions
    const deployment = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const result = await this.permissionsService.grantPermission(
      deploymentId,
      dto.memberWallet,
      dto.role,
    );
    return { success: !!result, data: result };
  }

  @Delete('deployments/:id/permissions/:memberWallet')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a role from a wallet for this deployment (creator only)' })
  async revokePermission(
    @Param('id') deploymentId: string,
    @Param('memberWallet') memberWallet: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: { role: StrategyRole },
  ) {
    const deployment = await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const ok = await this.permissionsService.revokePermission(deploymentId, memberWallet, dto.role);
    return { success: ok };
  }

  @Get('deployments/:id/permissions')
  @ApiOperation({ summary: 'List all explicit permissions for this deployment' })
  async listPermissions(
    @Param('id') deploymentId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    // Any owner can view permissions
    await this.deploymentsRepository.getForCreator(deploymentId, walletAddress);
    const data = await this.permissionsService.listPermissions(deploymentId);
    return { success: true, count: data.length, data };
  }

  // -------- Phase 1.3 — Manual strategy trigger --------

  @Post('deployments/:id/trigger')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manually trigger a strategy run for a deployed strategy' })
  @ApiResponse({ status: 200, description: 'Run created and queued for execution' })
  @ApiResponse({ status: 400, description: 'Deployment not in deployed state' })
  async triggerDeployment(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    // Verify ownership and state
    const deployment = await this.deploymentsRepository.getForCreator(id, walletAddress);
    if (deployment.lifecycle_status !== 'deployed') {
      return {
        success: false,
        error: `Deployment must be in 'deployed' state to trigger (current: ${deployment.lifecycle_status})`,
      };
    }

    const run = await this.strategyRunsService.createRun({
      deploymentId: deployment.id,
      executionLayer: deployment.execution_mode,
      strategyVersionId: deployment.strategy_version_id,
    });

    // Execute asynchronously so the HTTP response returns immediately
    this.strategyRunsService.executeRun(run.id).catch((err) => {
      // Errors are logged by StrategyRunsService; we don't await here.
    });

    return {
      success: true,
      data: {
        runId: run.id,
        deploymentId: deployment.id,
        executionLayer: deployment.execution_mode,
        status: run.status,
      },
    };
  }

  // -------- Week 4: Magic Block ER endpoints --------

  @Post('deployments/:id/er/delegate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delegate the deployment vault account to MagicBlock ER' })
  async erDelegate(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: ErDelegateDto,
  ) {
    const data = await this.deploymentsService.erDelegate(id, walletAddress, dto.signedTxBase64);
    return { success: true, data };
  }

  @Post('deployments/:id/er/route')
  @HttpCode(200)
  @ApiOperation({ summary: 'Forward a base64-encoded transaction through Magic Router' })
  async erRoute(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: ErRouteDto,
  ) {
    const data = await this.deploymentsService.erRoute(id, walletAddress, dto.base64Tx);
    return { success: true, data };
  }

  @Post('deployments/:id/er/undelegate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Commit ER state and undelegate the deployment account' })
  async erUndelegate(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: ErUndelegateDto,
  ) {
    const data = await this.deploymentsService.erUndelegate(id, walletAddress, dto.signedTxBase64);
    return { success: true, data };
  }

  // -------- Week 4: Umbra endpoints --------

  @Post('deployments/:id/umbra/register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register a per-deployment Umbra Encrypted User Account' })
  async umbraRegister(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: UmbraRegisterDto,
  ) {
    const data = await this.deploymentsService.umbraRegister(id, walletAddress, dto.mode);
    return { success: true, data };
  }

  @Post('deployments/:id/umbra/deposit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enqueue a shielded deposit for the deployment treasury' })
  async umbraDeposit(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: UmbraDepositDto,
  ) {
    const data = await this.deploymentsService.umbraDeposit(id, walletAddress, dto);
    return { success: true, data };
  }

  @Post('deployments/:id/umbra/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enqueue a shielded withdraw to a public wallet' })
  async umbraWithdraw(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: UmbraWithdrawDto,
  ) {
    const data = await this.deploymentsService.umbraWithdraw(id, walletAddress, dto);
    return { success: true, data };
  }

  @Post('deployments/:id/umbra/transfer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enqueue a shielded transfer between two deployment-known wallets' })
  async umbraTransfer(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: UmbraTransferDto,
  ) {
    const data = await this.deploymentsService.umbraTransfer(id, walletAddress, dto);
    return { success: true, data };
  }

  @Get('deployments/:id/umbra/balance')
  @ApiOperation({ summary: 'Read encrypted treasury balance via the Umbra indexer' })
  async umbraBalance(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Query() dto: UmbraBalanceQueryDto,
  ) {
    const data = await this.deploymentsService.umbraBalance(id, walletAddress, dto);
    return { success: true, data };
  }

  @Post('deployments/:id/umbra/grants')
  @HttpCode(200)
  @ApiOperation({ summary: 'Grant a viewer key for the deployment treasury balance' })
  async umbraGrant(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: UmbraGrantDto,
  ) {
    const data = await this.deploymentsService.umbraGrantViewer(id, walletAddress, dto);
    return { success: true, data };
  }

  // -------- Week 5: MagicBlock PER endpoints --------

  @Post('deployments/:id/per/groups')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace the PER permission group members for a deployment' })
  async perReplaceMembers(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: PerReplaceMembersDto,
  ) {
    const data = await this.deploymentsService.perReplaceMembers(id, walletAddress, dto.members);
    return { success: true, data };
  }

  @Get('deployments/:id/per/auth/challenge')
  @ApiOperation({ summary: 'Request a PER auth challenge nonce for a wallet' })
  async perChallenge(@Param('id') id: string, @Query() query: PerChallengeQueryDto) {
    const data = await this.deploymentsService.perRequestChallenge(id, query.wallet);
    return { success: true, data };
  }

  @Post('deployments/:id/per/auth/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a signed PER challenge and exchange it for a bearer token' })
  async perVerify(@Param('id') id: string, @Body() dto: PerVerifyDto) {
    const data = await this.deploymentsService.perVerifyChallenge(id, {
      walletAddress: dto.wallet,
      challenge: dto.challenge,
      signature: dto.signature,
    });
    return { success: true, data };
  }

  @Get('deployments/:id/per/private-state')
  @UseGuards(PerAuthGuard)
  @ApiOperation({ summary: 'Read PER private state (requires bearer per-auth-token)' })
  async perPrivateState(
    @Param('id') id: string,
    @Req() req: Request & { perToken?: PerAuthTokenRow },
  ) {
    const token = req.perToken!.token;
    const data = await this.deploymentsService.perGetPrivateState(id, token);
    return { success: true, data };
  }

  // -------- Week 5: Private Payments endpoints --------

  @Post('deployments/:id/pp/deposit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Build an unsigned Private Payments deposit transaction' })
  async ppDeposit(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: PpDepositDto,
  ) {
    const data = await this.deploymentsService.privatePaymentsDeposit(id, walletAddress, dto);
    return { success: true, data };
  }

  @Post('deployments/:id/pp/transfer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Build an unsigned Private Payments transfer transaction' })
  async ppTransfer(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: PpTransferDto,
  ) {
    const data = await this.deploymentsService.privatePaymentsTransfer(id, walletAddress, dto);
    return { success: true, data };
  }

  @Post('deployments/:id/pp/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Build an unsigned Private Payments withdraw transaction' })
  async ppWithdraw(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: PpWithdrawDto,
  ) {
    const data = await this.deploymentsService.privatePaymentsWithdraw(id, walletAddress, dto);
    return { success: true, data };
  }

  @Get('deployments/:id/pp/balance')
  @ApiOperation({ summary: 'Read Private Payments encrypted balance' })
  async ppBalance(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Query() dto: PpBalanceQueryDto,
  ) {
    const data = await this.deploymentsService.privatePaymentsBalance(id, walletAddress, dto);
    return { success: true, data };
  }
}
