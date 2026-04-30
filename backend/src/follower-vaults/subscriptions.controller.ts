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
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PerAuthGuard, assertSubscriptionScope } from '../magicblock/per-auth.guard';
import type { PerAuthTokenRow } from '../magicblock/per-auth-tokens.repository';
import { SubscriptionsService } from './subscriptions.service';
import { FundIntentSubmissionService } from './fund-intent-submission.service';
import {
  CreateSubscriptionDto,
  CreateVisibilityGrantDto,
  FundIntentDto,
  ShieldFundsDto,
  SubmitFundIntentDto,
  VerifySubscriptionChallengeDto,
} from './dto/subscription.dto';

@ApiTags('Follower Vaults — Subscriptions')
@ApiBearerAuth()
@Controller('deployments/:deploymentId/subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly fundIntentSubmissionService: FundIntentSubmissionService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a follower subscription for the authenticated wallet. Provisions a follower vault and a per-vault Umbra identity.',
  })
  async createSubscription(
    @Param('deploymentId') deploymentId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    const data = await this.subscriptionsService.createSubscription(
      deploymentId,
      dto.followerWallet ?? walletAddress,
      {
        visibilityPreset: dto.visibilityPreset,
        maxCapital: dto.maxCapital,
        allocationMode: dto.allocationMode,
        maxDrawdownBps: dto.maxDrawdownBps,
      },
    );
    return { success: true, data };
  }

  @Get()
  @ApiOperation({
    summary:
      'List every follower subscription attached to this deployment. Creator-only.',
  })
  async listForDeployment(
    @Param('deploymentId') deploymentId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.listForDeployment(deploymentId, walletAddress);
    return { success: true, count: data.length, data };
  }

  @Get(':subscriptionId')
  @ApiOperation({ summary: 'Public lifecycle view for a single follower subscription' })
  async getSubscription(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    const data = await this.subscriptionsService.getSubscriptionView(deploymentId, subscriptionId);
    return { success: true, data };
  }

  @Post(':subscriptionId/fund-intent')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Build a public funding plan for the follower vault. Returns instructions; does not sign.',
  })
  async fundIntent(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: FundIntentDto,
  ) {
    const data = await this.subscriptionsService.fundIntent(
      deploymentId,
      subscriptionId,
      walletAddress,
      dto,
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/submit-fund-intent')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Phase 2.1 — Submit a signed fund-intent transaction on-chain.',
  })
  async submitFundIntent(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: SubmitFundIntentDto,
  ) {
    const data = await this.fundIntentSubmissionService.submitFundIntent(
      deploymentId,
      subscriptionId,
      walletAddress,
      dto.signedTxBase64,
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/shield')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Shield follower funds into the per-vault Umbra treasury domain. Flips the subscription to active when the deposit is queued.',
  })
  async shield(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: ShieldFundsDto,
  ) {
    const data = await this.subscriptionsService.shieldFunds(
      deploymentId,
      subscriptionId,
      walletAddress,
      dto,
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause new mirror executions for this follower' })
  async pause(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.transitionStatus(
      deploymentId,
      subscriptionId,
      walletAddress,
      'paused',
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume a paused subscription' })
  async resume(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.transitionStatus(
      deploymentId,
      subscriptionId,
      walletAddress,
      'active',
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/unsubscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin exit flow' })
  async unsubscribe(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.transitionStatus(
      deploymentId,
      subscriptionId,
      walletAddress,
      'exiting',
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/redeem')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Finalize exit: closes the subscription and the underlying follower vault',
  })
  async redeem(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.transitionStatus(
      deploymentId,
      subscriptionId,
      walletAddress,
      'closed',
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/resume-provisioning')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Phase-2: resume an interrupted on-chain provisioning flow. Picks up from the last successful state machine step.',
  })
  async resumeProvisioning(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.resumeSubscriptionProvisioning(
      deploymentId,
      subscriptionId,
      walletAddress,
    );
    return { success: true, data };
  }

  @Get(':subscriptionId/private-balance')
  @ApiOperation({
    summary:
      'Read the encrypted treasury balance for the follower vault using the per-vault Umbra identity',
  })
  async privateBalance(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Query('mint') mint: string,
  ) {
    const data = await this.subscriptionsService.getPrivateBalance(
      deploymentId,
      subscriptionId,
      walletAddress,
      { mint },
    );
    return { success: true, data };
  }

  // ------------------------------ Phase-1 follower-self PER auth & state

  @Get(':subscriptionId/per/auth/challenge')
  @ApiOperation({
    summary:
      'Issue a subscription-scoped PER auth challenge bound to the authenticated follower wallet.',
  })
  async perAuthChallenge(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.issueSubscriptionChallenge(
      deploymentId,
      subscriptionId,
      walletAddress,
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/per/auth/verify')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Verify a subscription-scoped PER challenge and return an active follower-self PER token.',
  })
  async perAuthVerify(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: VerifySubscriptionChallengeDto,
  ) {
    const data = await this.subscriptionsService.verifySubscriptionChallenge(
      deploymentId,
      subscriptionId,
      walletAddress,
      dto.challenge,
    );
    return { success: true, data };
  }

  @Get(':subscriptionId/private-state')
  @UseGuards(PerAuthGuard)
  @ApiOperation({
    summary:
      'Read sanitized follower-private state. Requires a subscription-scoped PER token in Authorization or X-PER-Token.',
  })
  async privateState(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Req() req: Request & { perToken?: PerAuthTokenRow },
  ) {
    assertSubscriptionScope(req.perToken, subscriptionId);
    const data = await this.subscriptionsService.getFollowerPrivateState(
      deploymentId,
      subscriptionId,
      walletAddress,
      req.perToken,
    );
    return { success: true, data };
  }

  @Post(':subscriptionId/visibility-grants')
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue a bounded visibility grant for this subscription' })
  async createGrant(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: CreateVisibilityGrantDto,
  ) {
    const data = await this.subscriptionsService.createGrant(
      deploymentId,
      subscriptionId,
      walletAddress,
      {
        granteeWallet: dto.granteeWallet,
        scope: dto.scope,
        expiresAt: dto.expiresAt,
      },
    );
    return { success: true, data };
  }

  @Get(':subscriptionId/visibility-grants')
  @ApiOperation({ summary: 'List visibility grants for this subscription' })
  async listGrants(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.listGrants(
      deploymentId,
      subscriptionId,
      walletAddress,
    );
    return { success: true, count: data.length, data };
  }

  @Get(':subscriptionId/visibility-grants/:grantId')
  @ApiOperation({ summary: 'Read a single visibility grant for this subscription' })
  async getGrant(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Param('grantId') grantId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.getGrant(
      deploymentId,
      subscriptionId,
      walletAddress,
      grantId,
    );
    return { success: true, data };
  }

  @Delete(':subscriptionId/visibility-grants/:grantId')
  @ApiOperation({ summary: 'Revoke a visibility grant' })
  async revokeGrant(
    @Param('deploymentId') deploymentId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Param('grantId') grantId: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.subscriptionsService.revokeGrant(
      deploymentId,
      subscriptionId,
      walletAddress,
      grantId,
    );
    return { success: true, data };
  }
}
