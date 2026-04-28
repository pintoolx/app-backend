import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import {
  CreateSubscriptionDto,
  CreateVisibilityGrantDto,
  FundIntentDto,
  ShieldFundsDto,
} from './dto/subscription.dto';

@ApiTags('Follower Vaults — Subscriptions')
@ApiBearerAuth()
@Controller('deployments/:deploymentId/subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

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
