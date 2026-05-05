jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verifySync: jest.fn(),
}));

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAuthService, type RequestContext } from './admin-auth.service';
import type { AdminUsersRepository } from './admin-users.repository';
import type {
  AdminRefreshTokensRepository,
  RotateRefreshTokenResult,
} from './admin-refresh-tokens.repository';
import type { AdminTokenService } from './admin-token.service';
import type { TotpService } from './totp.service';

describe('AdminAuthService.refresh', () => {
  const refreshTokenRow = {
    id: 'rt-old',
    admin_user_id: 'admin-1',
    token_hash: 'hash-old',
    status: 'active' as const,
    expires_at: '2026-05-06T00:00:00.000Z',
    created_at: '2026-05-04T00:00:00.000Z',
    revoked_at: null,
    replaced_by: null,
    user_agent: null,
    ip_address: null,
  };
  const adminUser = {
    id: 'admin-1',
    email: 'ops@example.com',
    password_hash: 'hash',
    totp_secret_enc: 'enc',
    role: 'superadmin' as const,
    status: 'active' as const,
    failed_login_count: 0,
    locked_until: null,
    last_login_at: null,
    last_login_ip: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  };
  const ctx: RequestContext = {
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
    ipAllowed: true,
  };

  let adminUsersRepo: jest.Mocked<Partial<AdminUsersRepository>>;
  let refreshTokensRepo: jest.Mocked<Partial<AdminRefreshTokensRepository>>;
  let tokenService: jest.Mocked<Partial<AdminTokenService>>;
  let service: AdminAuthService;

  beforeEach(() => {
    adminUsersRepo = {
      findById: jest.fn().mockResolvedValue(adminUser),
    };
    refreshTokensRepo = {
      findActiveByRaw: jest.fn().mockResolvedValue(refreshTokenRow),
      rotate: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    tokenService = {
      signAccessToken: jest.fn().mockResolvedValue('access-token'),
      generateRefreshToken: jest.fn().mockReturnValue('refresh-token-next'),
      computeRefreshExpiry: jest.fn().mockReturnValue(new Date('2026-05-07T00:00:00.000Z')),
    };

    service = new AdminAuthService(
      adminUsersRepo as unknown as AdminUsersRepository,
      refreshTokensRepo as unknown as AdminRefreshTokensRepository,
      tokenService as unknown as AdminTokenService,
      {} as TotpService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
  });

  it('returns a new session when atomic rotation succeeds', async () => {
    const rotation: RotateRefreshTokenResult = {
      outcome: 'rotated',
      admin_user_id: adminUser.id,
      previous_token_id: refreshTokenRow.id,
      replacement_token_id: 'rt-new',
      previous_status: 'active',
      previous_expires_at: refreshTokenRow.expires_at,
    };
    refreshTokensRepo.rotate!.mockResolvedValue(rotation);

    const result = await service.refresh('refresh-token-current', ctx);

    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token-next',
      expiresInSec: 15 * 60,
      refreshExpiresAt: '2026-05-07T00:00:00.000Z',
      admin: {
        id: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      },
    });
    expect(refreshTokensRepo.rotate).toHaveBeenCalledWith({
      oldRawToken: 'refresh-token-current',
      newRawToken: 'refresh-token-next',
      expiresAt: '2026-05-07T00:00:00.000Z',
      userAgent: 'jest',
      ipAddress: '127.0.0.1',
    });
  });

  it('revokes the chain when atomic rotation detects reuse during a race', async () => {
    const rotation: RotateRefreshTokenResult = {
      outcome: 'already_used',
      admin_user_id: adminUser.id,
      previous_token_id: refreshTokenRow.id,
      replacement_token_id: 'rt-other',
      previous_status: 'replaced',
      previous_expires_at: refreshTokenRow.expires_at,
    };
    refreshTokensRepo.rotate!.mockResolvedValue(rotation);

    await expect(service.refresh('refresh-token-current', ctx)).rejects.toThrow(
      new UnauthorizedException('Refresh token already used'),
    );
    expect(refreshTokensRepo.revokeAllForUser).toHaveBeenCalledWith(adminUser.id);
  });
});
