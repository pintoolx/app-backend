import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class CreateStrategyDto {
  @ApiProperty({
    description: 'Strategy name',
    example: 'Protected SOL Rotation',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Strategy description shown on the public strategy surface',
    example: 'Rotates into defensive positions when trigger conditions are met.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Inline workflow definition that will be treated as the private strategy implementation. Provide either this or sourceWorkflowId.',
  })
  @IsObject()
  @IsOptional()
  @ValidateIf((o) => !o.sourceWorkflowId)
  definition?: any;

  @ApiPropertyOptional({
    description:
      'ID of an existing legacy workflow whose definition should be reused as the private implementation.',
  })
  @IsUUID()
  @IsOptional()
  @ValidateIf((o) => !o.definition)
  sourceWorkflowId?: string;

  @ApiPropertyOptional({
    description: 'Strategy visibility mode',
    example: 'private',
    enum: ['private', 'public'],
    default: 'private',
  })
  @IsString()
  @IsIn(['private', 'public'])
  @IsOptional()
  visibilityMode?: 'private' | 'public';

  @ApiPropertyOptional({
    description: 'Optional Telegram chat for strategy execution notifications',
    example: '123456789',
  })
  @IsString()
  @IsOptional()
  telegramChatId?: string;
}
