import { IsObject, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExecuteWorkflowDto {
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
}
