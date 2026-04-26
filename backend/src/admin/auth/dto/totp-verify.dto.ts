import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class AdminTotpVerifyDto {
  @ApiProperty({
    description:
      'The temporary 2FA-pending token returned from POST /admin/auth/login. Lifetime ~5 minutes.',
  })
  @IsString()
  tempToken: string;

  @ApiProperty({ example: '123456', description: 'Current 6-digit TOTP code from authenticator' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'totpCode must be a 6-digit number' })
  totpCode: string;
}
