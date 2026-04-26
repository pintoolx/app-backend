import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetMaintenanceDto {
  @ApiProperty({ example: true, description: 'true to enable maintenance mode, false to disable' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    description: 'Banner text shown to users while maintenance is in effect.',
    example: 'PinTool is undergoing scheduled maintenance and will return shortly.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  message?: string;
}
