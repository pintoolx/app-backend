import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Standard payload for destructive admin operations. The frontend always
 * fills `confirmTargetId` with the URL path parameter so a stray click
 * cannot fire the action; the controller validates it server-side.
 */
export class AdminConfirmDto {
  @ApiProperty({
    description: 'Echo the target id (deployment id, wallet, etc) to confirm intent.',
  })
  @IsString()
  confirmTargetId: string;

  @ApiPropertyOptional({ description: 'Optional human-readable reason recorded in the audit log.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;
}
