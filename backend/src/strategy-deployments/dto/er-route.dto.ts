import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsOptional, IsString } from 'class-validator';

export class ErDelegateDto {
  @ApiPropertyOptional({
    description:
      'Base64-encoded, fully-signed transaction targeting the MagicBlock delegation program. When omitted the adapter records advisory state.',
  })
  @IsString()
  @IsBase64()
  @IsOptional()
  signedTxBase64?: string;
}

export class ErRouteDto {
  @ApiProperty({
    description:
      'Base64-encoded user transaction to forward through Magic Router. The adapter does not modify or sign the payload.',
  })
  @IsString()
  @IsBase64()
  base64Tx: string;
}

export class ErUndelegateDto {
  @ApiPropertyOptional({
    description:
      'Base64-encoded commit_and_undelegate transaction. When omitted the adapter records advisory state.',
  })
  @IsString()
  @IsBase64()
  @IsOptional()
  signedTxBase64?: string;
}
