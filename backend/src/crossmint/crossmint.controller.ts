import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  Inject,
  UnauthorizedException,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CrossmintService } from './crossmint.service';
import { AuthService } from '../auth/auth.service';
import { InitWalletDto } from './dto/init-wallet.dto';
import { SignedRequestDto } from './dto/signed-request.dto';

@ApiTags('Crossmint')
@Controller('crossmint/wallets')
export class CrossmintController {
  constructor(
    private readonly crossmintService: CrossmintService,
    private readonly authService: AuthService,
  ) {}

  @Post('init')
  @ApiOperation({
    summary: 'Initialize new account with Crossmint wallet',
    description: 'Requires valid signature from the owner wallet',
  })
  @ApiResponse({ status: 201, description: 'Account created' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  async initWallet(@Body() dto: InitWalletDto) {
    // 1. Verify Signature
    const isValid = await this.authService.verifyAndConsumeChallenge(
      dto.walletAddress,
      dto.signature,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature or challenge expired');
    }

    // 2. Create Account (Signer becomes Owner)
    return this.crossmintService.createAccountWithWallet(dto.walletAddress, dto.accountName);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete (Close) an account',
    description: 'Requires valid signature from the owner wallet',
  })
  @ApiResponse({ status: 200, description: 'Account deleted' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  @ApiResponse({ status: 403, description: 'Not authorized (Not the owner)' })
  async deleteWallet(@Param('id') id: string, @Body() dto: SignedRequestDto) {
    // 1. Verify Signature
    const isValid = await this.authService.verifyAndConsumeChallenge(
      dto.walletAddress,
      dto.signature,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature or challenge expired');
    }

    // 2. Perform Delete with Ownership Check
    await this.crossmintService.deleteWallet(id, dto.walletAddress);
    return { success: true, message: 'Wallet deleted' };
  }

  @Post(':id/export')
  @ApiOperation({
    summary: 'Export wallet private key',
    description:
      'Requires valid signature from the owner wallet. Note: MPC wallets may not support this.',
  })
  @ApiResponse({ status: 200, description: 'Key exported' })
  @ApiResponse({ status: 400, description: 'Not supported' })
  @HttpCode(200)
  async exportWallet(@Param('id') id: string, @Body() dto: SignedRequestDto) {
    // 1. Verify Signature
    const isValid = await this.authService.verifyAndConsumeChallenge(
      dto.walletAddress,
      dto.signature,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature or challenge expired');
    }

    // 2. Try Export with Ownership Check
    const privateKey = await this.crossmintService.exportWallet(id, dto.walletAddress);
    return { success: true, privateKey };
  }
}
