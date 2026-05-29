import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

const LAMPORTS_PER_SOL = 1_000_000_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Safety bound for in-JS aggregation. Revenue sums are computed by pulling the
 * relevant amount columns and folding them with BigInt rather than via a SQL
 * aggregate, which is fine at the current (early) scale. If a fetch hits this
 * cap the summary is flagged `truncated` so the UI never silently under-reports;
 * migrate the sums to a Postgres RPC / aggregate before that happens.
 */
const ROW_FETCH_CAP = 50_000;

type SubscriptionStatus = 'payment_required' | 'active' | 'cancelled' | 'expired';
const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'payment_required',
  'active',
  'cancelled',
  'expired',
];

export interface LamportAmount {
  lamports: string;
  sol: number;
}

export interface AdminRevenueSummary {
  generatedAt: string;
  currency: 'SOL';
  windowDays: number;
  /** Monthly recurring revenue = Σ plan_price_amount over currently-active subscriptions. */
  mrr: LamportAmount & { activeSubscriptions: number };
  /** Confirmed inflows in the trailing window, split by source. */
  collectedLast30d: LamportAmount & {
    subscriptionsLamports: string;
    buyoutsLamports: string;
  };
  lifetimeCollected: LamportAmount;
  subscriptions: {
    total: number;
    byStatus: Record<SubscriptionStatus, number>;
  };
  payments: {
    confirmedLast30d: number;
    rejectedLast30d: number;
    /** Rejected / (confirmed + rejected) over the window, in basis points. */
    rejectionRateBps: number;
  };
  buyouts: {
    last30d: number;
    lifetime: number;
    lifetimeLamports: string;
    lifetimeSol: number;
  };
  plans: {
    total: number;
    active: number;
    verified: number;
  };
  /** True if any underlying fetch hit ROW_FETCH_CAP and sums may understate. */
  truncated: boolean;
}

export interface SubscriptionPaymentRow {
  id: string;
  subscription_id: string;
  creator_wallet: string;
  subscriber_wallet: string;
  tx_signature: string;
  amount: string;
  status: 'confirmed' | 'rejected';
  period_start: string;
  period_end: string;
  created_at: string;
}

export interface StrategyBuyoutRow {
  id: string;
  strategy_id: string;
  buyer_wallet: string;
  price_amount: string;
  payment_tx_signature: string;
  payout_wallet: string;
  created_at: string;
}

const PAYMENT_LEDGER_COLUMNS =
  'id, subscription_id, creator_wallet, subscriber_wallet, tx_signature, amount, status, period_start, period_end, created_at';
const BUYOUT_LEDGER_COLUMNS =
  'id, strategy_id, buyer_wallet, price_amount, payment_tx_signature, payout_wallet, created_at';
const LEDGER_DEFAULT_LIMIT = 100;
const LEDGER_MAX_LIMIT = 500;

/** Parse a lamport value stored as text (`'^[0-9]+$'`) or numeric into BigInt. */
function toLamports(value: unknown): bigint {
  if (value == null) return 0n;
  const intPart = String(value).trim().split('.')[0];
  if (!/^-?\d+$/.test(intPart)) return 0n;
  return BigInt(intPart);
}

function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

function asAmount(lamports: bigint): LamportAmount {
  return { lamports: lamports.toString(), sol: lamportsToSol(lamports) };
}

@Injectable()
export class AdminRevenueService {
  private readonly logger = new Logger(AdminRevenueService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async getSummary(): Promise<AdminRevenueSummary> {
    const sinceIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const nowIso = new Date().toISOString();
    let truncated = false;

    const [
      activeSubsForMrr,
      confirmedPayments,
      buyoutRows,
      rejectedLast30d,
      byStatusEntries,
      plansTotal,
      plansActive,
      plansVerified,
    ] = await Promise.all([
      // MRR: active subscriptions whose paid period has not yet lapsed.
      this.fetchRows('creator_subscriptions', 'plan_price_amount', (q) =>
        q.eq('status', 'active').gt('current_period_end', nowIso),
      ),
      // All confirmed subscription payments (for lifetime + windowed sums).
      this.fetchRows('creator_subscription_payments', 'amount, created_at', (q) =>
        q.eq('status', 'confirmed'),
      ),
      // All buyouts (for lifetime + windowed sums/counts).
      this.fetchRows('strategy_purchases', 'price_amount, created_at'),
      this.countRows('creator_subscription_payments', (q) =>
        q.eq('status', 'rejected').gte('created_at', sinceIso),
      ),
      Promise.all(
        SUBSCRIPTION_STATUSES.map(async (status) => ({
          status,
          count: await this.countRows('creator_subscriptions', (q) => q.eq('status', status)),
        })),
      ),
      this.countRows('creator_subscription_plans'),
      this.countRows('creator_subscription_plans', (q) => q.eq('is_active', true)),
      this.countRows('creator_subscription_plans', (q) => q.eq('verified', true)),
    ]);

    truncated =
      activeSubsForMrr.truncated || confirmedPayments.truncated || buyoutRows.truncated;

    // --- MRR ---
    const mrrLamports = activeSubsForMrr.rows.reduce<bigint>(
      (sum, r) => sum + toLamports((r as { plan_price_amount?: unknown }).plan_price_amount),
      0n,
    );

    // --- Subscription payment sums (lifetime + windowed) ---
    let subsLifetime = 0n;
    let subsLast30d = 0n;
    let confirmedLast30d = 0;
    for (const r of confirmedPayments.rows as { amount?: unknown; created_at?: string }[]) {
      const amt = toLamports(r.amount);
      subsLifetime += amt;
      if (r.created_at && r.created_at >= sinceIso) {
        subsLast30d += amt;
        confirmedLast30d += 1;
      }
    }

    // --- Buyout sums/counts (lifetime + windowed) ---
    let buyoutLifetime = 0n;
    let buyoutLast30d = 0n;
    let buyoutCountLast30d = 0;
    for (const r of buyoutRows.rows as { price_amount?: unknown; created_at?: string }[]) {
      const amt = toLamports(r.price_amount);
      buyoutLifetime += amt;
      if (r.created_at && r.created_at >= sinceIso) {
        buyoutLast30d += amt;
        buyoutCountLast30d += 1;
      }
    }

    const byStatus = SUBSCRIPTION_STATUSES.reduce(
      (acc, status) => {
        acc[status] = byStatusEntries.find((e) => e.status === status)?.count ?? 0;
        return acc;
      },
      {} as Record<SubscriptionStatus, number>,
    );
    const subscriptionsTotal = Object.values(byStatus).reduce((a, b) => a + b, 0);

    const paymentDenominator = confirmedLast30d + rejectedLast30d;
    const rejectionRateBps =
      paymentDenominator > 0 ? Math.round((rejectedLast30d / paymentDenominator) * 10_000) : 0;

    const collectedLast30dLamports = subsLast30d + buyoutLast30d;
    const lifetimeLamports = subsLifetime + buyoutLifetime;

    return {
      generatedAt: nowIso,
      currency: 'SOL',
      windowDays: 30,
      mrr: { ...asAmount(mrrLamports), activeSubscriptions: activeSubsForMrr.rows.length },
      collectedLast30d: {
        ...asAmount(collectedLast30dLamports),
        subscriptionsLamports: subsLast30d.toString(),
        buyoutsLamports: buyoutLast30d.toString(),
      },
      lifetimeCollected: asAmount(lifetimeLamports),
      subscriptions: { total: subscriptionsTotal, byStatus },
      payments: { confirmedLast30d, rejectedLast30d, rejectionRateBps },
      buyouts: {
        last30d: buyoutCountLast30d,
        lifetime: buyoutRows.rows.length,
        lifetimeLamports: buyoutLifetime.toString(),
        lifetimeSol: lamportsToSol(buyoutLifetime),
      },
      plans: { total: plansTotal, active: plansActive, verified: plansVerified },
      truncated,
    };
  }

  /** Creator-subscription payment ledger (confirmed + rejected), newest first. */
  async listPayments(params: {
    status?: 'confirmed' | 'rejected';
    creatorWallet?: string;
    subscriberWallet?: string;
    limit?: number;
  }): Promise<SubscriptionPaymentRow[]> {
    const limit = Math.min(Math.max(params.limit ?? LEDGER_DEFAULT_LIMIT, 1), LEDGER_MAX_LIMIT);
    let q = this.supabaseService.client
      .from('creator_subscription_payments')
      .select(PAYMENT_LEDGER_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (params.status) q = q.eq('status', params.status);
    if (params.creatorWallet) q = q.eq('creator_wallet', params.creatorWallet);
    if (params.subscriberWallet) q = q.eq('subscriber_wallet', params.subscriberWallet);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list subscription payments (admin)', error);
      return [];
    }
    return (data ?? []) as unknown as SubscriptionPaymentRow[];
  }

  /** Strategy one-time buyout ledger, newest first. */
  async listBuyouts(params: {
    strategyId?: string;
    buyerWallet?: string;
    limit?: number;
  }): Promise<StrategyBuyoutRow[]> {
    const limit = Math.min(Math.max(params.limit ?? LEDGER_DEFAULT_LIMIT, 1), LEDGER_MAX_LIMIT);
    let q = this.supabaseService.client
      .from('strategy_purchases')
      .select(BUYOUT_LEDGER_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (params.strategyId) q = q.eq('strategy_id', params.strategyId);
    if (params.buyerWallet) q = q.eq('buyer_wallet', params.buyerWallet);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list strategy buyouts (admin)', error);
      return [];
    }
    return (data ?? []) as unknown as StrategyBuyoutRow[];
  }

  // ---------------------------------------------------------------- helpers

  private async countRows(
    table: string,
    refine?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<number> {
    let q = this.supabaseService.client.from(table).select('*', { count: 'exact', head: true });
    if (refine) q = refine(q);
    const { count, error } = await q;
    if (error) {
      this.logger.warn(`Failed to count rows in ${table}: ${error.message}`);
      return 0;
    }
    return count ?? 0;
  }

  private async fetchRows(
    table: string,
    columns: string,
    refine?: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<{ rows: unknown[]; truncated: boolean }> {
    let q = this.supabaseService.client.from(table).select(columns).limit(ROW_FETCH_CAP);
    if (refine) q = refine(q);
    const { data, error } = await q;
    if (error) {
      this.logger.warn(`Failed to fetch rows from ${table}: ${error.message}`);
      return { rows: [], truncated: false };
    }
    const rows = data ?? [];
    const truncated = rows.length >= ROW_FETCH_CAP;
    if (truncated) {
      this.logger.warn(
        `Revenue aggregation hit ROW_FETCH_CAP (${ROW_FETCH_CAP}) on ${table}; sums understate. Move to a SQL aggregate.`,
      );
    }
    return { rows, truncated };
  }
}
