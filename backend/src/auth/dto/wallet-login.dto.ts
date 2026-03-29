import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WalletLoginDto {
  @ApiProperty({ description: 'Solana wallet address', example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({ description: 'Base58-encoded signature of the challenge message' })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
