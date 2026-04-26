import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { BannedWalletsRepository } from './banned-wallets.repository';

/**
 * Blocks user-facing routes for banned wallets.
 *
 * The guard:
 *   - Skips any path under `/admin/*` (admins must always be able to log in
 *     and unban themselves out of a misfire).
 *   - Skips `/health/*` and `/metrics` so probes / observability stay live.
 *   - Looks for an authenticated wallet on the request (set by the existing
 *     wallet-jwt middleware as `req.user.walletAddress`). Anonymous routes
 *     are not subject to ban checks here — they can't act on protected
 *     resources anyway.
 *   - Returns 403 with a stable JSON shape so the frontend can show a
 *     specific "your wallet is banned" toast vs a generic auth error.
 *
 * The check uses an in-process LRU cache (5s TTL, 256 entries) to absorb
 * burst traffic without hammering Supabase.
 */
@Injectable()
export class BannedWalletsGuard implements CanActivate {
  private readonly logger = new Logger(BannedWalletsGuard.name);
  private readonly cache = new Map<string, { banned: boolean; expiresAt: number }>();
  private static readonly TTL_MS = 5_000;
  private static readonly MAX_ENTRIES = 256;

  constructor(private readonly bannedRepo: BannedWalletsRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { walletAddress?: string } }>();
    const url = (req.originalUrl || req.url || '').split('?')[0];

    // Always bypass admin and infra routes.
    if (
      url.startsWith('/admin/') ||
      url.startsWith('/health') ||
      url === '/metrics' ||
      url === '/'
    ) {
      return true;
    }

    const wallet = req.user?.walletAddress;
    if (!wallet) return true;

    if (await this.isBanned(wallet)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'WalletBanned',
        message:
          'This wallet is banned from using the platform. Contact support if this is unexpected.',
        wallet,
      });
    }
    return true;
  }

  private async isBanned(wallet: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.cache.get(wallet);
    if (cached && cached.expiresAt > now) return cached.banned;

    const banned = await this.bannedRepo.isCurrentlyBanned(wallet).catch((err) => {
      this.logger.warn(
        `banned_wallets check failed for ${wallet}: ${err instanceof Error ? err.message : err}`,
      );
      // Fail-open on infra errors so a broken DB does not lock all users out.
      return false;
    });

    this.cache.set(wallet, { banned, expiresAt: now + BannedWalletsGuard.TTL_MS });
    if (this.cache.size > BannedWalletsGuard.MAX_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    return banned;
  }
}
