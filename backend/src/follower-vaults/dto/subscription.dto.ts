import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const NUMERIC_STRING_RE = /^[0-9]+$/;

export class CreateSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Follower wallet to enrol. Defaults to the JWT-authenticated wallet when omitted.',
  })
  @IsString()
  @IsOptional()
  followerWallet?: string;

  @ApiPropertyOptional({
    description: 'Visibility preset — selects what private state the follower can read.',
    enum: ['creator-only', 'subscriber-self', 'auditor-window', 'metrics-window', 'coarse-public'],
    default: 'subscriber-self',
  })
  @IsString()
  @IsIn(['creator-only', 'subscriber-self', 'auditor-window', 'metrics-window', 'coarse-public'])
  @IsOptional()
  visibilityPreset?: string;

  @ApiPropertyOptional({
    description:
      'Maximum raw token units this subscription is allowed to deploy. Stored as a string to preserve bigint precision.',
    example: '1000000000',
  })
  @Matches(NUMERIC_STRING_RE, { message: 'maxCapital must be a non-negative integer string' })
  @IsOptional()
  maxCapital?: string;

  @ApiPropertyOptional({
    description: 'Allocation algorithm for this subscription.',
    enum: ['proportional', 'fixed', 'mirror'],
    default: 'proportional',
  })
  @IsString()
  @IsIn(['proportional', 'fixed', 'mirror'])
  @IsOptional()
  allocationMode?: 'proportional' | 'fixed' | 'mirror';

  @ApiPropertyOptional({
    description:
      'Maximum drawdown guard (basis points). Strategy execution must skip this follower when breached.',
  })
  @IsInt()
  @Min(0)
  @Max(10000)
  @IsOptional()
  maxDrawdownBps?: number;
}

export class ShieldFundsDto {
  @ApiProperty({ description: 'Mint of the asset to shield.' })
  @IsString()
  mint!: string;

  @ApiProperty({
    description: 'Raw token units to shield (string for bigint precision).',
    example: '1000000',
  })
  @Matches(NUMERIC_STRING_RE, { message: 'amount must be a non-negative integer string' })
  amount!: string;
}

export class FundIntentDto {
  @ApiProperty({ description: 'Mint of the asset the follower intends to fund with.' })
  @IsString()
  mint!: string;

  @ApiProperty({
    description: 'Planned raw token units to fund.',
    example: '1000000',
  })
  @Matches(NUMERIC_STRING_RE, { message: 'amount must be a non-negative integer string' })
  amount!: string;
}

export class VerifySubscriptionChallengeDto {
  @ApiProperty({
    description:
      'The challenge token previously returned by GET /per/auth/challenge for this subscription.',
  })
  @IsString()
  challenge!: string;
}

export class CreateVisibilityGrantDto {
  @ApiProperty({ description: 'Wallet that should receive bounded visibility.' })
  @IsString()
  granteeWallet!: string;

  @ApiProperty({
    description: 'Scope of the grant.',
    enum: [
      'vault-balance',
      'vault-state',
      'metrics-window',
      'auditor-window',
      'creator-only',
      'subscriber-self',
      'coarse-public',
    ],
  })
  @IsString()
  @IsIn([
    'vault-balance',
    'vault-state',
    'metrics-window',
    'auditor-window',
    'creator-only',
    'subscriber-self',
    'coarse-public',
  ])
  scope!:
    | 'vault-balance'
    | 'vault-state'
    | 'metrics-window'
    | 'auditor-window'
    | 'creator-only'
    | 'subscriber-self'
    | 'coarse-public';

  @ApiPropertyOptional({ description: 'Optional ISO-8601 expiry timestamp.' })
  @IsISO8601()
  @IsOptional()
  expiresAt?: string;
}
