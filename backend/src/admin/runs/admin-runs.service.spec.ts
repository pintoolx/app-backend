import { AdminRunsService } from './admin-runs.service';
import { type SupabaseService } from '../../database/supabase.service';

interface Filter {
  op: string;
  field: string;
  value: unknown;
}

/**
 * strategy_runs mock. getHealth issues 7 head-counts (distinguished by their
 * filters) plus one row fetch for the retry-exhausted fold.
 */
const buildSupabase = () => {
  const resolve = (head: boolean, filters: Filter[]) => {
    const eqVal = (field: string) => filters.find((f) => f.op === 'eq' && f.field === field)?.value;
    const hasIn = filters.some((f) => f.op === 'in');
    const hasLt = filters.some((f) => f.op === 'lt');

    if (head) {
      const status = eqVal('status') as string | undefined;
      if (status === 'completed') return { count: 80, error: null };
      if (status === 'failed') return { count: 15, error: null };
      if (status === 'cancelled') return { count: 5, error: null };
      if (hasIn && hasLt) return { count: 2, error: null }; // stuck
      if (hasIn) return { count: 7, error: null }; // running
      return { count: 100, error: null }; // total in window
    }
    // retry-exhausted fetch: 2 of 3 have exhausted their budget
    return {
      data: [
        { retry_count: 1, max_retries: 1 },
        { retry_count: 0, max_retries: 2 },
        { retry_count: 3, max_retries: 3 },
      ],
      error: null,
    };
  };

  const client = {
    from: () => {
      const filters: Filter[] = [];
      let head = false;
      const builder: any = {
        select: (_c: string, opts?: { head?: boolean }) => {
          head = Boolean(opts?.head);
          return builder;
        },
        eq: (field: string, value: unknown) => (filters.push({ op: 'eq', field, value }), builder),
        gte: (field: string, value: unknown) => (filters.push({ op: 'gte', field, value }), builder),
        lt: (field: string, value: unknown) => (filters.push({ op: 'lt', field, value }), builder),
        in: (field: string, value: unknown) => (filters.push({ op: 'in', field, value }), builder),
        limit: () => builder,
        then: (r: (v: unknown) => unknown) => Promise.resolve(resolve(head, filters)).then(r),
      };
      return builder;
    },
  };
  return { client } as unknown as SupabaseService;
};

describe('AdminRunsService.getHealth', () => {
  it('computes success rate, running, stuck and retry-exhausted', async () => {
    const service = new AdminRunsService(buildSupabase());
    const h = await service.getHealth();

    expect(h.last24h).toEqual({ total: 100, completed: 80, failed: 15, cancelled: 5 });
    // 80 / (80 + 15) = 8421 bps
    expect(h.successRateBps).toBe(8421);
    expect(h.running).toBe(7);
    expect(h.stuck).toBe(2);
    expect(h.retryExhausted24h).toBe(2);
  });

  it('reports a zero success rate when no completed/failed runs exist', async () => {
    const empty = {
      client: {
        from: () => {
          const builder: any = {
            select: () => builder,
            eq: () => builder,
            gte: () => builder,
            lt: () => builder,
            in: () => builder,
            limit: () => builder,
            then: (r: (v: unknown) => unknown) =>
              Promise.resolve({ count: 0, data: [], error: null }).then(r),
          };
          return builder;
        },
      },
    } as unknown as SupabaseService;

    const h = await new AdminRunsService(empty).getHealth();
    expect(h.successRateBps).toBe(0);
    expect(h.running).toBe(0);
  });
});
