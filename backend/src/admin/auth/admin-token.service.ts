import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTPayload } from 'jose';
import { randomBytes } from 'crypto';
import type { AdminRole } from './admin-users.repository';

export type AdminJwtScope = 'access' | '2fa-pending';

export interface AdminAccessClaims extends JWTPayload {
  sub: string;
  email: string;
  role: AdminRole;
  scope: 'access';
}

export interface AdminTempClaims extends JWTPayload {
  sub: string;
  email: string;
  scope: '2fa-pending';
}

const ADMIN_AUDIENCE = 'admin';

/**
 * Issues and verifies admin-scoped JWTs.
 *
 * The admin secret is intentionally distinct from the Supabase user JWT
 * secret so a leak of either side does not let attackers cross-mint tokens.
 * We add an `aud: 'admin'` claim and validate it on every verify, defending
 * against confused-deputy bugs where an admin guard accidentally accepts a
 * user token.
 */
@Injectable()
export class AdminTokenService {
  private readonly secret: Uint8Array | null;
  private readonly accessTtl: string;
  private readonly tempTtl: string;
  private readonly refreshTtlMs: number;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('admin.jwtSecret');
    this.secret = secret ? new TextEncoder().encode(secret) : null;
    this.accessTtl = this.configService.get<string>('admin.accessTokenTtl') || '15m';
    this.tempTtl = this.configService.get<string>('admin.tempTokenTtl') || '5m';
    this.refreshTtlMs = AdminTokenService.parseDurationMs(
      this.configService.get<string>('admin.refreshTokenTtl') || '7d',
    );
  }

  /** Generates a 64-byte random refresh token (raw, base64url). */
  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  computeRefreshExpiry(): Date {
    return new Date(Date.now() + this.refreshTtlMs);
  }

  async signAccessToken(claims: Omit<AdminAccessClaims, 'scope' | 'iat' | 'exp'>): Promise<string> {
    return this.sign({ ...claims, scope: 'access' }, this.accessTtl);
  }

  async signTempToken(claims: Omit<AdminTempClaims, 'scope' | 'iat' | 'exp'>): Promise<string> {
    return this.sign({ ...claims, scope: '2fa-pending' }, this.tempTtl);
  }

  async verifyAccessToken(token: string): Promise<AdminAccessClaims> {
    const payload = await this.verify(token);
    if (payload.scope !== 'access') {
      throw new UnauthorizedException('Token scope is not an admin access token');
    }
    return payload as AdminAccessClaims;
  }

  async verifyTempToken(token: string): Promise<AdminTempClaims> {
    const payload = await this.verify(token);
    if (payload.scope !== '2fa-pending') {
      throw new UnauthorizedException('Token scope is not a 2FA-pending token');
    }
    return payload as AdminTempClaims;
  }

  isConfigured(): boolean {
    return this.secret !== null;
  }

  private async sign(payload: JWTPayload & { scope: AdminJwtScope }, ttl: string): Promise<string> {
    if (!this.secret) {
      throw new InternalServerErrorException('ADMIN_JWT_SECRET is not configured');
    }
    const { SignJWT } = await import('jose');
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setAudience(ADMIN_AUDIENCE)
      .setExpirationTime(ttl)
      .sign(this.secret);
  }

  private async verify(token: string): Promise<JWTPayload & { scope: AdminJwtScope }> {
    if (!this.secret) {
      throw new InternalServerErrorException('ADMIN_JWT_SECRET is not configured');
    }
    try {
      const { jwtVerify } = await import('jose');
      const { payload } = await jwtVerify(token, this.secret, {
        audience: ADMIN_AUDIENCE,
      });
      const scope = (payload as JWTPayload & { scope?: unknown }).scope;
      if (scope !== 'access' && scope !== '2fa-pending') {
        throw new UnauthorizedException('Admin token has no recognised scope');
      }
      return payload as JWTPayload & { scope: AdminJwtScope };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired admin token');
    }
  }

  static parseDurationMs(input: string): number {
    const trimmed = input.trim();
    const match = /^(\d+)([smhd])$/.exec(trimmed);
    if (!match) {
      // Fall back to plain seconds.
      const asInt = parseInt(trimmed, 10);
      if (Number.isFinite(asInt) && asInt > 0) return asInt * 1000;
      throw new InternalServerErrorException(
        `Invalid duration string for admin token TTL: ${input}`,
      );
    }
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return n * multipliers[unit];
  }
}
