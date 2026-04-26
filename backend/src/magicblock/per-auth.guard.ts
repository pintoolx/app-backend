import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PerAuthTokensRepository, type PerAuthTokenRow } from './per-auth-tokens.repository';

/**
 * Validates a PER bearer token (`Authorization: Bearer <token>`) against the
 * `per_auth_tokens` table. Attaches the resolved row to the request as
 * `request.perToken` for downstream handlers.
 *
 * Use alongside JwtAuthGuard for endpoints that should require both wallet
 * authentication and explicit PER permission, e.g. private-state reads.
 */
@Injectable()
export class PerAuthGuard implements CanActivate {
  constructor(private readonly tokensRepo: PerAuthTokensRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { perToken?: PerAuthTokenRow }>();
    const header = (req.headers['x-per-token'] as string | undefined) ?? req.headers.authorization;
    const token = this.extractToken(header);
    if (!token) {
      throw new UnauthorizedException('Missing PER auth token');
    }
    const row = await this.tokensRepo.getActiveOrThrow(token);
    req.perToken = row;
    return true;
  }

  private extractToken(header: string | undefined): string | null {
    if (!header) return null;
    if (header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7).trim();
    }
    return header.trim();
  }
}
