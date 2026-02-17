import { IsObject, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AgentExecuteWorkflowDto {
  @ApiPropertyOptional({
    description: 'Optional execution parameters',
  })
  @IsObject()
  @IsOptional()
  params?: any;

  @ApiPropertyOptional({
    description: 'Account ID to use for execution',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  accountId?: string;
}
