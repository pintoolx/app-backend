/**
 * Phase 4 — Strategy-defined cycle output.
 *
 * The platform's cycle planner does NOT decide allocation sizes for `mirror`
 * subscriptions; it consumes a sanitized `StrategyCycleOutput` produced by
 * the strategy itself (run inside PER) and maps each line to a follower
 * fan-out plan. The platform reserves the right to clamp by `max_capital`
 * and reject by `max_drawdown_bps`, but the *intent* is set by the strategy.
 *
 * `StrategyCycleOutput.followerAllocations[].allocationAmount` is the raw
 * smallest-unit-of-mint amount, encoded as a string for safe JSON transport.
 * Both the strategy (producer) and the planner (consumer) MUST agree on the
 * mint unit before each cycle; mixing units silently is a critical bug.
 */

export type StrategyCycleIntent = 'open' | 'close' | 'rebalance' | 'noop';

export type FollowerAllocationSkipReason =
  | 'paused'
  | 'exiting'
  | 'over-drawdown'
  | 'policy-cap'
  | 'strategy-skip';

export interface StrategyFollowerAllocation {
  /** strategy_subscriptions.id this allocation is for. */
  subscriptionId: string;
  /**
   * Raw smallest-unit-of-mint allocation. Stored as a string to preserve
   * bigint precision when transported as JSON.
   */
  allocationAmount: string;
  /** Optional pre-computed share in basis points (informational). */
  allocationPctBps?: number;
  /**
   * Strategy-side request to skip this follower this cycle. The platform
   * still emits a receipt with `status = 'skipped'` so the audit trail
   * stays intact.
   */
  skipReason?: FollowerAllocationSkipReason;
  /** Sanitized hint string. MUST NOT contain raw signal inputs. */
  operationHint?: string;
}

export interface StrategyCycleOutput {
  cycleIntent: StrategyCycleIntent;
  followerAllocations: StrategyFollowerAllocation[];
  meta: {
    strategyVersion: number;
    /** Optional anchor reference (signal hash, oracle slot, etc.). */
    signalRef?: string;
  };
}

/**
 * Cycle planner pulls strategy outputs through this port. The default
 * implementation returns null (no strategy output, planner should fall back
 * to the legacy `notional + proportional` path). PER-backed implementations
 * fetch the output from the private runtime.
 */
export const PRIVATE_STRATEGY_OUTPUT_PROVIDER = Symbol('PrivateStrategyOutputProvider');

export interface FetchStrategyOutputParams {
  deploymentId: string;
  cycleId: string;
  idempotencyKey: string;
  /**
   * When true the provider should query the strategy fresh; when false the
   * provider may cache or replay the output it produced for this idempotency
   * key on a previous attempt.
   */
  replan: boolean;
}

export interface PrivateStrategyOutputProvider {
  getCycleOutput(params: FetchStrategyOutputParams): Promise<StrategyCycleOutput | null>;
}
