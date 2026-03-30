import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetReferralQuotaDto {
  @ApiProperty({
    description: 'New lifetime quota for the target user',
    minimum: 0,
    example: 50,
  })
  @IsInt()
  @Min(0)
  maxCodes: number;
}
