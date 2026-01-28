import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SignedRequestDto {
  @ApiProperty({
    description: 'Solana Wallet Address of the signer',
    example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  })
  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @ApiProperty({
    description: 'Signature of the active challenge message',
    example: '5...signature...base58',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
