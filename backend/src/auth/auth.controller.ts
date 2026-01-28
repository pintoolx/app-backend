import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { WalletChallengeDto } from './dto/wallet-challenge.dto';
import { WalletVerifyDto } from './dto/wallet-verify.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('challenge')
  @ApiOperation({
    summary: 'Request authentication challenge',
    description:
      'Generate a challenge message for wallet signature authentication. ' +
      'The client should sign this message with their wallet and submit it to the /verify endpoint.',
  })
  @ApiResponse({
    status: 201,
    description: 'Challenge generated successfully',
    schema: {
      example: {
        success: true,
        data: {
          challenge:
            'Sign this message to authenticate with PinTool:\n\nNonce: abc123xyz\nTimestamp: 1699999999999\nWallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
          expiresIn: 300,
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid wallet address',
  })
  async getChallenge(@Body() dto: WalletChallengeDto) {
    const challenge = await this.authService.generateChallenge(dto.walletAddress);
    console.log('DEBUG: Generated challenge:', challenge, 'Type:', typeof challenge);

    return {
      success: true,
      data: {
        challenge,
        expiresIn: 300, // 5 minutes in seconds
      },
    };
  }

  @Post('verify')
  @ApiOperation({
    summary: 'Verify wallet signature and get JWT token',
    description:
      'Verify the signed challenge message and issue a JWT token for authenticated API access. ' +
      'Use this token in the Authorization header as "Bearer <token>" for protected endpoints.',
  })
  @ApiResponse({
    status: 201,
    description: 'Signature verified successfully, JWT token issued',
    schema: {
      example: {
        success: true,
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          walletAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature or challenge expired',
  })
  async verifySignature(@Body() dto: WalletVerifyDto) {
    const { accessToken } = await this.authService.verifySignature(
      dto.walletAddress,
      dto.signature,
    );

    return {
      success: true,
      data: {
        accessToken,
        walletAddress: dto.walletAddress,
      },
    };
  }
}
