import { Body, Controller, Patch, Post, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReferralService } from './referral.service';
import { AdminGenerateReferralCodesDto } from './dto/admin-generate-referral-codes.dto';
import { SetReferralQuotaDto } from './dto/set-referral-quota.dto';
import { GenerateUserReferralCodesDto } from './dto/generate-user-referral-codes.dto';
import { RedeemReferralCodeDto } from './dto/redeem-referral-code.dto';
import { SignedWalletRequestDto } from './dto/signed-wallet-request.dto';

@ApiTags('Referrals')
@Controller('referrals')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post('admin/codes')
  @ApiOperation({
    summary: 'Admin: generate single-use referral codes for a target wallet',
  })
  @ApiResponse({ status: 201, description: 'Referral codes generated' })
  async adminGenerateCodes(@Body() dto: AdminGenerateReferralCodesDto) {
    const data = await this.referralService.adminGenerateCodes({
      adminWalletAddress: dto.adminWalletAddress,
      signature: dto.signature,
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
  async setQuota(@Param('walletAddress') walletAddress: string, @Body() dto: SetReferralQuotaDto) {
    const data = await this.referralService.setUserQuota(
      dto.adminWalletAddress,
      dto.signature,
      walletAddress,
      dto.maxCodes,
    );

    return { success: true, data };
  }

  @Post('codes')
  @ApiOperation({
    summary: 'User: generate single-use referral codes within lifetime quota',
  })
  @ApiResponse({ status: 201, description: 'Referral codes generated' })
  async userGenerateCodes(@Body() dto: GenerateUserReferralCodesDto) {
    const data = await this.referralService.userGenerateCodes({
      walletAddress: dto.walletAddress,
      signature: dto.signature,
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
  async redeem(@Body() dto: RedeemReferralCodeDto) {
    const data = await this.referralService.redeemCode(
      dto.walletAddress,
      dto.signature,
      dto.code,
      dto.metadata,
    );

    return { success: true, data };
  }

  @Post('my-codes')
  @ApiOperation({
    summary: 'List referral codes created by this wallet',
  })
  @ApiResponse({ status: 200, description: 'Referral codes fetched' })
  async myCodes(@Body() dto: SignedWalletRequestDto) {
    const data = await this.referralService.listMyCodes(dto.walletAddress, dto.signature);
    return { success: true, count: data.length, data };
  }
}
