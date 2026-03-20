import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { SOLANA_WALLET_REGEX } from '../referral.constants';

export class SignedWalletRequestDto {
  @ApiProperty({
    description: 'Wallet address',
    example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
  })
  @IsString()
  @Matches(SOLANA_WALLET_REGEX, {
    message: 'Invalid Solana wallet address',
  })
  walletAddress: string;

  @ApiProperty({
    description: 'Signature of the active challenge',
    example: '5...signature...base58',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
