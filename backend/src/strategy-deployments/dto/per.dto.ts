import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

const PER_ROLES = ['creator', 'operator', 'viewer', 'subscriber', 'auditor'] as const;
type PerRole = (typeof PER_ROLES)[number];

export class PerMemberDto {
  @ApiProperty()
  @IsString()
  wallet: string;

  @ApiProperty({ enum: PER_ROLES })
  @IsString()
  @IsIn(PER_ROLES as unknown as string[])
  role: PerRole;

  @ApiPropertyOptional({ description: 'ISO-8601 timestamp at which the membership expires.' })
  @IsISO8601()
  @IsOptional()
  expiresAt?: string;
}

export class PerReplaceMembersDto {
  @ApiProperty({ type: [PerMemberDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => PerMemberDto)
  members: PerMemberDto[];
}

export class PerChallengeQueryDto {
  @ApiProperty({ description: 'Wallet that wants to authenticate against the PER group.' })
  @IsString()
  wallet: string;
}

export class PerVerifyDto {
  @ApiProperty()
  @IsString()
  wallet: string;

  @ApiProperty()
  @IsString()
  challenge: string;

  @ApiProperty({ description: 'Base58-encoded ed25519 signature of the raw challenge nonce.' })
  @IsString()
  signature: string;
}
