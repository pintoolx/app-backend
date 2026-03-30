import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const supabaseJwtVerifierService = {
    verify: jest.fn(),
  };

  const createContext = (headers: Record<string, string> = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when authorization header is missing', async () => {
    const guard = new JwtAuthGuard(supabaseJwtVerifierService as any);

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      new UnauthorizedException('Missing or invalid Authorization header'),
    );
  });

  it('attaches verified supabase user to request', async () => {
    const request = {
      headers: {
        authorization: 'Bearer test-token',
      },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;
    const guard = new JwtAuthGuard(supabaseJwtVerifierService as any);
    const user = {
      supabaseUserId: 'user-id',
      walletAddress: 'wallet-address',
      email: 'user@example.com',
      role: 'authenticated',
      claims: { sub: 'user-id' },
    };

    supabaseJwtVerifierService.verify.mockResolvedValue(user);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(supabaseJwtVerifierService.verify).toHaveBeenCalledWith('test-token');
    expect((request as any).user).toEqual(user);
  });

  it('rethrows verifier authorization errors', async () => {
    const guard = new JwtAuthGuard(supabaseJwtVerifierService as any);
    const error = new UnauthorizedException('Token is missing wallet address claim');

    supabaseJwtVerifierService.verify.mockRejectedValue(error);

    await expect(
      guard.canActivate(
        createContext({
          authorization: 'Bearer test-token',
        }),
      ),
    ).rejects.toThrow(error);
  });
});
