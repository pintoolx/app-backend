import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class BanWalletDto {
  @ApiProperty({
    description: 'Echo the wallet address from the URL path to confirm intent.',
  })
  @IsString()
  confirmTargetId: string;

  @ApiPropertyOptional({
    description:
      'Free-form reason that will be stored in banned_wallets.reason and the admin_audit_logs entry.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp at which the ban auto-expires. Omit for an indefinite ban (until manual unban).',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
