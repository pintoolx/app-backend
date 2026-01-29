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
});
