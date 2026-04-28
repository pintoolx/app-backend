import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const NUMERIC_STRING_RE = /^[0-9]+$/;

export class StartPrivateCycleDto {
  @ApiProperty({
    description: 'Trigger type — semantic label only, never used as raw signal payload.',
    example: 'price',
  })
  @IsString()
  triggerType!: string;

  @ApiPropertyOptional({
    description: 'Optional opaque trigger reference (e.g. pyth feed id).',
  })
  @IsString()
  @IsOptional()
  triggerRef?: string;

  @ApiProperty({
    description:
      'Caller-supplied idempotency key, unique per deployment. Re-using the key returns the existing cycle.',
  })
  @IsString()
  idempotencyKey!: string;

  @ApiPropertyOptional({
    description:
      'Notional amount the strategy intends to deploy this cycle, in raw token units. Used for proportional follower allocation.',
    example: '10000000',
  })
  @Matches(NUMERIC_STRING_RE, { message: 'notional must be a non-negative integer string' })
  @IsOptional()
  notional?: string;
}
