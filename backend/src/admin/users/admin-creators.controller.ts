import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { CreatorSubscriptionsService } from '../../creator-subscriptions/creator-subscriptions.service';
import { AdminCreatorsService } from './admin-creators.service';

/**
 * Operator-only creator management. The verified flag drives the marketplace
 * badge and the `GET /creators/:wallet` profile response; the roster gives ops
 * a revenue-ranked view of every creator with a subscription plan.
 */
@ApiTags('Admin Creators')
@ApiBearerAuth()
@Controller('admin/creators')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminCreatorsController {
  constructor(
    private readonly creatorSubscriptionsService: CreatorSubscriptionsService,
    private readonly adminCreatorsService: AdminCreatorsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Creator roster: display name, verified flag, monthly price (SOL), payout wallet, active subscribers, live MRR and published-strategy count. Sorted by MRR descending.',
  })
  async list() {
    const data = await this.adminCreatorsService.listRoster();
    return { success: true, count: data.length, data };
  }

  @Patch(':wallet/verified')
  @ApiOperation({
    summary:
      'Toggle the verified trust badge on a creator subscription plan. Body: { verified: boolean }.',
  })
  async setVerified(@Param('wallet') wallet: string, @Body() body: { verified: boolean }) {
    const data = await this.creatorSubscriptionsService.setVerifiedFlag(
      wallet,
      Boolean(body.verified),
    );
    return { success: true, data };
  }
}
