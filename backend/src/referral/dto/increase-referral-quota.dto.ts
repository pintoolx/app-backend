import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class IncreaseReferralQuotaDto {
  @ApiProperty({
    description: 'Number of additional codes to add to the user lifetime quota',
    minimum: 1,
    example: 10,
  })
  @IsInt()
  @Min(1)
  amount: number;
}
