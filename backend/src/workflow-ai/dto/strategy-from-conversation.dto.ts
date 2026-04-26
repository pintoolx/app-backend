import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class StrategyFromConversationDto {
  @ApiProperty({ description: 'Strategy name', example: 'AI-drafted SOL rotation' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Strategy description for the public surface' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Visibility mode at strategy creation',
    enum: ['private', 'public'],
    default: 'private',
  })
  @IsString()
  @IsIn(['private', 'public'])
  @IsOptional()
  visibilityMode?: 'private' | 'public';

  @ApiPropertyOptional({
    description: 'Optional Telegram chat for execution notifications',
  })
  @IsString()
  @IsOptional()
  telegramChatId?: string;
}
