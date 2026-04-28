// Mock the Umbra SDK before any imports that traverse it. The SDK's transitive
// `@noble/ciphers/aes.js` is published as ESM-only and Jest's transformer would
// otherwise refuse to parse it.
jest.mock('@umbra-privacy/sdk', () => ({
  getUmbraClient: jest.fn(),
  createSignerFromPrivateKeyBytes: jest.fn(),
  getUserRegistrationFunction: jest.fn(),
  getUserAccountQuerierFunction: jest.fn(),
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction: jest.fn(),
  getEncryptedBalanceToPublicBalanceDirectWithdrawerFunction: jest.fn(),
  getEncryptedBalanceQuerierFunction: jest.fn(),
}));

import { ConfigService } from '@nestjs/config';
import { AdminPrivacyService } from './admin-privacy.service';
import { type SupabaseService } from '../../database/supabase.service';
import { type AdminOverviewService } from '../overview/admin-overview.service';
import { type UmbraDeploymentSignerService } from '../../umbra/umbra-deployment-signer.service';
import { type KeeperKeypairService } from '../../onchain/keeper-keypair.service';

interface CountQueryRecorder {
  table: string;
  filters: Array<{ op: string; field: string; value: unknown }>;
  /** Either a configured count for this `from()` invocation or the default. */
  resolveCount: number;
}

/**
 * Build a Supabase mock where each table has a sequence of count responses
 * (returned in the order .from(table) is called). When the sequence runs out,
 * the last value is reused.
 */
const buildSupabaseForCount = (
  countsByTable: Record<string, number[]>,
  latestSnapshot: { snapshot_revision: number; published_at: string } | null = null,
) => {
  const recorders: CountQueryRecorder[] = [];
  const cursor: Record<string, number> = {};

  const wrapCountChain = (recorder: CountQueryRecorder) => {
    const builder: any = {
      eq: (f: string, v: unknown) => {
        recorder.filters.push({ op: 'eq', field: f, value: v });
        return builder;
      },
      gte: (f: string, v: unknown) => {
        recorder.filters.push({ op: 'gte', field: f, value: v });
        return builder;
      },
      lte: (f: string, v: unknown) => {
        recorder.filters.push({ op: 'lte', field: f, value: v });
        return builder;
      },
      not: (f: string, _op: string, v: unknown) => {
        recorder.filters.push({ op: 'not', field: f, value: v });
        return builder;
      },
      is: (f: string, v: unknown) => {
        recorder.filters.push({ op: 'is', field: f, value: v });
        return builder;
      },
      then: (resolve: (value: { count: number; error: null }) => unknown) =>
        Promise.resolve({ count: recorder.resolveCount, error: null }).then(resolve),
    };
    return builder;
  };

  const wrapLatestSnapshotChain = () => {
    const builder: any = {
      order: () => builder,
      limit: () => builder,
      maybeSingle: () =>
        Promise.resolve({
          data: latestSnapshot,
          error: null,
        }),
    };
    return builder;
  };

  const client = {
    from: (table: string) => {
      // Special-case the latest-snapshot read which uses .select(...).order(...).limit(1).maybeSingle()
      // and is distinguished by NOT calling `.select(_, { head: true })`.
      const seq = countsByTable[table] ?? [0];
      const idx = (cursor[table] = (cursor[table] ?? 0) + 1) - 1;
      const resolveCount = seq[Math.min(idx, seq.length - 1)] ?? 0;
      const recorder: CountQueryRecorder = {
        table,
        filters: [],
        resolveCount,
      };
      recorders.push(recorder);

      return {
        select: (_cols: string, opts?: { count?: 'exact'; head?: boolean }) => {
          if (opts?.count === 'exact' && opts.head === true) {
            return wrapCountChain(recorder);
          }
          // Latest-snapshot path
          return wrapLatestSnapshotChain();
        },
      };
    },
  };

  return {
    supabaseService: { client } as unknown as SupabaseService,
    recorders,
  };
};

const buildOverviewService = (): AdminOverviewService =>
  ({
    computeAdapterMatrix: () => [
      { adapter: 'umbra', mode: 'noop' as const },
      { adapter: 'per', mode: 'noop' as const },
      { adapter: 'pp', mode: 'noop' as const },
      { adapter: 'er', mode: 'noop' as const },
    ],
  }) as unknown as AdminOverviewService;

const buildUmbraSigner = (): UmbraDeploymentSignerService =>
  ({
    isConfigured: () => false,
  }) as unknown as UmbraDeploymentSignerService;

const buildKeeperService = (): KeeperKeypairService =>
  ({
    loadKeypair: jest.fn().mockRejectedValue(new Error('not configured')),
    getResolvedSource: jest.fn().mockReturnValue(null),
  }) as unknown as KeeperKeypairService;

describe('AdminPrivacyService.getOverview - follower-vault aggregates', () => {
  it('summarises follower vaults, subscriptions, cycles, and grants', async () => {
    const { supabaseService } = buildSupabaseForCount({
      // PER tokens: active, challenge, revoked, expiring24h, expiring7d
      per_auth_tokens: [3, 1, 5, 2, 4],
      // Snapshots: last24h, last7d
      strategy_public_snapshots: [7, 30],
      // Umbra registrations: confirmed, pending, failed, unset + ER calls below
      strategy_deployments: [10, 2, 1, 4, 0, 0],
      // Follower vaults: pending_funding, active, paused, exiting, closed
      follower_vaults: [3, 8, 1, 2, 4],
      // Subscriptions: pending_funding, active, paused, exiting, closed, withUmbraIdentity
      strategy_subscriptions: [3, 9, 1, 2, 4, 12],
      // Private cycles: last24h, last7d, failed24h, completed24h
      private_execution_cycles: [11, 50, 1, 9],
      // Visibility grants: active, revoked, expired
      follower_visibility_grants: [6, 2, 1],
    });

    const service = new AdminPrivacyService(
      supabaseService,
      new ConfigService(),
      buildOverviewService(),
      buildUmbraSigner(),
      buildKeeperService(),
    );

    const result = await service.getOverview();

    expect(result.followerVaults.byStatus).toEqual({
      pending_funding: 3,
      active: 8,
      paused: 1,
      exiting: 2,
      closed: 4,
    });
    expect(result.followerVaults.total).toBe(18);

    expect(result.subscriptions.byStatus).toEqual({
      pending_funding: 3,
      active: 9,
      paused: 1,
      exiting: 2,
      closed: 4,
    });
    expect(result.subscriptions.total).toBe(19);
    expect(result.subscriptions.withUmbraIdentity).toBe(12);

    expect(result.privateCycles).toEqual({
      last24h: 11,
      last7d: 50,
      failedLast24h: 1,
      completedLast24h: 9,
    });

    expect(result.visibilityGrants).toEqual({
      active: 6,
      revoked: 2,
      expired: 1,
    });

    // Existing aggregates still wired through.
    expect(result.perTokens.byStatus.active).toBe(3);
    expect(result.umbra.registrations.confirmed).toBe(10);
  });

  it('returns zero counts when the follower-vault tables are empty', async () => {
    const { supabaseService } = buildSupabaseForCount({
      per_auth_tokens: [0],
      strategy_public_snapshots: [0],
      strategy_deployments: [0],
      follower_vaults: [0],
      strategy_subscriptions: [0],
      private_execution_cycles: [0],
      follower_visibility_grants: [0],
    });

    const service = new AdminPrivacyService(
      supabaseService,
      new ConfigService(),
      buildOverviewService(),
      buildUmbraSigner(),
      buildKeeperService(),
    );

    const result = await service.getOverview();

    expect(result.followerVaults.total).toBe(0);
    expect(result.subscriptions.total).toBe(0);
    expect(result.subscriptions.withUmbraIdentity).toBe(0);
    expect(result.privateCycles.last24h).toBe(0);
    expect(result.privateCycles.failedLast24h).toBe(0);
    expect(result.visibilityGrants.active).toBe(0);
  });
});
