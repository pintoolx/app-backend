import { Injectable } from '@nestjs/common';
import { type AllocationMode, type StrategySubscriptionRow } from './subscriptions.repository';
import type {
  FollowerAllocationSkipReason,
  StrategyCycleOutput,
  StrategyFollowerAllocation,
} from './private-cycle-strategy-output';

export interface AllocationInput {
  subscriptionId: string;
  followerWallet: string;
  allocationMode: AllocationMode;
  /** Subscription's `max_capital` cap in raw token units (string -> bigint). */
  maxCapital: bigint;
  /** Status, used to skip paused/exiting followers. */
  status?: string;
  /** Maximum drawdown (bps) for safety guards. Optional. */
  maxDrawdownBps?: number | null;
}

export interface AllocationResult {
  subscriptionId: string;
  followerWallet: string;
  /** Basis points of the strategy's intended trade allocated to this follower. */
  allocationPctBps: number;
  /** Raw token units allocated to this follower (string for safe JSON). */
  allocationAmount: string;
  /** Set when the follower was intentionally skipped this cycle. */
  skipReason?: FollowerAllocationSkipReason;
  /** Sanitized hint propagated from the strategy. */
  operationHint?: string;
}

/**
 * Stateless allocation computation for the cycle planner.
 *
 * Three modes are supported:
 * - `proportional` — legacy mode. Notional is split across followers weighted
 *   by their `max_capital`. Used as the fallback when no
 *   `StrategyCycleOutput` is available.
 * - `fixed` — each follower's allocation is exactly `min(notional, maxCapital)`.
 *   The platform does not scale the size; the caller's responsibility to
 *   choose a notional that respects per-follower limits.
 * - `mirror` — the strategy itself (running inside PER) decides each
 *   follower's allocation. The platform only enforces a `maxCapital` clamp
 *   and respects strategy-side `skipReason` flags.
 *
 * This function intentionally takes only sanitized fields. It MUST NOT see
 * raw strategy parameters or signal payloads — only per-follower caps and
 * strategy-emitted allocation amounts.
 */
@Injectable()
export class FollowerVaultAllocationsService {
  /**
   * Legacy entry point: compute allocations from notional alone (no strategy
   * output). Supports `proportional` (active path) and `fixed` (caps to
   * maxCapital). Mirror followers fall through to zero — use
   * {@link computeAllocationsWithStrategyOutput} when running mirror cycles.
   */
  computeAllocations(subscriptions: AllocationInput[], notional: bigint): AllocationResult[] {
    if (notional <= 0n || subscriptions.length === 0) {
      return subscriptions.map((sub) => zeroResult(sub));
    }

    // Total weight only counts proportional+positive-cap followers.
    const proportionalEligible = subscriptions.filter(
      (sub) => sub.allocationMode === 'proportional' && sub.maxCapital > 0n,
    );
    const totalWeight = proportionalEligible.reduce((acc, sub) => acc + sub.maxCapital, 0n);

    return subscriptions.map((sub) => {
      if (sub.maxCapital <= 0n) return zeroResult(sub);
      switch (sub.allocationMode) {
        case 'proportional': {
          if (totalWeight === 0n) return zeroResult(sub);
          const share = (notional * sub.maxCapital) / totalWeight;
          const capped = share > sub.maxCapital ? sub.maxCapital : share;
          const bps = Number((sub.maxCapital * 10000n) / totalWeight);
          return {
            subscriptionId: sub.subscriptionId,
            followerWallet: sub.followerWallet,
            allocationPctBps: bps,
            allocationAmount: capped.toString(),
          };
        }
        case 'fixed': {
          const capped = notional > sub.maxCapital ? sub.maxCapital : notional;
          return {
            subscriptionId: sub.subscriptionId,
            followerWallet: sub.followerWallet,
            // Fixed mode does not have a meaningful pct bps; report ratio of
            // notional consumed.
            allocationPctBps: notional > 0n ? Number((capped * 10000n) / notional) : 0,
            allocationAmount: capped.toString(),
          };
        }
        case 'mirror':
        default:
          return zeroResult(sub);
      }
    });
  }

  /**
   * Phase-4 entry point: compute allocations using a `StrategyCycleOutput`
   * produced by the strategy itself. Mirror followers receive exactly the
   * strategy-supplied amount (clamped by `maxCapital`); proportional/fixed
   * followers fall back to {@link computeAllocations} unless the strategy
   * provided an explicit override.
   *
   * Skip semantics:
   * - subscriptions whose `status` is paused/exiting/closed get
   *   `skipReason: 'paused' | 'exiting'` and a zero allocation.
   * - Strategy-supplied `skipReason` is honoured verbatim.
   * - `policy-cap`: when a strategy-supplied amount exceeds maxCapital we
   *   clamp to maxCapital but DO NOT mark skipped (the receipt records the
   *   clamp via operationHint).
   */
  computeAllocationsWithStrategyOutput(
    subscriptions: AllocationInput[],
    output: StrategyCycleOutput,
  ): AllocationResult[] {
    const byId = new Map<string, StrategyFollowerAllocation>(
      output.followerAllocations.map((a) => [a.subscriptionId, a]),
    );
    return subscriptions.map((sub) => {
      // Lifecycle skips take priority over strategy intent.
      if (sub.status === 'paused') return skippedResult(sub, 'paused');
      if (sub.status === 'exiting' || sub.status === 'closed') {
        return skippedResult(sub, 'exiting');
      }
      const strategyLine = byId.get(sub.subscriptionId);
      if (!strategyLine) {
        return skippedResult(sub, 'strategy-skip');
      }
      if (strategyLine.skipReason) {
        return {
          ...zeroResult(sub),
          skipReason: strategyLine.skipReason,
          operationHint: strategyLine.operationHint,
        };
      }
      let amount = bigintFromMaybeString(strategyLine.allocationAmount);
      let operationHint = strategyLine.operationHint;
      if (sub.maxCapital > 0n && amount > sub.maxCapital) {
        operationHint = (operationHint ? operationHint + '; ' : '') + 'clamped-to-max-capital';
        amount = sub.maxCapital;
      }
      return {
        subscriptionId: sub.subscriptionId,
        followerWallet: sub.followerWallet,
        allocationPctBps: strategyLine.allocationPctBps ?? 0,
        allocationAmount: amount.toString(),
        operationHint,
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
      status: row.status,
      maxDrawdownBps: row.max_drawdown_bps,
    }));
  }
}

function zeroResult(sub: AllocationInput): AllocationResult {
  return {
    subscriptionId: sub.subscriptionId,
    followerWallet: sub.followerWallet,
    allocationPctBps: 0,
    allocationAmount: '0',
  };
}

function skippedResult(
  sub: AllocationInput,
  reason: FollowerAllocationSkipReason,
): AllocationResult {
  return { ...zeroResult(sub), skipReason: reason };
}

function bigintFromMaybeString(value: string): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
