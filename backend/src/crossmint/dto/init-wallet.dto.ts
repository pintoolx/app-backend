import { ApiProperty } from '@nestjs/swagger';
import { SignedRequestDto } from './signed-request.dto';
import { IsString, IsNotEmpty } from 'class-validator';

export class InitWalletDto extends SignedRequestDto {
  @ApiProperty({
    description: 'Name of the account to create',
    example: 'My Trading Account',
  })
  @IsString()
  @IsNotEmpty()
  accountName: string;
}
