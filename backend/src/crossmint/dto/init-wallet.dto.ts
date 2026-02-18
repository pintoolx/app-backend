import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SignedRequestDto } from './signed-request.dto';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class InitWalletDto extends SignedRequestDto {
  @ApiProperty({
    description: 'Name of the account to create',
    example: 'My Trading Account',
  })
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @ApiPropertyOptional({
    description: 'Workflow ID to assign to this account',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsOptional()
  workflowId?: string;
}
