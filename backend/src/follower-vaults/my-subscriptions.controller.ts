import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import type { SubscriptionStatus } from './subscriptions.repository';

const ALLOWED_STATUSES: ReadonlyArray<SubscriptionStatus> = [
  'pending_funding',
  'active',
  'paused',
  'exiting',
  'closed',
];

/**
 * Follower-side cross-deployment view of subscriptions. Mounted on a
 * dedicated `/subscriptions` root rather than under `/deployments/:id` so the
 * follower does not need to enumerate deployment ids first.
 */
@ApiTags('Follower Vaults — My Subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class MySubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('me')
  @ApiOperation({
    summary:
      'List every subscription owned by the authenticated wallet across all deployments. Optional status filter.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending_funding', 'active', 'paused', 'exiting', 'closed'],
  })
  async listMine(
    @CurrentUser('walletAddress') walletAddress: string,
    @Query('status') status?: string,
  ) {
    // Validate the status query param defensively. Anything other than the
    // known subscription states is rejected silently (treated as no filter)
    // to avoid leaking schema details via 400 messages.
    const filter: SubscriptionStatus | undefined =
      status && (ALLOWED_STATUSES as ReadonlyArray<string>).includes(status)
        ? (status as SubscriptionStatus)
        : undefined;
    const data = await this.subscriptionsService.listForFollower(walletAddress, {
      status: filter,
    });
    return { success: true, count: data.length, data };
  }
}
