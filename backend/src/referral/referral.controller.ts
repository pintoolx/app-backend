import { Body, Controller, Get, Patch, Post, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReferralService } from './referral.service';
import { AdminGenerateReferralCodesDto } from './dto/admin-generate-referral-codes.dto';
import { SetReferralQuotaDto } from './dto/set-referral-quota.dto';
import { GenerateUserReferralCodesDto } from './dto/generate-user-referral-codes.dto';
import { RedeemReferralCodeDto } from './dto/redeem-referral-code.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Referrals')
@ApiBearerAuth()
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post('admin/codes')
  @ApiOperation({
    summary: 'Admin: generate single-use referral codes for a target wallet',
  })
  @ApiResponse({ status: 201, description: 'Referral codes generated' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Admin permission required' })
  async adminGenerateCodes(
    @CurrentUser('walletAddress') adminWalletAddress: string,
    @Body() dto: AdminGenerateReferralCodesDto,
  ) {
    const data = await this.referralService.adminGenerateCodes({
      adminWalletAddress,
      targetWalletAddress: dto.targetWalletAddress,
      count: dto.count,
      expiresAt: dto.expiresAt,
      metadata: dto.metadata,
    });

    return { success: true, count: data.length, data };
  }

  @Patch('admin/quotas/:walletAddress')
  @ApiOperation({
    summary: 'Admin: set lifetime referral-code quota for a user wallet',
  })
  @ApiResponse({ status: 200, description: 'Quota updated' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Admin permission required' })
  async setQuota(
    @CurrentUser('walletAddress') adminWalletAddress: string,
    @Param('walletAddress') walletAddress: string,
    @Body() dto: SetReferralQuotaDto,
  ) {
    const data = await this.referralService.setUserQuota(adminWalletAddress, walletAddress, dto.maxCodes);

    return { success: true, data };
  }

  @Post('codes')
  @ApiOperation({
    summary: 'User: generate single-use referral codes within lifetime quota',
  })
  @ApiResponse({ status: 201, description: 'Referral codes generated' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async userGenerateCodes(
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: GenerateUserReferralCodesDto,
  ) {
    const data = await this.referralService.userGenerateCodes({
      walletAddress,
      count: dto.count,
      expiresAt: dto.expiresAt,
      metadata: dto.metadata,
    });

    return { success: true, count: data.length, data };
  }

  @Post('redeem')
  @ApiOperation({
    summary: 'Redeem a single-use referral code',
  })
  @ApiResponse({ status: 200, description: 'Referral code redeemed' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async redeem(
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: RedeemReferralCodeDto,
  ) {
    const data = await this.referralService.redeemCode(walletAddress, dto.code, dto.metadata);

    return { success: true, data };
  }

  @Get('my-codes')
  @ApiOperation({
    summary: 'List referral codes created by this wallet',
  })
  @ApiResponse({ status: 200, description: 'Referral codes fetched' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async myCodes(@CurrentUser('walletAddress') walletAddress: string) {
    const data = await this.referralService.listMyCodes(walletAddress);
    return { success: true, count: data.length, data };
  }
}
