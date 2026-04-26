import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminLoginDto {
  @ApiProperty({ example: 'ops@yourorg.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'a-strong-passphrase' })
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password: string;
}
