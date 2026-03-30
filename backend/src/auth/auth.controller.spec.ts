import { AuthController } from './auth.controller';

describe('AuthController', () => {
  it('returns challenge response', async () => {
    const authService = {
      generateChallenge: jest.fn().mockResolvedValue('challenge-1'),
    } as any;
    const controller = new AuthController(authService);

    const result = await controller.getChallenge({ walletAddress: 'wallet-1' } as any);

    expect(authService.generateChallenge).toHaveBeenCalledWith('wallet-1');
    expect(result).toEqual({
      success: true,
      data: {
        challenge: 'challenge-1',
        expiresIn: 300,
      },
    });
  });

  it('returns signature verification result for login', async () => {
    const authService = {
      authenticateWithSignature: jest.fn().mockResolvedValue({
        authenticated: true,
        walletAddress: 'wallet-1',
        authMode: 'signature_verification',
      }),
    } as any;
    const controller = new AuthController(authService);

    const result = await controller.login({ walletAddress: 'wallet-1', signature: 'sig' } as any);

    expect(authService.authenticateWithSignature).toHaveBeenCalledWith('wallet-1', 'sig');
    expect(result).toEqual({
      success: true,
      data: {
        authenticated: true,
        walletAddress: 'wallet-1',
        authMode: 'signature_verification',
      },
    });
  });
});
