import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  ConfirmCreatorSubscriptionPaymentDto,
  UpsertCreatorSubscriptionPlanDto,
} from './dto/creator-subscription.dto';
import { CreatorSubscriptionsService } from './creator-subscriptions.service';

@ApiTags('Creator Subscriptions')
@Controller('creator-subscriptions')
export class CreatorSubscriptionsController {
  constructor(private readonly creatorSubscriptionsService: CreatorSubscriptionsService) {}

  @Patch('plan')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Creator: set or update the monthly subscription plan' })
  @ApiResponse({ status: 200, description: 'Creator subscription plan updated' })
  async upsertPlan(
    @CurrentUser('walletAddress') creatorWallet: string,
    @Body() dto: UpsertCreatorSubscriptionPlanDto,
  ) {
    const data = await this.creatorSubscriptionsService.upsertPlan(creatorWallet, {
      monthlyPriceAmount: dto.monthlyPriceAmount,
      payoutWallet: dto.payoutWallet,
      metadata: dto.metadata,
    });
    return { success: true, data };
  }

  @Get('creators/:creatorWallet/plan')
  @ApiOperation({ summary: 'Read a creator monthly subscription plan' })
  @ApiResponse({ status: 200, description: 'Creator subscription plan returned' })
  async getPlan(@Param('creatorWallet') creatorWallet: string) {
    const data = await this.creatorSubscriptionsService.getPlan(creatorWallet);
    return { success: true, data };
  }

  @Post('creators/:creatorWallet/intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscriber: create or refresh a creator subscription intent' })
  @ApiResponse({ status: 201, description: 'Creator subscription intent returned' })
  async createIntent(
    @Param('creatorWallet') creatorWallet: string,
    @CurrentUser('walletAddress') subscriberWallet: string,
  ) {
    const data = await this.creatorSubscriptionsService.createIntent(
      creatorWallet,
      subscriberWallet,
    );
    return { success: true, data };
  }

  @Get('creators/:creatorWallet/payment-intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscriber: get payment details for an existing intent' })
  @ApiResponse({ status: 200, description: 'Payment intent returned' })
  async paymentIntent(
    @Param('creatorWallet') creatorWallet: string,
    @CurrentUser('walletAddress') subscriberWallet: string,
  ) {
    const data = await this.creatorSubscriptionsService.buildPaymentIntent(
      creatorWallet,
      subscriberWallet,
    );
    return { success: true, data };
  }

  @Post('creators/:creatorWallet/confirm-payment')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscriber: confirm a USDC payment transaction and activate access' })
  @ApiResponse({ status: 200, description: 'Creator subscription activated' })
  async confirmPayment(
    @Param('creatorWallet') creatorWallet: string,
    @CurrentUser('walletAddress') subscriberWallet: string,
    @Body() dto: ConfirmCreatorSubscriptionPaymentDto,
  ) {
    const data = await this.creatorSubscriptionsService.confirmPayment(
      creatorWallet,
      subscriberWallet,
      dto.txSignature,
    );
    return { success: true, data };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscriber: list my creator-level subscriptions' })
  @ApiResponse({ status: 200, description: 'Creator subscriptions returned' })
  async listMine(@CurrentUser('walletAddress') subscriberWallet: string) {
    const data = await this.creatorSubscriptionsService.listMine(subscriberWallet);
    return { success: true, count: data.length, data };
  }

  @Post('creators/:creatorWallet/cancel')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscriber: cancel a creator-level subscription' })
  @ApiResponse({ status: 200, description: 'Creator subscription cancelled' })
  async cancel(
    @Param('creatorWallet') creatorWallet: string,
    @CurrentUser('walletAddress') subscriberWallet: string,
  ) {
    const data = await this.creatorSubscriptionsService.cancel(creatorWallet, subscriberWallet);
    return { success: true, data };
  }
}
