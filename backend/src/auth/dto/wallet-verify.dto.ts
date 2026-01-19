import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WalletVerifyDto {
  @ApiProperty({
    description: 'Solana wallet address',
    example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
  })
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: 'Invalid Solana wallet address',
  })
  walletAddress: string;

  @ApiProperty({
    description: 'Base58 encoded signature from wallet',
    example:
      '3yZe7d1AKnhtaVBS9KQXw7JjaYEPpVvXfFXv9Kfki5qc6hH9NcWY1wHpHXzSQLqZrqNcpPjxFj6KQdDh2TL8VJPC',
  })
  @IsString()
  signature: string;
}
