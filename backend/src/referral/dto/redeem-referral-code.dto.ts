import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import { SOLANA_WALLET_REGEX } from '../referral.constants';

export class RedeemReferralCodeDto {
  @ApiProperty({
    description: 'Wallet redeeming the referral code',
    example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
  })
  @IsString()
  @Matches(SOLANA_WALLET_REGEX, {
    message: 'Invalid Solana wallet address',
  })
  walletAddress: string;

  @ApiProperty({
    description: 'Signature of the active challenge',
    example: '5...signature...base58',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({
    description: 'Referral code to redeem',
    example: 'REF-4GJ7KQ2M',
  })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({
    description: 'Optional metadata attached to redemption',
    example: { source: 'onboarding' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
