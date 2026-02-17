import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AgentInitWalletDto {
  @ApiProperty({
    description: 'Name of the account to create',
    example: 'My Trading Bot Account',
  })
  @IsString()
  @IsNotEmpty()
  accountName: string;
}
