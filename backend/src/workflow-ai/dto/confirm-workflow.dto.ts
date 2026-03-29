import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmWorkflowDto {
  @ApiProperty({ description: 'Workflow name', example: 'SOL Price Monitor' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Workflow description', example: '每小時監控 SOL 價格變化' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Telegram chat ID for notifications' })
  @IsString()
  @IsOptional()
  telegramChatId?: string;
}
