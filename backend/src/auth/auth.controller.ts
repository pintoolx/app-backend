import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { WalletChallengeDto } from './dto/wallet-challenge.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('challenge')
  @ApiOperation({
    summary: 'Request authentication challenge',
    description:
      'Generate a challenge message for wallet signature authentication. ' +
      'The client should sign this message and submit it to endpoints that require a signature.',
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
}
