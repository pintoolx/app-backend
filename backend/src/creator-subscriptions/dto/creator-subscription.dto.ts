import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Matches } from 'class-validator';
import { SOLANA_WALLET_REGEX } from '../../referral/referral.constants';

export class UpsertCreatorSubscriptionPlanDto {
  @ApiProperty({
    description: 'Monthly price in smallest USDC units (6 decimals). Example: 10 USDC = 10000000.',
    example: '10000000',
  })
  @IsString()
  @Matches(/^[0-9]+$/, { message: 'monthlyPriceAmount must be a non-negative integer string' })
  monthlyPriceAmount: string;

  @ApiPropertyOptional({
    description: 'Wallet that receives subscriber payments. Defaults to the creator wallet.',
    example: '8XQk8F4YJ6xH3aKx5v2Fq2wM6k7V2ZrD8QWf7BwSx8g4',
  })
  @IsString()
  @IsOptional()
  @Matches(SOLANA_WALLET_REGEX, { message: 'Invalid Solana wallet address' })
  payoutWallet?: string;

  @ApiPropertyOptional({ description: 'Optional plan metadata', example: { tier: 'monthly' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ConfirmCreatorSubscriptionPaymentDto {
  @ApiProperty({ description: 'Confirmed Solana transaction signature for the USDC payment' })
  @IsString()
  txSignature: string;
}
