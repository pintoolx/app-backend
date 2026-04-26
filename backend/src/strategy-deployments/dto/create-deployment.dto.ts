import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDeploymentDto {
  @ApiProperty({
    description:
      'Existing account (Crossmint vault) id that will host this deployment as the strategy vault.',
  })
  @IsUUID()
  accountId: string;

  @ApiPropertyOptional({
    description: 'Override execution mode (defaults to compiled IR deployment hint when omitted).',
    enum: ['offchain', 'er', 'per'],
  })
  @IsString()
  @IsIn(['offchain', 'er', 'per'])
  @IsOptional()
  executionMode?: 'offchain' | 'er' | 'per';

  @ApiPropertyOptional({
    description:
      'Override treasury privacy mode (defaults to compiled IR deployment hint when omitted).',
    enum: ['public', 'private_payments', 'umbra'],
  })
  @IsString()
  @IsIn(['public', 'private_payments', 'umbra'])
  @IsOptional()
  treasuryMode?: 'public' | 'private_payments' | 'umbra';

  @ApiPropertyOptional({
    description: 'Optional metadata blob persisted on the deployment row.',
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
