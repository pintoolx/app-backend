import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class WithdrawRequestDto {
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

  @ApiProperty({
    description: 'Amount of SOL to withdraw',
    example: 0.5,
    minimum: 0,
  })
  @IsNumber()
  @Min(0, { message: 'Amount must be greater than or equal to 0' })
  amount: number;
}
