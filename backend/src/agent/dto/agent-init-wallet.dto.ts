import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AgentInitWalletDto {
  @ApiProperty({
    description: 'Name of the account to create',
    example: 'My Trading Bot Account',
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
