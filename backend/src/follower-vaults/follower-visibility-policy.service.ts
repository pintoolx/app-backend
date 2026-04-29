import { Injectable, Logger } from '@nestjs/common';
import {
  FollowerVisibilityGrantsRepository,
  type FollowerVisibilityGrantRow,
  type VisibilityGrantScope,
} from './follower-visibility-grants.repository';
import { type StrategySubscriptionRow } from './subscriptions.repository';

/**
 * Phase-3 visibility policy gate.
 *
 * Decides whether a caller (identified by wallet address) is allowed to read
 * a particular sanitized private surface for a given subscription. Owners
 * (the follower the subscription belongs to) always pass; non-owners must
 * present an active visibility grant whose scope covers the requested
 * surface. Expired grants are surfaced as `denied` without mutating the
 * underlying row.
 *
 * The platform reads grants every time a query lands; for high-traffic
 * paths the caller can attach a request-scoped cache around this service.
 */
@Injectable()
export class FollowerVisibilityPolicyService {
  private readonly logger = new Logger(FollowerVisibilityPolicyService.name);

  constructor(private readonly grantsRepository: FollowerVisibilityGrantsRepository) {}

  /** Read sanitized follower private state (PER `getFollowerPrivateState`). */
  async canReadPrivateState(
    callerWallet: string,
    subscription: StrategySubscriptionRow,
  ): Promise<PolicyDecision> {
    return this.evaluate(callerWallet, subscription, ['vault-state']);
  }

  /** Read encrypted treasury balance (Umbra `getEncryptedBalance`). */
  async canReadPrivateBalance(
    callerWallet: string,
    subscription: StrategySubscriptionRow,
  ): Promise<PolicyDecision> {
    return this.evaluate(callerWallet, subscription, ['vault-balance']);
  }

  private async evaluate(
    callerWallet: string,
    subscription: StrategySubscriptionRow,
    requiredScopes: VisibilityGrantScope[],
  ): Promise<PolicyDecision> {
    if (callerWallet === subscription.follower_wallet) {
      return { allowed: true, reason: 'owner', subscriptionId: subscription.id };
    }
    const grants = await this.grantsRepository.listBySubscription(subscription.id);
    const now = Date.now();
    const matching = grants.find((g) =>
      this.grantCoversScopes(g, callerWallet, requiredScopes, now),
    );
    if (matching) {
      return {
        allowed: true,
        reason: 'grant',
        grantId: matching.id,
        scope: matching.scope,
        subscriptionId: subscription.id,
      };
    }
    this.logger.debug(
      `policy deny wallet=${callerWallet} subscription=${subscription.id} scopes=${requiredScopes.join(',')}`,
    );
    return {
      allowed: false,
      reason: 'no-grant',
      subscriptionId: subscription.id,
    };
  }

  private grantCoversScopes(
    grant: FollowerVisibilityGrantRow,
    callerWallet: string,
    requiredScopes: VisibilityGrantScope[],
    nowMs: number,
  ): boolean {
    if (grant.grantee_wallet !== callerWallet) return false;
    if (grant.status !== 'active') return false;
    if (grant.expires_at && new Date(grant.expires_at).getTime() <= nowMs) return false;
    return requiredScopes.includes(grant.scope);
  }
}

export type PolicyDecision =
  | { allowed: true; reason: 'owner'; subscriptionId: string }
  | {
      allowed: true;
      reason: 'grant';
      grantId: string;
      scope: VisibilityGrantScope;
      subscriptionId: string;
    }
  | { allowed: false; reason: 'no-grant'; subscriptionId: string };
