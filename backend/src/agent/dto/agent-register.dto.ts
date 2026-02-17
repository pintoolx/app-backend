import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AgentRegisterDto {
  @ApiProperty({
    description: 'Solana wallet address of the agent',
    example: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
    message: 'Invalid Solana wallet address',
  })
  walletAddress: string;

  @ApiProperty({
    description: 'Signature of the challenge message',
    example: '5...signature...base58',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
