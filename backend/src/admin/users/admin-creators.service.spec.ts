import { AdminCreatorsService } from './admin-creators.service';
import { type SupabaseService } from '../../database/supabase.service';

const TS = '2026-05-01T00:00:00.000Z';

const buildSupabase = () => {
  const dataByTable: Record<string, unknown[]> = {
    creator_subscription_plans: [
      {
        creator_wallet: 'A',
        monthly_price_amount: '1000000000',
        payout_wallet: 'PA',
        is_active: true,
        verified: true,
        display_name: 'Alice',
        created_at: TS,
        updated_at: TS,
      },
      {
        creator_wallet: 'B',
        monthly_price_amount: '500000000',
        payout_wallet: 'PB',
        is_active: true,
        verified: false,
        display_name: null,
        created_at: TS,
        updated_at: TS,
      },
    ],
    creator_subscriptions: [
      { creator_wallet: 'A', plan_price_amount: '1000000000' },
      { creator_wallet: 'A', plan_price_amount: '1000000000' },
      { creator_wallet: 'B', plan_price_amount: '500000000' },
    ],
    strategies: [
      { creator_wallet_address: 'A' },
      { creator_wallet_address: 'A' },
      { creator_wallet_address: 'A' },
      { creator_wallet_address: 'B' },
    ],
  };

  const client = {
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        order: () => builder,
        eq: () => builder,
        gt: () => builder,
        limit: () => builder,
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: dataByTable[table] ?? [], error: null }).then(r),
      };
      return builder;
    },
  };
  return { client } as unknown as SupabaseService;
};

describe('AdminCreatorsService.listRoster', () => {
  it('aggregates MRR + subscriber + strategy counts and sorts by MRR desc', async () => {
    const roster = await new AdminCreatorsService(buildSupabase()).listRoster();

    expect(roster).toHaveLength(2);

    // A earns more → sorted first
    const [a, b] = roster;
    expect(a.creatorWallet).toBe('A');
    expect(a.displayName).toBe('Alice');
    expect(a.verified).toBe(true);
    expect(a.activeSubscribers).toBe(2);
    expect(a.mrrLamports).toBe('2000000000');
    expect(a.mrrSol).toBeCloseTo(2);
    expect(a.monthlyPriceSol).toBeCloseTo(1);
    expect(a.publishedStrategies).toBe(3);

    expect(b.creatorWallet).toBe('B');
    expect(b.activeSubscribers).toBe(1);
    expect(b.mrrLamports).toBe('500000000');
    expect(b.publishedStrategies).toBe(1);
  });

  it('returns an empty roster when there are no plans', async () => {
    const empty = {
      client: {
        from: () => {
          const builder: any = {
            select: () => builder,
            order: () => builder,
            eq: () => builder,
            gt: () => builder,
            limit: () => builder,
            then: (r: (v: unknown) => unknown) =>
              Promise.resolve({ data: [], error: null }).then(r),
          };
          return builder;
        },
      },
    } as unknown as SupabaseService;

    expect(await new AdminCreatorsService(empty).listRoster()).toEqual([]);
  });
});
