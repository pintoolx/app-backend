import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateStrategyDto {
  @ApiPropertyOptional({
    description: 'Strategy name',
    example: 'Protected SOL Rotation v2',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Strategy description shown on the public strategy surface',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Updated private strategy implementation',
  })
  @IsObject()
  @IsOptional()
  definition?: any;

  @ApiPropertyOptional({
    description: 'Strategy visibility mode',
    enum: ['private', 'public'],
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
