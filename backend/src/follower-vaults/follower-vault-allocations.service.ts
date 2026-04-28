import { Injectable } from '@nestjs/common';
import { type AllocationMode, type StrategySubscriptionRow } from './subscriptions.repository';

export interface AllocationInput {
  subscriptionId: string;
  followerWallet: string;
  allocationMode: AllocationMode;
  /** Subscription's `max_capital` cap in raw token units (string -> bigint). */
  maxCapital: bigint;
}

export interface AllocationResult {
  subscriptionId: string;
  followerWallet: string;
  /** Basis points of the strategy's intended trade allocated to this follower. */
  allocationPctBps: number;
  /** Raw token units allocated to this follower (string for safe JSON). */
  allocationAmount: string;
}

/**
 * Stateless allocation computation for the Phase-1 cycle scaffold.
 *
 * Inputs come from `strategy_subscriptions` rows; the only currently supported
 * mode is `proportional` which weights each follower's slice of `notional` by
 * their declared `max_capital`. `fixed` and `mirror` are accepted in the
 * subscription schema but produce a zero allocation here until the real
 * algorithms land.
 *
 * This function intentionally takes only sanitized fields. It MUST NOT see
 * raw strategy parameters or signal payloads — only the per-follower caps.
 */
@Injectable()
export class FollowerVaultAllocationsService {
  computeAllocations(subscriptions: AllocationInput[], notional: bigint): AllocationResult[] {
    if (notional <= 0n || subscriptions.length === 0) {
      return subscriptions.map((sub) => ({
        subscriptionId: sub.subscriptionId,
        followerWallet: sub.followerWallet,
        allocationPctBps: 0,
        allocationAmount: '0',
      }));
    }

    const eligible = subscriptions.filter(
      (sub) => sub.allocationMode === 'proportional' && sub.maxCapital > 0n,
    );
    const totalWeight = eligible.reduce((acc, sub) => acc + sub.maxCapital, 0n);

    return subscriptions.map((sub) => {
      if (sub.allocationMode !== 'proportional' || sub.maxCapital <= 0n || totalWeight === 0n) {
        return {
          subscriptionId: sub.subscriptionId,
          followerWallet: sub.followerWallet,
          allocationPctBps: 0,
          allocationAmount: '0',
        };
      }
      // Compute the proportional share, capped by max_capital. Use bigint
      // throughout to avoid precision loss on raw token units.
      const share = (notional * sub.maxCapital) / totalWeight;
      const capped = share > sub.maxCapital ? sub.maxCapital : share;
      const bps = Number((sub.maxCapital * 10000n) / totalWeight);
      return {
        subscriptionId: sub.subscriptionId,
        followerWallet: sub.followerWallet,
        allocationPctBps: bps,
        allocationAmount: capped.toString(),
      };
    });
  }

  /**
   * Convenience wrapper that maps DB rows -> `AllocationInput` shape.
   */
  fromRows(rows: StrategySubscriptionRow[]): AllocationInput[] {
    return rows.map((row) => ({
      subscriptionId: row.id,
      followerWallet: row.follower_wallet,
      allocationMode: row.allocation_mode,
      maxCapital: row.max_capital ? BigInt(row.max_capital) : 0n,
    }));
  }
}
