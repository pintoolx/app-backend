import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AdminTokenService, type AdminAccessClaims } from './admin-token.service';

export interface AdminAuthRequest extends Request {
  admin?: AdminAccessClaims;
  ipAllowed?: boolean;
}

/**
 * Validates the bearer access token, attaches `admin` claims to the request,
 * and enforces an optional comma-separated IP allowlist (`ADMIN_IP_ALLOWLIST`).
 *
 * The IP allowlist is supplemental — production deployments should still gate
 * the admin subdomain at the network edge (Cloudflare Access / Tailscale).
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  private readonly allowlist: Set<string>;

  constructor(
    private readonly tokenService: AdminTokenService,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string>('admin.ipAllowlist') ?? '';
    this.allowlist = new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminAuthRequest>();
    const header = req.headers['authorization'];
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing admin bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    const claims = await this.tokenService.verifyAccessToken(token);

    const ip = AdminJwtGuard.extractIp(req);
    const allowed = this.allowlist.size === 0 || (ip !== null && this.allowlist.has(ip));
    if (!allowed) {
      throw new UnauthorizedException('Source IP is not allowed for admin access');
    }
    req.admin = claims;
    req.ipAllowed = true;
    return true;
  }

  static extractIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.ip ?? null;
  }
}
