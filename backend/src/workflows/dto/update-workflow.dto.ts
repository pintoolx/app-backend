import { IsString, IsBoolean, IsObject, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWorkflowDto {
  @ApiPropertyOptional({
    description: 'Workflow name',
    example: 'Updated Workflow Name',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Workflow description',
    example: 'Updated description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Workflow definition (nodes and connections)',
  })
  @IsObject()
  @IsOptional()
  definition?: any;

  @ApiPropertyOptional({
    description: 'Whether the workflow is active',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Telegram chat ID for notifications',
    example: '123456789',
  })
  @IsString()
  @IsOptional()
  telegramChatId?: string;
}
