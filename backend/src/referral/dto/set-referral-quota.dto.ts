import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';
import { SOLANA_WALLET_REGEX } from '../referral.constants';

export class SetReferralQuotaDto {
  @ApiProperty({
    description: 'Admin wallet address',
    example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
  })
  @IsString()
  @Matches(SOLANA_WALLET_REGEX, {
    message: 'Invalid Solana wallet address',
  })
  adminWalletAddress: string;

  @ApiProperty({
    description: 'Signature of the active challenge',
    example: '5...signature...base58',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({
    description: 'New lifetime quota for the target user',
    minimum: 0,
    example: 50,
  })
  @IsInt()
  @Min(0)
  maxCodes: number;
}
