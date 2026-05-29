import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRevenueService } from './admin-revenue.service';

@ApiTags('Admin Revenue')
@ApiBearerAuth()
@Controller('admin/revenue')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminRevenueController {
  constructor(private readonly revenueService: AdminRevenueService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Money KPIs for the dashboard: MRR, trailing-30d collected (creator subscriptions + strategy buyouts), lifetime collected, subscription counts by status, payment confirm/reject rate, and plan counts. All amounts in native SOL (lamports + sol).',
  })
  async summary() {
    const data = await this.revenueService.getSummary();
    return { success: true, data };
  }

  @Get('payments')
  @ApiOperation({
    summary:
      'Creator-subscription payment ledger (confirmed + rejected), newest first. Amounts are lamports; tx_signature links to the on-chain transfer.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['confirmed', 'rejected'] })
  @ApiQuery({ name: 'creator', required: false })
  @ApiQuery({ name: 'subscriber', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async payments(
    @Query('status') status?: 'confirmed' | 'rejected',
    @Query('creator') creator?: string,
    @Query('subscriber') subscriber?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.revenueService.listPayments({
      status,
      creatorWallet: creator,
      subscriberWallet: subscriber,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('buyouts')
  @ApiOperation({
    summary:
      'Strategy one-time buyout ledger, newest first. Amounts are lamports; payment_tx_signature is the on-chain idempotency key.',
  })
  @ApiQuery({ name: 'strategyId', required: false })
  @ApiQuery({ name: 'buyer', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async buyouts(
    @Query('strategyId') strategyId?: string,
    @Query('buyer') buyer?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.revenueService.listBuyouts({
      strategyId,
      buyerWallet: buyer,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }
}
