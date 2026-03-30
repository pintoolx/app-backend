import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { REFERRAL_MAX_BATCH_SIZE } from '../referral.constants';

export class GenerateUserReferralCodesDto {
  @ApiProperty({
    description: 'How many single-use codes to generate within user lifetime quota',
    minimum: 1,
    maximum: REFERRAL_MAX_BATCH_SIZE,
    example: 3,
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
    description: 'Optional metadata for analytics',
    example: { channel: 'in_app' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
