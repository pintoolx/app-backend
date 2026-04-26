import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

abstract class PpBase {
  @ApiProperty({ description: 'Mint of the SPL token to operate on.' })
  @IsString()
  mint: string;

  @ApiProperty({ description: 'Amount in raw token base units (string to avoid precision loss).' })
  @IsString()
  amount: string;
}

export class PpDepositDto extends PpBase {
  @ApiPropertyOptional({ description: 'Wallet to debit; defaults to deployment owner.' })
  @IsString()
  @IsOptional()
  fromWallet?: string;
}

export class PpTransferDto extends PpBase {
  @ApiProperty({ description: 'Recipient wallet inside the Private Payments registry.' })
  @IsString()
  toWallet: string;

  @ApiPropertyOptional({ description: 'Sender wallet; defaults to deployment owner.' })
  @IsString()
  @IsOptional()
  fromWallet?: string;
}

export class PpWithdrawDto extends PpBase {
  @ApiProperty({ description: 'Public wallet to receive the unshielded balance.' })
  @IsString()
  toWallet: string;
}

export class PpBalanceQueryDto {
  @ApiProperty({ description: 'Mint to query encrypted balance for.' })
  @IsString()
  mint: string;

  @ApiPropertyOptional({
    description: 'Wallet to query balance for; defaults to deployment owner.',
  })
  @IsString()
  @IsOptional()
  wallet?: string;
}
