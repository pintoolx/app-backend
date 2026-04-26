import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AdminRefreshDto {
  @ApiProperty({
    description: 'Refresh token returned from /admin/auth/2fa or /admin/auth/refresh',
  })
  @IsString()
  refreshToken: string;
}
