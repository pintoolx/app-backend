import { PrivateExecutionCyclesService } from './private-execution-cycles.service';
import { FollowerVaultAllocationsService } from './follower-vault-allocations.service';
import {
  type PrivateExecutionCycleRow,
  type PrivateExecutionCyclesRepository,
} from './private-execution-cycles.repository';
import {
  type FollowerExecutionReceiptRow,
  type FollowerExecutionReceiptsRepository,
} from './follower-execution-receipts.repository';
import {
  type StrategySubscriptionRow,
  type StrategySubscriptionsRepository,
} from './subscriptions.repository';
import { type FollowerVaultRow, type FollowerVaultsRepository } from './follower-vaults.repository';
import { type StrategyDeploymentsRepository } from '../strategy-deployments/strategy-deployments.repository';

const DEPLOYMENT_ID = 'dep-1';
const CREATOR = 'creator-wallet';

const sub = (id: string, follower: string, capital: string): StrategySubscriptionRow => ({
  id,
  deployment_id: DEPLOYMENT_ID,
  follower_wallet: follower,
  subscription_pda: null,
  follower_vault_pda: null,
  vault_authority_pda: null,
  status: 'active',
  visibility_preset: 'subscriber-self',
  max_capital: capital,
  allocation_mode: 'proportional',
  max_drawdown_bps: null,
  per_member_ref: null,
  umbra_identity_ref: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

const vault = (id: string, subId: string): FollowerVaultRow => ({
  id,
  subscription_id: subId,
  deployment_id: DEPLOYMENT_ID,
  vault_pda: null,
  authority_pda: null,
  lifecycle_status: 'active',
  private_state_ref: null,
  public_snapshot_ref: null,
  custody_mode: 'program_owned',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('PrivateExecutionCyclesService', () => {
  it('writes one receipt per active subscription and marks the cycle completed', async () => {
    const subs = [sub('s1', 'w1', '100'), sub('s2', 'w2', '300')];
    const vaults = [vault('v1', 's1'), vault('v2', 's2')];

    const insertedCycle: PrivateExecutionCycleRow = {
      id: 'cycle-1',
      deployment_id: DEPLOYMENT_ID,
      idempotency_key: 'idem-1',
      trigger_type: 'price',
      trigger_ref: null,
      status: 'running',
      metrics_summary: {},
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: null,
      error_message: null,
    };

    const insertedReceipts: FollowerExecutionReceiptRow[] = subs.map((s) => ({
      id: `r-${s.id}`,
      cycle_id: 'cycle-1',
      subscription_id: s.id,
      follower_vault_id: vaults.find((v) => v.subscription_id === s.id)!.id,
      allocation_amount: '0',
      allocation_pct_bps: 0,
      private_state_revision: null,
      status: 'planned',
      payload: {},
      created_at: '2026-01-01T00:00:00.000Z',
    }));

    const cyclesRepo = {
      getByIdempotencyKey: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(insertedCycle),
      update: jest.fn().mockImplementation(async (_id, input) => ({ ...insertedCycle, ...input })),
      getByIdAndDeployment: jest.fn(),
      listByDeployment: jest.fn(),
    } as unknown as PrivateExecutionCyclesRepository;

    const receiptsRepo = {
      insertMany: jest.fn().mockResolvedValue(insertedReceipts),
      listByCycle: jest.fn().mockResolvedValue(insertedReceipts),
      listLatestForSubscription: jest.fn(),
    } as unknown as FollowerExecutionReceiptsRepository;

    const subscriptionsRepo = {
      listActiveByDeployment: jest.fn().mockResolvedValue(subs),
      // unused by startCycle:
      insert: jest.fn(),
      getById: jest.fn(),
      getForFollower: jest.fn(),
      getByDeploymentAndFollower: jest.fn(),
      listByDeployment: jest.fn(),
      update: jest.fn(),
    } as unknown as StrategySubscriptionsRepository;

    const vaultsRepo = {
      getBySubscriptionIdOrThrow: jest.fn().mockImplementation(async (subId: string) => {
        const v = vaults.find((vv) => vv.subscription_id === subId);
        if (!v) throw new Error(`no vault for ${subId}`);
        return v;
      }),
      // unused by startCycle:
      insert: jest.fn(),
      getBySubscriptionId: jest.fn(),
      listByDeployment: jest.fn(),
      update: jest.fn(),
    } as unknown as FollowerVaultsRepository;

    const deploymentsRepo = {
      getForCreator: jest.fn().mockResolvedValue({
        id: DEPLOYMENT_ID,
        creator_wallet_address: CREATOR,
      }),
    } as unknown as StrategyDeploymentsRepository;

    const service = new PrivateExecutionCyclesService(
      cyclesRepo,
      receiptsRepo,
      subscriptionsRepo,
      vaultsRepo,
      deploymentsRepo,
      new FollowerVaultAllocationsService(),
    );

    const result = await service.startCycle(DEPLOYMENT_ID, CREATOR, {
      triggerType: 'price',
      idempotencyKey: 'idem-1',
      notional: '1000',
    });

    expect(result.cycle.status).toBe('completed');
    expect((cyclesRepo.update as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: 'completed',
        metricsSummary: expect.objectContaining({ followerCount: 2 }),
      }),
    );

    const inserts = (receiptsRepo.insertMany as jest.Mock).mock.calls[0][0] as Array<{
      subscriptionId: string;
      followerVaultId: string;
      payload: Record<string, unknown>;
    }>;
    expect(inserts).toHaveLength(2);
    // Each receipt is wired to the right vault.
    expect(inserts.find((i) => i.subscriptionId === 's1')?.followerVaultId).toBe('v1');
    expect(inserts.find((i) => i.subscriptionId === 's2')?.followerVaultId).toBe('v2');
    // Sanitized payload contract: only allocation context, no raw signal data.
    for (const ins of inserts) {
      expect(Object.keys(ins.payload)).toEqual(
        expect.arrayContaining(['allocationMode', 'maxCapitalAtCycle']),
      );
      expect(Object.keys(ins.payload)).not.toContain('signal');
      expect(Object.keys(ins.payload)).not.toContain('parameters');
    }
  });

  it('returns the existing cycle without inserting new receipts when idempotency key collides', async () => {
    const existing: PrivateExecutionCycleRow = {
      id: 'cycle-existing',
      deployment_id: DEPLOYMENT_ID,
      idempotency_key: 'idem-1',
      trigger_type: 'price',
      trigger_ref: null,
      status: 'completed',
      metrics_summary: {},
      started_at: '2026-01-01T00:00:00.000Z',
      completed_at: '2026-01-01T00:00:01.000Z',
      error_message: null,
    };
    const cyclesRepo = {
      getByIdempotencyKey: jest.fn().mockResolvedValue(existing),
      insert: jest.fn(),
      update: jest.fn(),
    } as unknown as PrivateExecutionCyclesRepository;
    const receiptsRepo = {
      listByCycle: jest.fn().mockResolvedValue([]),
      insertMany: jest.fn(),
    } as unknown as FollowerExecutionReceiptsRepository;
    const service = new PrivateExecutionCyclesService(
      cyclesRepo,
      receiptsRepo,
      {} as unknown as StrategySubscriptionsRepository,
      {} as unknown as FollowerVaultsRepository,
      {
        getForCreator: jest.fn().mockResolvedValue({
          id: DEPLOYMENT_ID,
          creator_wallet_address: CREATOR,
        }),
      } as unknown as StrategyDeploymentsRepository,
      new FollowerVaultAllocationsService(),
    );
    const result = await service.startCycle(DEPLOYMENT_ID, CREATOR, {
      triggerType: 'price',
      idempotencyKey: 'idem-1',
    });
    expect(result.cycle.id).toBe('cycle-existing');
    expect(cyclesRepo.insert).not.toHaveBeenCalled();
    expect(receiptsRepo.insertMany).not.toHaveBeenCalled();
  });
});
