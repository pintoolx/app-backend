import { NotFoundException } from '@nestjs/common';
import { AdminFollowerVaultsService } from './admin-follower-vaults.service';
import { type SupabaseService } from '../../database/supabase.service';

interface QueryRecorder {
  table: string;
  selected: string[];
  filters: Array<{ op: string; field: string; value: unknown }>;
  orderField?: { field: string; ascending: boolean };
  limitValue?: number;
  inField?: { field: string; values: unknown[] };
  resolveWith: { data: unknown; error: unknown };
  // For maybeSingle / single calls
  singleMode?: 'single' | 'maybeSingle';
}

const buildQuery = (table: string, response: { data: unknown; error: unknown }): QueryRecorder => {
  const recorder: QueryRecorder = {
    table,
    selected: [],
    filters: [],
    resolveWith: response,
  };
  return recorder;
};

const wrapQuery = (recorder: QueryRecorder) => {
  const builder: any = {
    select: (cols: string) => {
      recorder.selected.push(cols);
      return builder;
    },
    eq: (field: string, value: unknown) => {
      recorder.filters.push({ op: 'eq', field, value });
      return builder;
    },
    gte: (field: string, value: unknown) => {
      recorder.filters.push({ op: 'gte', field, value });
      return builder;
    },
    in: (field: string, values: unknown[]) => {
      recorder.inField = { field, values };
      return builder;
    },
    order: (field: string, opts: { ascending: boolean }) => {
      recorder.orderField = { field, ascending: opts.ascending };
      return builder;
    },
    limit: (n: number) => {
      recorder.limitValue = n;
      return builder;
    },
    maybeSingle: () => {
      recorder.singleMode = 'maybeSingle';
      return Promise.resolve(recorder.resolveWith);
    },
    single: () => {
      recorder.singleMode = 'single';
      return Promise.resolve(recorder.resolveWith);
    },
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(recorder.resolveWith).then(resolve),
  };
  return builder;
};

const buildSupabase = (
  responsesByTable: Record<
    string,
    { data: unknown; error: unknown } | Array<{ data: unknown; error: unknown }>
  >,
) => {
  const recorders: QueryRecorder[] = [];
  const counters: Record<string, number> = {};
  const client = {
    from: (table: string) => {
      const next = counters[table] ?? 0;
      counters[table] = next + 1;
      const responses = responsesByTable[table];
      if (!responses) {
        throw new Error(`unmocked Supabase table: ${table}`);
      }
      const response = Array.isArray(responses)
        ? responses[Math.min(next, responses.length - 1)]
        : responses;
      const recorder = buildQuery(table, response);
      recorders.push(recorder);
      return wrapQuery(recorder);
    },
  };
  return {
    client,
    recorders,
    supabaseService: { client } as unknown as SupabaseService,
  };
};

describe('AdminFollowerVaultsService', () => {
  it('listFollowerVaults applies deployment + status filters and limit', async () => {
    const { recorders, supabaseService } = buildSupabase({
      follower_vaults: { data: [{ id: 'fv-1' }], error: null },
    });
    const svc = new AdminFollowerVaultsService(supabaseService);
    const out = await svc.listFollowerVaults({
      deploymentId: 'dep-1',
      status: 'active',
      limit: 50,
    });
    expect(out).toEqual([{ id: 'fv-1' }]);
    const r = recorders[0];
    expect(r.table).toBe('follower_vaults');
    expect(r.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', field: 'deployment_id', value: 'dep-1' },
        { op: 'eq', field: 'lifecycle_status', value: 'active' },
      ]),
    );
    expect(r.limitValue).toBe(50);
    expect(r.orderField).toEqual({ field: 'created_at', ascending: false });
  });

  it('listSubscriptions filters by follower wallet', async () => {
    const { recorders, supabaseService } = buildSupabase({
      strategy_subscriptions: { data: [], error: null },
    });
    const svc = new AdminFollowerVaultsService(supabaseService);
    await svc.listSubscriptions({ followerWallet: 'wallet-1' });
    expect(recorders[0].filters).toContainEqual({
      op: 'eq',
      field: 'follower_wallet',
      value: 'wallet-1',
    });
  });

  it('listPrivateCycles applies the since filter as gte on started_at', async () => {
    const { recorders, supabaseService } = buildSupabase({
      private_execution_cycles: { data: [], error: null },
    });
    const svc = new AdminFollowerVaultsService(supabaseService);
    await svc.listPrivateCycles({ since: '2026-01-01T00:00:00.000Z' });
    expect(recorders[0].filters).toContainEqual({
      op: 'gte',
      field: 'started_at',
      value: '2026-01-01T00:00:00.000Z',
    });
    expect(recorders[0].orderField).toEqual({ field: 'started_at', ascending: false });
  });

  it('getPrivateCycle returns cycle plus receipts', async () => {
    const cycle = { id: 'c-1', deployment_id: 'd-1' };
    const receipts = [{ id: 'r-1', cycle_id: 'c-1' }];
    const { supabaseService } = buildSupabase({
      private_execution_cycles: { data: cycle, error: null },
      follower_execution_receipts: { data: receipts, error: null },
    });
    const svc = new AdminFollowerVaultsService(supabaseService);
    const result = await svc.getPrivateCycle('c-1');
    expect(result.cycle.id).toBe('c-1');
    expect(result.receipts).toHaveLength(1);
  });

  it('getPrivateCycle throws when the cycle is missing', async () => {
    const { supabaseService } = buildSupabase({
      private_execution_cycles: { data: null, error: null },
    });
    const svc = new AdminFollowerVaultsService(supabaseService);
    await expect(svc.getPrivateCycle('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listUmbraIdentities surfaces only the salt prefix and never the full salt', async () => {
    const longSalt = 'abcdef0123456789'.repeat(4); // 64 chars
    const { supabaseService } = buildSupabase({
      follower_vault_umbra_identities: {
        data: [
          {
            id: 'u-1',
            follower_vault_id: 'v-1',
            signer_pubkey: 'pk',
            x25519_public_key: null,
            encrypted_user_account: null,
            registration_status: 'confirmed',
            register_queue_signature: null,
            register_callback_signature: null,
            derivation_salt: longSalt,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        error: null,
      },
    });
    const svc = new AdminFollowerVaultsService(supabaseService);
    const rows = await svc.listUmbraIdentities({});
    expect(rows[0].derivation_salt_prefix).toBe(`${longSalt.slice(0, 12)}…`);
    // Must not leak the full salt.
    expect(JSON.stringify(rows[0])).not.toContain(longSalt);
  });

  it('listUmbraIdentities short-circuits when deployment has no vaults', async () => {
    const { recorders, supabaseService } = buildSupabase({
      follower_vaults: { data: [], error: null },
    });
    const svc = new AdminFollowerVaultsService(supabaseService);
    const rows = await svc.listUmbraIdentities({ deploymentId: 'dep-x' });
    expect(rows).toEqual([]);
    // Only the vault-id lookup ran; identities table was not queried.
    expect(recorders).toHaveLength(1);
    expect(recorders[0].table).toBe('follower_vaults');
  });

  it('listVisibilityGrants filters by status', async () => {
    const { recorders, supabaseService } = buildSupabase({
      follower_visibility_grants: { data: [], error: null },
    });
    const svc = new AdminFollowerVaultsService(supabaseService);
    await svc.listVisibilityGrants({ status: 'revoked' });
    expect(recorders[0].filters).toContainEqual({
      op: 'eq',
      field: 'status',
      value: 'revoked',
    });
  });
});
