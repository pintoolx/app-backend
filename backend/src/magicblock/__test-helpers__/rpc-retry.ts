/**
 * Test-only helpers for working around devnet RPC rate-limiting (429) and
 * the Magic Router `getDelegationStatus` endpoint sometimes returning
 * `undefined` while a freshly delegated account is still propagating.
 *
 * Not part of the production runtime — only imported from `*.integration.spec.ts`.
 */
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * MagicBlock delegation program. When an account is delegated to ER, its
 * owner field on the base layer transitions from its original owner to this
 * program id. We use that as a ground-truth fallback for delegation status.
 */
export const MAGICBLOCK_DELEGATION_PROGRAM = new PublicKey(
  'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh',
);

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|Too Many Requests|rate.?limit|-32429/i.test(msg);
}

/**
 * Retry an async RPC call with exponential backoff when it hits a 429.
 * Other errors propagate immediately. Default: 6 attempts, 1.5s→48s.
 *
 * Helius devnet returns 429s in bursts when several integration tests run
 * back-to-back. The earlier defaults (5 attempts × 750ms base) capped total
 * backoff at ~12s which is too short for a real rate-limit window.
 */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err)) throw err;
      // Cap individual backoff at 48s so a transient burst doesn't blow
      // the suite-level Jest timeout outright.
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 48_000);
      // eslint-disable-next-line no-console
      console.warn(
        `[rpc-retry] ${opts.label ?? 'rpc'} hit 429, attempt ${attempt + 1}/${maxAttempts}, sleeping ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Returns whether `account` is currently delegated to the MagicBlock
 * delegation program. Tries the Magic Router's `getDelegationStatus` RPC
 * first (if a callable is supplied) and falls back to a base-layer account
 * owner check, which is authoritative.
 */
export async function checkDelegation(
  baseConnection: Connection,
  account: PublicKey,
  routerStatusFn?: (pk: PublicKey) => Promise<{ isDelegated: boolean } | undefined>,
): Promise<boolean> {
  if (routerStatusFn) {
    try {
      const status = await routerStatusFn(account);
      if (status && status.isDelegated) return true;
    } catch {
      // fall through to base-layer check
    }
  }
  try {
    const info = await withRpcRetry(() => baseConnection.getAccountInfo(account), {
      label: 'getAccountInfo(delegation-check)',
    });
    return !!info && info.owner.equals(MAGICBLOCK_DELEGATION_PROGRAM);
  } catch {
    return false;
  }
}

/**
 * Poll until `predicate` returns true or `maxAttempts` is exceeded.
 * Used by integration tests instead of fixed-interval loops so they bail
 * out cleanly on success and keep total runtime predictable.
 */
export async function pollUntil(
  predicate: () => Promise<boolean>,
  opts: { intervalMs?: number; maxAttempts?: number; label?: string } = {},
): Promise<boolean> {
  const intervalMs = opts.intervalMs ?? 3000;
  const maxAttempts = opts.maxAttempts ?? 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (await predicate()) return true;
    } catch {
      // ignore, retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
