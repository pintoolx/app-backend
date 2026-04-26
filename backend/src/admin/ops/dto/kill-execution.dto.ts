import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class KillExecutionDto {
  @ApiPropertyOptional({
    description: 'Optional reason. Stored in workflow_executions.killed_reason and audit log.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;
}
