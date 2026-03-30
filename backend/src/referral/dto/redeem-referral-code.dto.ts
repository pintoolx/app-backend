import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class RedeemReferralCodeDto {
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
