import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class UmbraRegisterDto {
  @ApiPropertyOptional({
    enum: ['confidential', 'anonymous'],
    description: 'Registration mode requested from the Umbra protocol.',
  })
  @IsString()
  @IsIn(['confidential', 'anonymous'])
  @IsOptional()
  mode?: 'confidential' | 'anonymous';
}

abstract class UmbraTreasuryBase {
  @ApiProperty({ description: 'Mint of the SPL token to operate on.' })
  @IsString()
  mint: string;

  @ApiProperty({ description: 'Amount in raw token base units (string to avoid precision loss).' })
  @IsString()
  amount: string;
}

export class UmbraDepositDto extends UmbraTreasuryBase {
  @ApiPropertyOptional({ description: 'Wallet to debit; defaults to deployment owner.' })
  @IsString()
  @IsOptional()
  fromWallet?: string;
}

export class UmbraWithdrawDto extends UmbraTreasuryBase {
  @ApiProperty({ description: 'Public wallet to receive the unshielded balance.' })
  @IsString()
  toWallet: string;
}

export class UmbraTransferDto extends UmbraTreasuryBase {
  @ApiProperty({ description: 'Recipient wallet (will be looked up in the EUA registry).' })
  @IsString()
  toWallet: string;

  @ApiPropertyOptional({ description: 'Sender wallet; defaults to deployment owner.' })
  @IsString()
  @IsOptional()
  fromWallet?: string;
}

export class UmbraGrantDto {
  @ApiProperty({ description: 'Wallet that should be granted viewer access.' })
  @IsString()
  granteeWallet: string;

  @ApiProperty({ description: 'Mint that the grant applies to.' })
  @IsString()
  mint: string;

  @ApiPropertyOptional({ description: 'ISO-8601 timestamp at which the grant expires.' })
  @IsISO8601()
  @IsOptional()
  expiresAt?: string;
}

export class UmbraBalanceQueryDto {
  @ApiProperty({ description: 'Mint to query encrypted balance for.' })
  @IsString()
  mint: string;

  @ApiPropertyOptional({
    description: 'Wallet to query balance for; defaults to deployment owner.',
  })
  @IsString()
  @IsOptional()
  walletAddress?: string;
}
