import { AdminRevenueService } from './admin-revenue.service';
import { type SupabaseService } from '../../database/supabase.service';

const NOW = new Date().toISOString();
const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

interface Filter {
  op: string;
  field: string;
  value: unknown;
}

/**
 * Minimal Supabase mock that supports the two shapes AdminRevenueService uses:
 *  - count:  .from(t).select('*', { head: true }).eq()/.gte()  → { count }
 *  - rows:   .from(t).select(cols).limit(n).eq()/.gt()         → { data }
 * The resolver below returns fixtures keyed by (table, head, filters).
 */
const buildSupabase = () => {
  const resolve = (table: string, head: boolean, filters: Filter[]) => {
    const has = (field: string) => filters.some((f) => f.field === field);
    const eqVal = (field: string) => filters.find((f) => f.op === 'eq' && f.field === field)?.value;

    if (head) {
      if (table === 'creator_subscriptions') {
        const status = eqVal('status') as string;
        const counts: Record<string, number> = {
          payment_required: 2,
          active: 3,
          cancelled: 1,
          expired: 4,
        };
        return { count: counts[status] ?? 0, error: null };
      }
      if (table === 'creator_subscription_payments') {
        // The only head-count on payments is the rejected-in-window query.
        return { count: 1, error: null };
      }
      if (table === 'creator_subscription_plans') {
        if (has('verified')) return { count: 2, error: null };
        if (has('is_active')) return { count: 4, error: null };
        return { count: 5, error: null };
      }
      return { count: 0, error: null };
    }

    // row fetches
    if (table === 'creator_subscriptions') {
      // active subs for MRR: 1 + 0.5 + 2 = 3.5 SOL
      return {
        data: [
          { plan_price_amount: '1000000000' },
          { plan_price_amount: '500000000' },
          { plan_price_amount: '2000000000' },
        ],
        error: null,
      };
    }
    if (table === 'creator_subscription_payments') {
      return {
        data: [
          { amount: '1000000000', created_at: NOW },
          { amount: '500000000', created_at: NOW },
          { amount: '9000000000', created_at: SIXTY_DAYS_AGO },
        ],
        error: null,
      };
    }
    if (table === 'strategy_purchases') {
      return {
        data: [
          { price_amount: '2000000000', created_at: NOW },
          { price_amount: '3000000000', created_at: SIXTY_DAYS_AGO },
        ],
        error: null,
      };
    }
    return { data: [], error: null };
  };

  const client = {
    from: (table: string) => {
      const filters: Filter[] = [];
      let head = false;
      const builder: any = {
        select: (_cols: string, opts?: { head?: boolean }) => {
          head = Boolean(opts?.head);
          return builder;
        },
        limit: () => builder,
        eq: (field: string, value: unknown) => {
          filters.push({ op: 'eq', field, value });
          return builder;
        },
        gt: (field: string, value: unknown) => {
          filters.push({ op: 'gt', field, value });
          return builder;
        },
        gte: (field: string, value: unknown) => {
          filters.push({ op: 'gte', field, value });
          return builder;
        },
        then: (resolveFn: (value: unknown) => unknown) =>
          Promise.resolve(resolve(table, head, filters)).then(resolveFn),
      };
      return builder;
    },
  };

  return { client } as unknown as SupabaseService;
};

describe('AdminRevenueService', () => {
  it('aggregates MRR, windowed collections, counts and rejection rate', async () => {
    const service = new AdminRevenueService(buildSupabase());
    const summary = await service.getSummary();

    // MRR = 1 + 0.5 + 2 = 3.5 SOL over 3 active subscriptions
    expect(summary.mrr.lamports).toBe('3500000000');
    expect(summary.mrr.sol).toBeCloseTo(3.5);
    expect(summary.mrr.activeSubscriptions).toBe(3);

    // Collected 30d = recent subs (1 + 0.5) + recent buyout (2) = 3.5 SOL
    expect(summary.collectedLast30d.lamports).toBe('3500000000');
    expect(summary.collectedLast30d.subscriptionsLamports).toBe('1500000000');
    expect(summary.collectedLast30d.buyoutsLamports).toBe('2000000000');

    // Lifetime = subs (1 + 0.5 + 9) + buyouts (2 + 3) = 15.5 SOL
    expect(summary.lifetimeCollected.lamports).toBe('15500000000');
    expect(summary.lifetimeCollected.sol).toBeCloseTo(15.5);

    // Subscription status buckets
    expect(summary.subscriptions.byStatus).toEqual({
      payment_required: 2,
      active: 3,
      cancelled: 1,
      expired: 4,
    });
    expect(summary.subscriptions.total).toBe(10);

    // Payments: 2 confirmed in window, 1 rejected → 1/3 = 3333 bps
    expect(summary.payments.confirmedLast30d).toBe(2);
    expect(summary.payments.rejectedLast30d).toBe(1);
    expect(summary.payments.rejectionRateBps).toBe(3333);

    // Buyouts: 1 in window, 2 lifetime, 5 SOL lifetime
    expect(summary.buyouts.last30d).toBe(1);
    expect(summary.buyouts.lifetime).toBe(2);
    expect(summary.buyouts.lifetimeLamports).toBe('5000000000');

    // Plans
    expect(summary.plans).toEqual({ total: 5, active: 4, verified: 2 });

    expect(summary.currency).toBe('SOL');
    expect(summary.truncated).toBe(false);
  });

  it('reports a zero rejection rate when there are no payments in the window', async () => {
    const empty = {
      client: {
        from: () => {
          const builder: any = {
            select: () => builder,
            limit: () => builder,
            eq: () => builder,
            gt: () => builder,
            gte: () => builder,
            then: (r: (v: unknown) => unknown) =>
              Promise.resolve({ count: 0, data: [], error: null }).then(r),
          };
          return builder;
        },
      },
    } as unknown as SupabaseService;

    const service = new AdminRevenueService(empty);
    const summary = await service.getSummary();

    expect(summary.payments.rejectionRateBps).toBe(0);
    expect(summary.mrr.lamports).toBe('0');
    expect(summary.subscriptions.total).toBe(0);
  });
});
