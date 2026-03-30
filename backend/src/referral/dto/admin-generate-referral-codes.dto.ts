import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { REFERRAL_MAX_BATCH_SIZE, SOLANA_WALLET_REGEX } from '../referral.constants';

export class AdminGenerateReferralCodesDto {
  @ApiProperty({
    description: 'Target customer wallet address that can redeem these codes',
    example: '8XQk8F4YJ6xH3aKx5v2Fq2wM6k7V2ZrD8QWf7BwSx8g4',
    pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
  })
  @IsString()
  @Matches(SOLANA_WALLET_REGEX, {
    message: 'Invalid Solana wallet address',
  })
  targetWalletAddress: string;

  @ApiProperty({
    description: 'Number of single-use referral codes to generate',
    minimum: 1,
    maximum: REFERRAL_MAX_BATCH_SIZE,
    example: 10,
  })
  @IsInt()
  @Min(1)
  @Max(REFERRAL_MAX_BATCH_SIZE)
  count: number;

  @ApiPropertyOptional({
    description: 'Optional expiration timestamp (ISO-8601)',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Optional metadata for auditing',
    example: { campaign: 'spring-2026' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
