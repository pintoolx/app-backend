import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AdminUsersRepository, type AdminUserRow } from './admin-users.repository';
import { AdminRefreshTokensRepository } from './admin-refresh-tokens.repository';
import { AdminTokenService } from './admin-token.service';
import { TotpService } from './totp.service';

export interface LoginResult {
  step: 'totp_required';
  tempToken: string;
  expiresInSec: number;
}

export interface AdminSession {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  refreshExpiresAt: string;
  admin: {
    id: string;
    email: string;
    role: AdminUserRow['role'];
  };
}

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  ipAllowed: boolean;
}

const BCRYPT_DUMMY_HASH = '$2a$10$abcdefghijklmnopqrstuOZl0YyB6jOY3dW58V0IDoxZsWvRhdZGS'; // never matches

/**
 * AdminAuthService implements a strict 3-step admin login:
 *
 *   1) /login    : email + password  → returns short-lived `tempToken` (5m).
 *   2) /2fa      : tempToken + TOTP  → returns long-lived `accessToken` (15m)
 *                                       + rotating `refreshToken` (7d).
 *   3) /refresh  : refreshToken      → rotates and reissues access+refresh.
 *
 * Hardening choices (in order of importance):
 *   - Constant-time bcrypt compare against a dummy hash when the email is
 *     unknown, so attackers cannot enumerate accounts via timing.
 *   - Failed-login counter increments under a server-side row lock semantic;
 *     when the counter reaches `admin.maxFailedLogins`, the account is
 *     locked for `admin.lockoutMinutes`.
 *   - Refresh tokens are stored as SHA-256 hashes and rotated on every
 *     refresh. Reuse of an already-rotated token revokes the entire chain.
 *   - All admin tokens carry `aud: "admin"` so they cannot be confused with
 *     user-facing wallet JWTs.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly maxFailedLogins: number;
  private readonly lockoutMs: number;

  constructor(
    private readonly adminUsersRepo: AdminUsersRepository,
    private readonly refreshTokensRepo: AdminRefreshTokensRepository,
    private readonly tokenService: AdminTokenService,
    private readonly totpService: TotpService,
    private readonly configService: ConfigService,
  ) {
    this.maxFailedLogins = this.configService.get<number>('admin.maxFailedLogins') ?? 5;
    this.lockoutMs = (this.configService.get<number>('admin.lockoutMinutes') ?? 15) * 60_000;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    if (!this.tokenService.isConfigured()) {
      throw new ServiceUnavailableException('Admin auth is not configured on this environment');
    }
    const normalised = email.trim().toLowerCase();
    const user = await this.adminUsersRepo.findByEmail(normalised);

    // Always run bcrypt compare to flatten timing across known/unknown emails.
    const ok = await bcrypt.compare(password, user?.password_hash ?? BCRYPT_DUMMY_HASH);
    if (!user || user.status !== 'active' || !ok) {
      if (user) {
        await this.handleFailedLogin(user);
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    if (this.isLocked(user)) {
      throw new UnauthorizedException('Account is temporarily locked. Try again later.');
    }

    if (!user.totp_secret_enc) {
      throw new UnauthorizedException(
        'TOTP not provisioned for this admin account; contact a superadmin to seed it.',
      );
    }

    const tempToken = await this.tokenService.signTempToken({
      sub: user.id,
      email: user.email,
    });
    return {
      step: 'totp_required',
      tempToken,
      expiresInSec: 5 * 60,
    };
  }

  async verify2fa(tempToken: string, totpCode: string, ctx: RequestContext): Promise<AdminSession> {
    if (!ctx.ipAllowed) {
      throw new UnauthorizedException('Source IP is not allowed for admin access');
    }
    const claims = await this.tokenService.verifyTempToken(tempToken);
    const user = await this.adminUsersRepo.findById(claims.sub);
    if (user.status !== 'active' || this.isLocked(user)) {
      throw new UnauthorizedException('Admin account is not currently allowed to sign in');
    }
    if (!user.totp_secret_enc) {
      throw new UnauthorizedException('TOTP secret not provisioned for this admin');
    }

    const secret = this.totpService.decryptSecret(user.totp_secret_enc);
    if (!this.totpService.verify(totpCode, secret)) {
      await this.handleFailedLogin(user);
      throw new UnauthorizedException('Invalid TOTP code');
    }

    await this.adminUsersRepo.resetLoginCounters(user.id, ctx.ipAddress);
    return this.issueSession(user, ctx);
  }

  async refresh(rawToken: string, ctx: RequestContext): Promise<AdminSession> {
    if (!ctx.ipAllowed) {
      throw new UnauthorizedException('Source IP is not allowed for admin access');
    }
    const row = await this.refreshTokensRepo.findActiveByRaw(rawToken);
    if (!row) {
      throw new UnauthorizedException('Refresh token not recognised');
    }
    if (row.status !== 'active') {
      // Re-use of a rotated/revoked token is a strong signal of theft. Revoke
      // every refresh token issued to this admin so the attacker chain dies.
      this.logger.warn(
        `Admin refresh token reuse detected user=${row.admin_user_id} status=${row.status}`,
      );
      await this.refreshTokensRepo.revokeAllForUser(row.admin_user_id);
      throw new UnauthorizedException('Refresh token already used');
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    const user = await this.adminUsersRepo.findById(row.admin_user_id);
    if (user.status !== 'active' || this.isLocked(user)) {
      throw new UnauthorizedException('Admin account is not currently allowed to sign in');
    }

    const session = await this.issueSession(user, ctx);
    const newRow = await this.refreshTokensRepo.findActiveByRaw(session.refreshToken);
    if (newRow) {
      await this.refreshTokensRepo.markReplaced(row.id, newRow.id);
    }
    return session;
  }

  async logout(rawToken: string): Promise<void> {
    await this.refreshTokensRepo.revokeByRaw(rawToken);
  }

  // ------------------------------------------------------------------ utils

  private async issueSession(user: AdminUserRow, ctx: RequestContext): Promise<AdminSession> {
    const accessToken = await this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshToken = this.tokenService.generateRefreshToken();
    const expiresAt = this.tokenService.computeRefreshExpiry();
    await this.refreshTokensRepo.insert({
      adminUserId: user.id,
      rawToken: refreshToken,
      expiresAt: expiresAt.toISOString(),
      userAgent: ctx.userAgent,
      ipAddress: ctx.ipAddress,
    });
    return {
      accessToken,
      refreshToken,
      expiresInSec: 15 * 60,
      refreshExpiresAt: expiresAt.toISOString(),
      admin: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  private isLocked(user: AdminUserRow): boolean {
    if (!user.locked_until) return false;
    return new Date(user.locked_until).getTime() > Date.now();
  }

  private async handleFailedLogin(user: AdminUserRow): Promise<void> {
    const nextCount = user.failed_login_count + 1;
    const lockUntil =
      nextCount >= this.maxFailedLogins
        ? new Date(Date.now() + this.lockoutMs).toISOString()
        : null;
    try {
      await this.adminUsersRepo.incrementFailedLogin(user.id, lockUntil);
    } catch (err) {
      this.logger.error('Failed to increment admin failed_login_count', err);
    }
  }
}
