import { IsObject, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SignedRequestDto } from '../../crossmint/dto/signed-request.dto';

export class ExecuteWorkflowDto extends SignedRequestDto {
  @ApiPropertyOptional({
    description: 'Optional execution parameters to override workflow defaults',
    example: {
      telegramNotify: true,
      customParams: {
        targetPrice: '105',
      },
    },
  })
  @IsObject()
  @IsOptional()
  params?: any;

  @ApiPropertyOptional({
    description: 'Account ID to use for execution context',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  accountId?: string;
}
