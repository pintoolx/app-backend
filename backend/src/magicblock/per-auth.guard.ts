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
 *
 * Phase-1 follower-vault privacy: the row carries `scope_kind` so that
 * downstream handlers can decide whether the token is allowed to access a
 * follower-self surface (`subscription`) or a deployment-wide surface
 * (`deployment`). Use {@link assertSubscriptionScope} /
 * {@link assertDeploymentScope} from controllers/services to enforce this.
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

/**
 * Throws 401 unless the token is a subscription-scoped token bound to the
 * given subscription id. Use from follower-self controllers to ensure a
 * deployment-wide token is never replayed against a subscription endpoint.
 */
export function assertSubscriptionScope(
  token: PerAuthTokenRow | undefined,
  subscriptionId: string,
): asserts token is PerAuthTokenRow {
  if (!token) {
    throw new UnauthorizedException('Missing PER auth token');
  }
  if (token.scope_kind !== 'subscription') {
    throw new UnauthorizedException('Deployment-scope PER token cannot access subscription state');
  }
  if (token.subscription_id !== subscriptionId) {
    throw new UnauthorizedException('PER token is not scoped to this subscription');
  }
}

/**
 * Throws 401 unless the token is a deployment-scope token. Use from
 * deployment-wide private state controllers to reject subscription tokens
 * being escalated to deployment-wide reads.
 */
export function assertDeploymentScope(
  token: PerAuthTokenRow | undefined,
  deploymentId: string,
): asserts token is PerAuthTokenRow {
  if (!token) {
    throw new UnauthorizedException('Missing PER auth token');
  }
  if (token.scope_kind !== 'deployment') {
    throw new UnauthorizedException('Subscription-scope PER token cannot access deployment state');
  }
  if (token.deployment_id !== deploymentId) {
    throw new UnauthorizedException('PER token does not belong to this deployment');
  }
}
